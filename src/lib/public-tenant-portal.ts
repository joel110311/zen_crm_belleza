import "server-only";
import { publicPortalSocialLinks } from "@/lib/portal-social-links";

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { getControlDb } from "@/lib/control-db";
import { normalizeTenantSlug } from "@/lib/control-plane";
import { isMultitenantPublicPortalEnabled } from "@/lib/multitenant-features";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";
import {
    businessBoundsForDate,
    formatBusinessScheduleSummary,
    isSameBusinessDate,
    normalizeBusinessHours,
    timeToMinutes,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";
import { buildOperationContext, normalizePhoneForOperation, parsePhoneByCountry } from "@/lib/operation-context";
import { consumeSharedRateLimit, getRequestIp, hashSecurityIdentifier } from "@/lib/security";

const SLOT_INTERVAL_MINUTES = 30;
const HOLD_LIFETIME_MS = 7 * 60 * 1000;
const BOOKING_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export class PublicPortalError extends Error {
    constructor(
        public readonly code: "NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR",
        message: string,
    ) {
        super(message);
        this.name = "PublicPortalError";
    }
}

export type PublicPortalContext = {
    tenantId: string;
    slug: string;
    displayName: string;
    timeZone: string;
    db: PrismaClient;
    settings: Awaited<ReturnType<typeof getTenantSystemSettingsOrDefaults>>;
};

function requestId(request: Request) {
    const candidate = request.headers.get("x-request-id");
    return candidate && /^[A-Za-z0-9._:-]{8,100}$/.test(candidate) ? candidate : randomUUID();
}

function errorResponse(error: unknown, id: string) {
    const mapped = error instanceof PublicPortalError
        ? error
        : new PublicPortalError("INTERNAL_ERROR", "No fue posible procesar la solicitud.");
    const status = mapped.code === "NOT_FOUND" ? 404
        : mapped.code === "VALIDATION_ERROR" ? 400
            : mapped.code === "CONFLICT" ? 409
                : mapped.code === "RATE_LIMITED" ? 429
                    : 500;
    return NextResponse.json({ error: { code: mapped.code, message: mapped.message, requestId: id } }, {
        status,
        headers: { "x-request-id": id },
    });
}

export function publicPortalData<T>(data: T, id: string, status = 200) {
    return NextResponse.json({ data, meta: { requestId: id } }, { status, headers: { "x-request-id": id } });
}

/** Resolve the tenant only from the URL and control plane. The public caller never chooses a DB. */
export async function resolvePublicPortalContext(rawSlug: string): Promise<PublicPortalContext | null> {
    let slug: string;
    try {
        slug = normalizeTenantSlug(rawSlug);
    } catch {
        return null;
    }
    const tenant = await getControlDb().tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, displayName: true, timeZone: true, status: true, accessMode: true },
    });
    // Public operations need an operational tenant; READ_ONLY is intentionally not a booking portal.
    if (!tenant || tenant.status !== "READY" || tenant.accessMode !== "FULL") return null;
    const db = await getTenantPrismaManager().getForTenant(tenant.id);
    const [settings, onboarding] = await Promise.all([
        getTenantSystemSettingsOrDefaults(db),
        db.tenantOnboardingState.findUnique({ where: { id: "default" }, select: { publishedAt: true } }),
    ]);
    // `portalEnabled` alone has a legacy default of true. Publication is the explicit public exposure gate.
    if (!settings.portalEnabled || !onboarding?.publishedAt) return null;
    return { tenantId: tenant.id, slug: tenant.slug, displayName: tenant.displayName, timeZone: tenant.timeZone, db, settings };
}

export async function withPublicTenantPortalApi(
    request: Request,
    slug: string,
    handler: (context: PublicPortalContext, id: string) => Promise<NextResponse>,
) {
    const id = requestId(request);
    try {
        if (!isMultitenantPublicPortalEnabled()) {
            throw new PublicPortalError("NOT_FOUND", "No se encontró el portal solicitado.");
        }
        const context = await resolvePublicPortalContext(slug);
        if (!context) throw new PublicPortalError("NOT_FOUND", "No se encontró el portal solicitado.");
        return await handler(context, id);
    } catch (error) {
        return errorResponse(error, id);
    }
}

