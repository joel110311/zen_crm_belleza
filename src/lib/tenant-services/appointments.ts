import "server-only";
import { Prisma, type Appointment } from "@prisma/client";
import {
    businessBoundsForDate,
    businessDateRangeBounds,
    isSameBusinessDate,
    normalizeBusinessHours,
} from "@/lib/calendar/business-hours";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";
import {
    asRecord,
    booleanValue,
    dateValue,
    identifier,
    numberValue,
    optionalText,
    text,
} from "@/lib/tenant-services/validation";

const APPOINTMENT_INCLUDE = {
    contact: { select: { id: true, name: true, lastName: true, phone: true, email: true } },
    specialist: { select: { id: true, name: true, displayName: true, specialty: true, color: true, room: true, userId: true } },
    service: { select: { id: true, name: true, durationMinutes: true, price: true, currency: true } },
} satisfies Prisma.AppointmentInclude;

const APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed", "in_progress", "completed", "cancelled", "no_show"]);
const CONFIRMATION_STATUSES = new Set(["pending", "confirmed", "declined"]);
const VISIT_MODES = new Set(["presencial", "virtual", "hibrida"]);

async function professionalSpecialistIds(context: TenantServiceContext) {
    if (context.role !== "PROFESSIONAL") return null;
    const specialists = await context.db.specialist.findMany({
        where: { userId: context.actor.id },
        select: { id: true },
    });
    return specialists.map((specialist) => specialist.id);
}

async function assertSpecialistScope(context: TenantServiceContext, specialistId: string) {
    const specialist = await context.db.specialist.findUnique({
        where: { id: specialistId },
        select: { id: true, name: true, displayName: true, userId: true, isActive: true },
    });
    if (!specialist) throw new TenantServiceError("VALIDATION_ERROR", "El especialista ya no existe.", { field: "specialistId" });
    if (context.role === "PROFESSIONAL" && specialist.userId !== context.actor.id) {
        throw new TenantServiceError("FORBIDDEN", "Solo puedes gestionar citas de tu propia agenda.");
    }
    return specialist;
}

function parseRangeDate(value: string | undefined, fallback: Date, field: string): string | Date {
    if (!value) return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new TenantServiceError("VALIDATION_ERROR", `${field} no es una fecha válida.`);
    return parsed;
}

export async function getCalendarSnapshot(
    context: TenantServiceContext,
    rawFrom?: string,
    rawTo?: string,
) {
    assertTenantPermission(context, "calendar.read");
    const settings = await getTenantSystemSettingsOrDefaults(context.db);
    const businessHours = normalizeBusinessHours(settings);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const requestedFrom = parseRangeDate(rawFrom, defaultFrom, "Desde");
    const requestedTo = parseRangeDate(rawTo, defaultTo, "Hasta");
    const bounds = businessDateRangeBounds(requestedFrom, requestedTo, businessHours.timeZone);
    if (bounds.end.getTime() - bounds.start.getTime() > 93 * 24 * 60 * 60 * 1000) {
        throw new TenantServiceError("VALIDATION_ERROR", "El rango de agenda no puede exceder 93 días.");
    }

    const ownIds = await professionalSpecialistIds(context);
    const specialistWhere = ownIds ? { id: { in: ownIds } } : { isActive: true };
    const appointmentWhere: Prisma.AppointmentWhereInput = {
        startTime: { lt: bounds.end },
        endTime: { gt: bounds.start },
        ...(ownIds ? { specialistId: { in: ownIds } } : {}),
    };
    const blockWhere: Prisma.SpecialistAvailabilityBlockWhereInput = {
        startTime: { lt: bounds.end },
        endTime: { gt: bounds.start },
        ...(ownIds ? { specialistId: { in: ownIds } } : {}),
    };

    const [appointments, availabilityBlocks, contacts, specialists, services] = await Promise.all([
        context.db.appointment.findMany({ where: appointmentWhere, orderBy: { startTime: "asc" }, include: APPOINTMENT_INCLUDE }),
        context.db.specialistAvailabilityBlock.findMany({ where: blockWhere, orderBy: { startTime: "asc" }, include: { specialist: { select: { id: true, name: true, displayName: true } } } }),
        context.db.contact.findMany({ orderBy: [{ updatedAt: "desc" }], take: 100, select: { id: true, name: true, lastName: true, phone: true } }),
        context.db.specialist.findMany({ where: specialistWhere, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, displayName: true, specialty: true, color: true, room: true, userId: true } }),
        context.db.service.findMany({ where: { isActive: true, category: { isActive: true } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { category: { select: { id: true, name: true, color: true } }, specialists: { select: { specialistId: true } } } }),
    ]);

    return {
        appointments,
        availabilityBlocks,
        options: { contacts, specialists, services },
        businessHours,
        range: { from: bounds.fromKey, to: bounds.toKey },
    };
}