function visibleServiceIds(value: unknown) {
    return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(id))
        : [];
}

function cleanIdentifier(value: unknown, field: string) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(text)) throw new PublicPortalError("VALIDATION_ERROR", `${field} no es válido.`);
    return text;
}

function cleanDate(value: unknown) {
    const date = typeof value === "string" ? value.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new PublicPortalError("VALIDATION_ERROR", "La fecha no es válida.");
    const [year, month, day] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new PublicPortalError("VALIDATION_ERROR", "La fecha no es válida.");
    }
    return date;
}

function cleanTime(value: unknown) {
    const time = typeof value === "string" ? value.trim() : "";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new PublicPortalError("VALIDATION_ERROR", "La hora no es válida.");
    return time;
}

function cleanText(value: unknown, field: string, maximum: number, required = false) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new PublicPortalError("VALIDATION_ERROR", `Completa ${field}.`);
    if (text.length > maximum) throw new PublicPortalError("VALIDATION_ERROR", `${field} no puede exceder ${maximum} caracteres.`);
    return text || null;
}

function cleanIdempotencyKey(request: Request) {
    const key = request.headers.get("idempotency-key")?.trim() || "";
    if (key.length < 16 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
        throw new PublicPortalError("VALIDATION_ERROR", "Envía un encabezado Idempotency-Key válido.");
    }
    return key;
}

function serializedPortal(context: PublicPortalContext, services: Array<{
    id: string; name: string; description: string | null; price: number; currency: string; durationMinutes: number; imageUrl: string | null; showPrice: boolean;
    specialists: Array<{ specialistId: string }>;
}>, specialists: Array<{ id: string; name: string; displayName: string | null; specialty: string | null; color: string | null; room: string | null; bio: string | null }>) {
    const operation = buildOperationContext(context.settings);
    return {
        slug: context.slug,
        clinicName: context.settings.portalClinicName || context.settings.clinicName || context.displayName,
        subtitle: context.settings.clinicSubtitle || "",
        intro: context.settings.portalIntro || "Aparta el horario que prefieras.",
        primaryColor: context.settings.portalPrimaryColor || "#4B5F25",
        socialLinks: publicPortalSocialLinks(context.settings.portalSocialLinks),
        paymentInstructions: context.settings.portalPaymentInstructions || null,
        logoUrl: context.settings.clinicLogoUrl || context.settings.brandLogoUrl || null,
        logoScale: context.settings.clinicLogoScale || 100,
        address: context.settings.clinicAddress || null,
        operationContext: {
            locale: operation.locale,
            timeZone: operation.timeZone,
            phoneDefaultCountry: operation.phoneDefaultCountry,
            callingCode: operation.callingCode,
        },
        scheduleSummary: formatBusinessScheduleSummary(normalizeBusinessHours(context.settings), operation.locale),
        specialists,
        services,
    };
}

export async function getPublicPortalData(context: PublicPortalContext) {
    const visibleIds = visibleServiceIds(context.settings.portalVisibleServiceIds);
    const where: Prisma.ServiceWhereInput = {
        isActive: true,
        category: { isActive: true },
        ...(visibleIds.length ? { id: { in: visibleIds } } : {}),
    };
    const [services, specialists] = await Promise.all([
        context.db.service.findMany({
            where,
            orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true, name: true, description: true, price: true, currency: true, durationMinutes: true, imageUrl: true, showPrice: true,
                specialists: { where: { specialist: { isActive: true } }, select: { specialistId: true } },
            },
        }),
        context.db.specialist.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true, displayName: true, specialty: true, color: true, room: true, bio: true },
        }),
    ]);
    return serializedPortal(context, services, specialists);
}