export async function getAppointment(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "calendar.read");
    const id = identifier(rawId);
    const appointment = await context.db.appointment.findUnique({ where: { id }, include: APPOINTMENT_INCLUDE });
    if (!appointment) throw new TenantServiceError("NOT_FOUND", "La cita ya no existe.");
    if (context.role === "PROFESSIONAL") {
        if (!appointment.specialistId) throw new TenantServiceError("FORBIDDEN", "Esta cita no pertenece a tu agenda.");
        await assertSpecialistScope(context, appointment.specialistId);
    }
    return appointment;
}

function allowedValue(value: unknown, field: string, values: Set<string>, fallback: string) {
    const parsed = text(value, field, { max: 40, fallback });
    if (!values.has(parsed)) throw new TenantServiceError("VALIDATION_ERROR", `${field} no es válido.`, { field });
    return parsed;
}

function appointmentInput(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    return {
        input,
        specialistId: input.specialistId === undefined && partial ? undefined : identifier(input.specialistId, "Especialista"),
        contactId: input.contactId === undefined && partial ? undefined : optionalText(input.contactId, "Contacto", 100),
        serviceId: input.serviceId === undefined && partial ? undefined : optionalText(input.serviceId, "Servicio", 100),
        title: input.title === undefined && partial ? undefined : optionalText(input.title, "Título", 200),
        startTime: input.startTime === undefined && partial ? undefined : dateValue(input.startTime, "Inicio", { required: true })!,
        endTime: input.endTime === undefined && partial ? undefined : dateValue(input.endTime, "Fin"),
        status: input.status === undefined && partial ? undefined : allowedValue(input.status, "Estado", APPOINTMENT_STATUSES, "scheduled"),
        notes: input.notes === undefined && partial ? undefined : optionalText(input.notes, "Notas", 3000),
        appointmentType: input.appointmentType === undefined && partial ? undefined : optionalText(input.appointmentType, "Tipo de cita", 100) || "Consulta",
        isFirstVisit: input.isFirstVisit === undefined && partial ? undefined : booleanValue(input.isFirstVisit, false),
        isOverbook: input.isOverbook === undefined && partial ? undefined : booleanValue(input.isOverbook, false),
        confirmationStatus: input.confirmationStatus === undefined && partial ? undefined : allowedValue(input.confirmationStatus, "Confirmación", CONFIRMATION_STATUSES, "pending"),
        remindersOptOut: input.remindersOptOut === undefined && partial ? undefined : booleanValue(input.remindersOptOut, false),
        visitMode: input.visitMode === undefined && partial ? undefined : allowedValue(input.visitMode, "Modalidad", VISIT_MODES, "presencial"),
        paymentStatus: input.paymentStatus === undefined && partial ? undefined : text(input.paymentStatus, "Estado de pago", { max: 40, fallback: "unpaid" }) || "unpaid",
        paymentAmount: input.paymentAmount === undefined && partial ? undefined : numberValue(input.paymentAmount, "Importe", { fallback: 0, min: 0, max: 10000000 }),
        paymentCurrency: input.paymentCurrency === undefined && partial ? undefined : (text(input.paymentCurrency, "Moneda", { max: 3, fallback: "MXN" }) || "MXN").toUpperCase(),
        cancellationReason: input.cancellationReason === undefined && partial ? undefined : optionalText(input.cancellationReason, "Motivo de cancelación", 1000),
    };
}

type AppointmentDraft = ReturnType<typeof appointmentInput>;

async function resolveAppointmentData(
    context: TenantServiceContext,
    draft: AppointmentDraft,
    current?: Appointment | null,
) {
    const specialistId = draft.specialistId ?? current?.specialistId;
    if (!specialistId) throw new TenantServiceError("VALIDATION_ERROR", "Selecciona un especialista.", { field: "specialistId" });
    const specialist = await assertSpecialistScope(context, specialistId);

    const contactIdInput = draft.contactId === undefined ? current?.contactId : draft.contactId;
    const serviceId = draft.serviceId === undefined ? current?.serviceId : draft.serviceId;
    const startTime = draft.startTime ?? current?.startTime;
    if (!startTime) throw new TenantServiceError("VALIDATION_ERROR", "Selecciona la fecha y hora de inicio.", { field: "startTime" });

    const [contact, service] = await Promise.all([
        contactIdInput ? context.db.contact.findUnique({ where: { id: contactIdInput }, select: { id: true, name: true, lastName: true } }) : null,
        serviceId ? context.db.service.findUnique({ where: { id: serviceId }, include: { specialists: { select: { specialistId: true } } } }) : null,
    ]);
    if (contactIdInput && !contact) throw new TenantServiceError("VALIDATION_ERROR", "El contacto ya no existe.", { field: "contactId" });
    if (serviceId && !service) throw new TenantServiceError("VALIDATION_ERROR", "El servicio ya no existe.", { field: "serviceId" });
    if (!contact) throw new TenantServiceError("VALIDATION_ERROR", "Selecciona un cliente.");
    if (service?.specialists.length && !service.specialists.some((item) => item.specialistId === specialistId)) {
        throw new TenantServiceError("VALIDATION_ERROR", "El especialista no está asignado a este servicio.", { field: "specialistId" });
    }

    const endTime = draft.endTime
        ?? (draft.startTime || !current
            ? new Date(startTime.getTime() + (service?.durationMinutes || 30) * 60 * 1000)
            : current.endTime);
    if (endTime <= startTime) throw new TenantServiceError("VALIDATION_ERROR", "La hora de fin debe ser posterior al inicio.");

    const isOverbook = draft.isOverbook ?? current?.isOverbook ?? false;
    if (isOverbook && context.role !== "OWNER" && context.role !== "ADMIN") {
        throw new TenantServiceError("FORBIDDEN", "Solo un administrador puede autorizar una sobrecita.");
    }
    const status = draft.status ?? current?.status ?? "scheduled";
    const clientName = `${contact.name || "Cliente"} ${contact.lastName || ""}`.trim();

    return {
        specialistId,
        specialistName: specialist.displayName || specialist.name,
        contactId: contact.id,
        serviceId: service?.id || null,
        title: draft.title ?? current?.title ?? `${service?.name || "Cita"} · ${clientName}`,
        startTime,
        endTime,
        status,
        notes: draft.notes === undefined ? current?.notes : draft.notes,
        appointmentType: draft.appointmentType ?? current?.appointmentType ?? service?.name ?? "Consulta",
        isFirstVisit: draft.isFirstVisit ?? current?.isFirstVisit ?? false,
        isOverbook,
        confirmationStatus: draft.confirmationStatus ?? current?.confirmationStatus ?? "pending",
        remindersOptOut: draft.remindersOptOut ?? current?.remindersOptOut ?? false,
        visitMode: draft.visitMode ?? current?.visitMode ?? "presencial",
        paymentStatus: draft.paymentStatus ?? current?.paymentStatus ?? "unpaid",
        paymentAmount: draft.paymentAmount ?? current?.paymentAmount ?? 0,
        paymentCurrency: draft.paymentCurrency ?? current?.paymentCurrency ?? service?.currency ?? "MXN",
        cancellationReason: draft.cancellationReason === undefined ? current?.cancellationReason : draft.cancellationReason,
        source: current?.source || "internal",
        userId: context.actor.id,
        publicToken: current?.publicToken || crypto.randomUUID(),
        cancelledAt: status === "cancelled" ? current?.cancelledAt || new Date() : null,
        completedAt: status === "completed" ? current?.completedAt || new Date() : current?.completedAt,
        noShowAt: status === "no_show" ? current?.noShowAt || new Date() : current?.noShowAt,
    };
}