async function selectedServiceAndSpecialist(context: PublicPortalContext, rawServiceId: unknown, rawSpecialistId: unknown) {
    const serviceId = cleanIdentifier(rawServiceId, "El servicio");
    const specialistId = cleanIdentifier(rawSpecialistId, "El profesional");
    const visibleIds = visibleServiceIds(context.settings.portalVisibleServiceIds);
    if (visibleIds.length && !visibleIds.includes(serviceId)) throw new PublicPortalError("NOT_FOUND", "El servicio no está disponible en este portal.");
    const [service, specialist] = await Promise.all([
        context.db.service.findFirst({
            where: { id: serviceId, isActive: true, category: { isActive: true } },
            include: { specialists: { where: { specialist: { isActive: true } }, select: { specialistId: true } } },
        }),
        context.db.specialist.findFirst({ where: { id: specialistId, isActive: true }, select: { id: true, name: true, displayName: true, color: true } }),
    ]);
    if (!service || !specialist) throw new PublicPortalError("NOT_FOUND", "El servicio o profesional ya no está disponible.");
    if (service.specialists.length && !service.specialists.some((item) => item.specialistId === specialist.id)) {
        throw new PublicPortalError("CONFLICT", "El profesional seleccionado no realiza este servicio.");
    }
    return { service, specialist };
}

function slotWindow(context: PublicPortalContext, rawDate: unknown, rawTime: unknown, durationMinutes: number) {
    const date = cleanDate(rawDate);
    const time = cleanTime(rawTime);
    const schedule = normalizeBusinessHours(context.settings);
    const startTime = zonedDateTimeToUtc(date, time, schedule.timeZone);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const bounds = businessBoundsForDate(startTime, schedule);
    if (!bounds.isOpen || !isSameBusinessDate(startTime, endTime, schedule.timeZone) || startTime < bounds.start || endTime > bounds.end) {
        throw new PublicPortalError("CONFLICT", "Ese horario está fuera del horario de atención.");
    }
    if (startTime <= new Date()) throw new PublicPortalError("CONFLICT", "Selecciona un horario futuro.");
    return { date, time, startTime, endTime, schedule };
}

async function hasOperationalConflict(
    tx: Prisma.TransactionClient,
    specialistId: string,
    startTime: Date,
    endTime: Date,
) {
    const [appointment, block] = await Promise.all([
        tx.appointment.findFirst({
            where: { specialistId, status: { not: "cancelled" }, startTime: { lt: endTime }, endTime: { gt: startTime } },
            select: { id: true },
        }),
        tx.specialistAvailabilityBlock.findFirst({
            where: { OR: [{ specialistId }, { specialistId: null }], startTime: { lt: endTime }, endTime: { gt: startTime } },
            select: { id: true },
        }),
    ]);
    return Boolean(appointment || block);
}

export async function getPublicAvailability(context: PublicPortalContext, query: URLSearchParams) {
    const { service, specialist } = await selectedServiceAndSpecialist(context, query.get("serviceId"), query.get("specialistId"));
    const date = cleanDate(query.get("date"));
    const schedule = normalizeBusinessHours(context.settings);
    const probe = zonedDateTimeToUtc(date, "12:00", schedule.timeZone);
    const bounds = businessBoundsForDate(probe, schedule);
    if (!bounds.isOpen) return { date, isOpen: false, slots: [], schedule: { start: bounds.schedule.start, end: bounds.schedule.end } };
    const durationMinutes = Math.max(5, Math.min(480, service.durationMinutes));
    const [appointments, blocks, holds] = await Promise.all([
        context.db.appointment.findMany({
            where: { specialistId: specialist.id, status: { not: "cancelled" }, startTime: { lt: bounds.end }, endTime: { gt: bounds.start } },
            select: { startTime: true, endTime: true },
        }),
        context.db.specialistAvailabilityBlock.findMany({
            where: { OR: [{ specialistId: specialist.id }, { specialistId: null }], startTime: { lt: bounds.end }, endTime: { gt: bounds.start } },
            select: { startTime: true, endTime: true },
        }),
        context.db.publicAppointmentSlotHold.findMany({
            where: { calendarKey: `portal:${specialist.id}`, expiresAt: { gt: new Date() }, slotStart: { lt: bounds.end }, slotEnd: { gt: bounds.start } },
            select: { slotStart: true, slotEnd: true },
        }),
    ]);
    const slots: string[] = [];
    for (let minute = timeToMinutes(bounds.schedule.start); minute + durationMinutes <= timeToMinutes(bounds.schedule.end); minute += SLOT_INTERVAL_MINUTES) {
        const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        const startTime = zonedDateTimeToUtc(date, time, schedule.timeZone);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        const overlaps = [...appointments, ...blocks].some((item) => item.startTime < endTime && item.endTime > startTime);
        const held = holds.some((hold) => hold.slotStart < endTime && hold.slotEnd > startTime);
        if (startTime > new Date() && !held && !overlaps) slots.push(startTime.toISOString());
    }
    return { date, isOpen: true, slots, schedule: { start: bounds.schedule.start, end: bounds.schedule.end } };
}

export async function createPublicSlotHold(context: PublicPortalContext, request: Request, input: Record<string, unknown>) {
    const key = cleanIdempotencyKey(request);
    const { service, specialist } = await selectedServiceAndSpecialist(context, input.serviceId, input.specialistId);
    const window = slotWindow(context, input.date, input.time, Math.max(5, Math.min(480, service.durationMinutes)));
    const ownerKey = hashSecurityIdentifier(`portal-slot-hold:${context.tenantId}:${key}`);
    const calendarKey = `portal:${specialist.id}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_LIFETIME_MS);
    try {
        const result = await context.db.$transaction(async (tx) => {
            await tx.publicAppointmentSlotHold.deleteMany({ where: { calendarKey, expiresAt: { lte: now } } });
            const replay = await tx.publicAppointmentSlotHold.findFirst({
                where: { ownerKey, calendarKey, slotStart: window.startTime, slotEnd: window.endTime, expiresAt: { gt: now } },
                select: { expiresAt: true },
            });
            if (replay) return replay;
            if (await hasOperationalConflict(tx, specialist.id, window.startTime, window.endTime)) {
                throw new PublicPortalError("CONFLICT", "Ese horario acaba de ocuparse. Elige otro.");
            }
            return tx.publicAppointmentSlotHold.create({ data: { ownerKey, calendarKey, slotStart: window.startTime, slotEnd: window.endTime, expiresAt }, select: { expiresAt: true } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { holdToken: key, expiresAt: result.expiresAt.toISOString(), startsAt: window.startTime.toISOString() };
    } catch (error) {
        if (error instanceof PublicPortalError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
            throw new PublicPortalError("CONFLICT", "Ese horario acaba de ocuparse. Elige otro.");
        }
        throw error;
    }
}

function bookingToken(context: PublicPortalContext, idempotencyKey: string) {
    return hashSecurityIdentifier(`portal-booking-token:${context.tenantId}:${idempotencyKey}`);
}

function bookingTokenHash(token: string) {
    return hashSecurityIdentifier(`portal-booking-token-hash:${token}`);
}

function bookingIdempotencyHash(context: PublicPortalContext, key: string) {
    return hashSecurityIdentifier(`portal-booking-idempotency:${context.tenantId}:${key}`);
}

function patientNumber() {
    return `CLI-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function serializePublicBooking(appointment: {
    status: string; confirmationStatus: string; startTime: Date; endTime: Date; paymentStatus: string; paymentAmount: number; paymentCurrency: string; paymentMethod: string | null; cancellationReason: string | null;
    service: { name: string } | null; specialist: { name: string; displayName: string | null } | null;
}, context: PublicPortalContext) {
    return {
        clinicName: context.settings.portalClinicName || context.settings.clinicName || context.displayName,
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus,
        startsAt: appointment.startTime.toISOString(),
        endsAt: appointment.endTime.toISOString(),
        serviceName: appointment.service?.name || "Cita",
        specialistName: appointment.specialist?.displayName || appointment.specialist?.name || "Equipo",
        payment: { status: appointment.paymentStatus, amount: appointment.paymentAmount, currency: appointment.paymentCurrency, method: appointment.paymentMethod },
        cancellationReason: appointment.cancellationReason,
        cancellable: !["cancelled", "completed", "no_show"].includes(appointment.status) && appointment.startTime > new Date(),
    };
}

export async function createPublicBooking(context: PublicPortalContext, request: Request, input: Record<string, unknown>) {
    const idempotencyKey = cleanIdempotencyKey(request);
    const holdToken = typeof input.holdToken === "string" ? input.holdToken.trim() : "";
    if (!holdToken || holdToken.length > 200) throw new PublicPortalError("VALIDATION_ERROR", "El apartado de horario ya no es válido.");
    const { service, specialist } = await selectedServiceAndSpecialist(context, input.serviceId, input.specialistId);
    const window = slotWindow(context, input.date, input.time, Math.max(5, Math.min(480, service.durationMinutes)));
    const firstName = cleanText(input.firstName, "tu nombre", 80, true)!;
    const lastName = cleanText(input.lastName, "tu apellido", 100) || "";
    const email = cleanText(input.email, "tu correo", 254);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new PublicPortalError("VALIDATION_ERROR", "El correo no es válido.");
    const phone = normalizePhoneForOperation(cleanText(input.phone, "tu teléfono", 40, true), context.settings.phoneDefaultCountry);
    if (phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 15) {
        throw new PublicPortalError("VALIDATION_ERROR", "Ingresa un teléfono válido.");
    }
    const phoneLimit = await consumeSharedRateLimit({
        scope: "public-portal-booking-phone",
        identifiers: [context.tenantId, phone],
        limit: 4,
        windowMs: 30 * 60 * 1000,
    });
    if (!phoneLimit.allowed) throw new PublicPortalError("RATE_LIMITED", "Ese teléfono alcanzó el límite temporal de reservaciones.");
    const reason = cleanText(input.reason, "el motivo", 500) || service.name;
    const paymentMethod = ["efectivo", "tarjeta", "transferencia"].includes(String(input.paymentMethod || "")) ? String(input.paymentMethod) : "efectivo";
    const bookingKeyHash = bookingIdempotencyHash(context, idempotencyKey);
    const token = bookingToken(context, idempotencyKey);
    const tokenHash = bookingTokenHash(token);
    const ownerKey = hashSecurityIdentifier(`portal-slot-hold:${context.tenantId}:${holdToken}`);
    const calendarKey = `portal:${specialist.id}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + BOOKING_TOKEN_LIFETIME_MS);

    try {
        const appointment = await context.db.$transaction(async (tx) => {
            const replay = await tx.appointment.findUnique({ where: { bookingIdempotencyKeyHash: bookingKeyHash } });
            if (replay) return replay;
            const hold = await tx.publicAppointmentSlotHold.findFirst({
                where: { ownerKey, calendarKey, slotStart: window.startTime, expiresAt: { gt: now } },
                select: { id: true },
            });
            if (!hold) throw new PublicPortalError("CONFLICT", "El apartado venció. Elige el horario nuevamente.");
            if (await hasOperationalConflict(tx, specialist.id, window.startTime, window.endTime)) {
                throw new PublicPortalError("CONFLICT", "Ese horario acaba de ocuparse. Elige otro.");
            }
            const parsedPhone = parsePhoneByCountry(phone, context.settings.phoneDefaultCountry);
            const candidates = [...new Set([phone, parsedPhone.fullNumber, parsedPhone.nationalNumber].filter(Boolean))];
            const existingContact = await tx.contact.findFirst({
                where: { OR: [{ phone: { in: candidates } }, ...(parsedPhone.nationalNumber.length >= 8 ? [{ phone: { endsWith: parsedPhone.nationalNumber } }] : [])] },
                orderBy: { updatedAt: "desc" },
            });
            const contact = existingContact
                ? await tx.contact.update({ where: { id: existingContact.id }, data: { email: existingContact.email || email, status: "customer" } })
                : await tx.contact.create({ data: { name: firstName, lastName, phone, email, status: "customer", tags: ["Cliente"] } });
            const existingPatient = await tx.patient.findFirst({
                where: { OR: [{ contactId: contact.id }, { phone: { in: candidates } }] },
                orderBy: { updatedAt: "desc" },
            });
            const patient = existingPatient
                ? await tx.patient.update({ where: { id: existingPatient.id }, data: { contactId: contact.id, email: existingPatient.email || email } })
                : await tx.patient.create({ data: { patientNumber: patientNumber(), firstName, lastName, phone, email, contactId: contact.id } });
            const created = await tx.appointment.create({
                data: {
                    title: `${service.name} · ${`${firstName} ${lastName}`.trim()}`,
                    startTime: window.startTime,
                    endTime: window.endTime,
                    contactId: contact.id,
                    patientId: patient.id,
                    specialistId: specialist.id,
                    serviceId: service.id,
                    specialistName: specialist.displayName || specialist.name,
                    appointmentType: service.name,
                    source: "portal",
                    confirmationStatus: "pending",
                    paymentStatus: service.price > 0 ? "pending" : "unpaid",
                    paymentAmount: service.price,
                    paymentCurrency: service.currency,
                    paymentMethod,
                    notes: reason,
                    publicBookingTokenHash: tokenHash,
                    publicBookingTokenExpiresAt: expiresAt,
                    bookingIdempotencyKeyHash: bookingKeyHash,
                },
            });
            await tx.publicAppointmentSlotHold.delete({ where: { id: hold.id } });
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { bookingToken: token, booking: await publicBookingByAppointment(context, appointment.id) };
    } catch (error) {
        if (error instanceof PublicPortalError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
            const replay = await context.db.appointment.findUnique({ where: { bookingIdempotencyKeyHash: bookingKeyHash }, select: { id: true } });
            if (replay) return { bookingToken: token, booking: await publicBookingByAppointment(context, replay.id) };
            throw new PublicPortalError("CONFLICT", "Ese horario acaba de ocuparse. Elige otro.");
        }
        throw error;
    }
}

async function publicBookingByAppointment(context: PublicPortalContext, id: string) {
    const appointment = await context.db.appointment.findUnique({
        where: { id },
        select: {
            status: true, confirmationStatus: true, startTime: true, endTime: true, paymentStatus: true, paymentAmount: true, paymentCurrency: true, paymentMethod: true, cancellationReason: true,
            service: { select: { name: true } }, specialist: { select: { name: true, displayName: true } },
        },
    });
    if (!appointment) throw new PublicPortalError("NOT_FOUND", "La reservación ya no está disponible.");
    return serializePublicBooking(appointment, context);
}

function rawBookingToken(value: unknown) {
    const token = typeof value === "string" ? value.trim() : "";
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new PublicPortalError("NOT_FOUND", "La reservación ya no está disponible.");
    return token;
}

export async function getPublicBooking(context: PublicPortalContext, rawToken: unknown) {
    const token = rawBookingToken(rawToken);
    const appointment = await context.db.appointment.findFirst({
        where: { publicBookingTokenHash: bookingTokenHash(token), publicBookingTokenExpiresAt: { gt: new Date() } },
        select: { id: true },
    });
    if (!appointment) throw new PublicPortalError("NOT_FOUND", "La reservación ya no está disponible.");
    return publicBookingByAppointment(context, appointment.id);
}

export async function cancelPublicBooking(context: PublicPortalContext, rawToken: unknown) {
    const token = rawBookingToken(rawToken);
    const now = new Date();
    const appointment = await context.db.appointment.findFirst({
        where: { publicBookingTokenHash: bookingTokenHash(token), publicBookingTokenExpiresAt: { gt: now } },
        select: { id: true, status: true, startTime: true },
    });
    if (!appointment) throw new PublicPortalError("NOT_FOUND", "La reservación ya no está disponible.");
    if (!["cancelled", "completed", "no_show"].includes(appointment.status) && appointment.startTime > now) {
        await context.db.appointment.update({
            where: { id: appointment.id },
            data: { status: "cancelled", cancelledAt: now, cancellationReason: "Cancelada por cliente desde el portal." },
        });
    }
    return publicBookingByAppointment(context, appointment.id);
}

export async function enforcePublicPortalRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
    const result = await consumeSharedRateLimit({ scope, identifiers: [getRequestIp(request.headers)], limit, windowMs });
    if (!result.allowed) throw new PublicPortalError("RATE_LIMITED", "Demasiadas solicitudes. Intenta de nuevo en unos minutos.");
}