async function assertSlotAvailable(
    context: TenantServiceContext,
    tx: Prisma.TransactionClient,
    data: Awaited<ReturnType<typeof resolveAppointmentData>>,
    excludeId?: string,
) {
    if (data.isOverbook || data.status === "cancelled") return;
    const settings = await getTenantSystemSettingsOrDefaults(context.db);
    const businessHours = normalizeBusinessHours(settings);
    const bounds = businessBoundsForDate(data.startTime, businessHours);
    if (!isSameBusinessDate(data.startTime, data.endTime, businessHours.timeZone)
        || !bounds.isOpen
        || data.startTime < bounds.start
        || data.endTime > bounds.end) {
        throw new TenantServiceError("CONFLICT", "La cita está fuera del horario de atención. Un administrador puede marcarla como sobrecita.");
    }

    const [conflict, block] = await Promise.all([
        tx.appointment.findFirst({
            where: {
                id: excludeId ? { not: excludeId } : undefined,
                specialistId: data.specialistId,
                status: { not: "cancelled" },
                startTime: { lt: data.endTime },
                endTime: { gt: data.startTime },
            },
            select: { id: true, title: true },
        }),
        tx.specialistAvailabilityBlock.findFirst({
            where: {
                OR: [{ specialistId: data.specialistId }, { specialistId: null }],
                startTime: { lt: data.endTime },
                endTime: { gt: data.startTime },
            },
            select: { id: true, title: true },
        }),
    ]);
    if (conflict) throw new TenantServiceError("CONFLICT", `El horario se cruza con “${conflict.title}”.`);
    if (block) throw new TenantServiceError("CONFLICT", `El horario está bloqueado por “${block.title}”.`);
}

export async function createAppointment(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "calendar.write");
    const data = await resolveAppointmentData(context, appointmentInput(rawInput));
    return context.db.$transaction(async (tx) => {
        await assertSlotAvailable(context, tx, data);
        return tx.appointment.create({ data, include: APPOINTMENT_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAppointment(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "calendar.write");
    const id = identifier(rawId);
    const current = await context.db.appointment.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "La cita ya no existe.");
    if (context.role === "PROFESSIONAL") {
        if (!current.specialistId) throw new TenantServiceError("FORBIDDEN", "Esta cita no pertenece a tu agenda.");
        await assertSpecialistScope(context, current.specialistId);
    }
    const data = await resolveAppointmentData(context, appointmentInput(rawInput, true), current);
    return context.db.$transaction(async (tx) => {
        await assertSlotAvailable(context, tx, data, id);
        return tx.appointment.update({ where: { id }, data, include: APPOINTMENT_INCLUDE });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelAppointment(context: TenantServiceContext, rawId: unknown, rawInput?: unknown) {
    assertTenantPermission(context, "calendar.write");
    const id = identifier(rawId);
    const current = await context.db.appointment.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "La cita ya no existe.");
    if (context.role === "PROFESSIONAL") {
        if (!current.specialistId) throw new TenantServiceError("FORBIDDEN", "Esta cita no pertenece a tu agenda.");
        await assertSpecialistScope(context, current.specialistId);
    }
    const input = rawInput === undefined ? {} : asRecord(rawInput);
    return context.db.appointment.update({
        where: { id },
        data: {
            status: "cancelled",
            cancelledAt: current.cancelledAt || new Date(),
            cancellationReason: optionalText(input.reason, "Motivo", 1000),
            userId: context.actor.id,
        },
        include: APPOINTMENT_INCLUDE,
    });
}
