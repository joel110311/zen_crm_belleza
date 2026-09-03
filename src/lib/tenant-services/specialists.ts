import "server-only";
import type { Prisma } from "@prisma/client";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";
import {
    asRecord,
    booleanValue,
    dateValue,
    emailValue,
    identifier,
    numberValue,
    optionalText,
    text,
} from "@/lib/tenant-services/validation";

const MAX_ACTIVE_SPECIALISTS = 5;

const SPECIALIST_INCLUDE = {
    user: { select: { id: true, name: true, email: true, role: true } },
    availabilityBlocks: { orderBy: { startTime: "asc" as const }, take: 30 },
    services: { include: { service: { select: { id: true, name: true, isActive: true } } } },
    _count: { select: { appointments: true, availabilityBlocks: true } },
};

export async function listSpecialists(context: TenantServiceContext, includeInactive = false) {
    assertTenantPermission(context, "specialists.read");
    const canSeeInactive = context.role === "OWNER" || context.role === "ADMIN";
    return context.db.specialist.findMany({
        where: includeInactive && canSeeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: SPECIALIST_INCLUDE,
    });
}

export async function getSpecialist(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "specialists.read");
    const id = identifier(rawId);
    const specialist = await context.db.specialist.findUnique({ where: { id }, include: SPECIALIST_INCLUDE });
    if (!specialist) throw new TenantServiceError("NOT_FOUND", "El especialista ya no existe.");
    return specialist;
}

function specialistData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    const parsedName = input.name === undefined && partial ? undefined : text(input.name, "Nombre", { required: true, max: 160 });
    return {
        name: parsedName,
        displayName: input.displayName === undefined && partial
            ? undefined
            : optionalText(input.displayName, "Nombre visible", 160) || parsedName,
        specialty: input.specialty === undefined && partial ? undefined : optionalText(input.specialty, "Especialidad", 160) || "Belleza",
        email: input.email === undefined && partial ? undefined : emailValue(input.email),
        phone: input.phone === undefined && partial ? undefined : optionalText(input.phone, "Teléfono", 40),
        professionalTitle: input.professionalTitle === undefined && partial ? undefined : optionalText(input.professionalTitle, "Título profesional", 160),
        professionalLicense: input.professionalLicense === undefined && partial ? undefined : optionalText(input.professionalLicense, "Cédula profesional", 100),
        color: input.color === undefined && partial ? undefined : text(input.color, "Color", { max: 20, fallback: "#2563EB" }) || "#2563EB",
        room: input.room === undefined && partial ? undefined : optionalText(input.room, "Consultorio", 100),
        bio: input.bio === undefined && partial ? undefined : optionalText(input.bio, "Biografía", 2000),
        photoUrl: input.photoUrl === undefined && partial ? undefined : optionalText(input.photoUrl, "Foto", 2000),
        defaultDurationMinutes: input.defaultDurationMinutes === undefined && partial
            ? undefined
            : numberValue(input.defaultDurationMinutes, "Duración predeterminada", { fallback: 30, integer: true, min: 15, max: 180 }),
        isActive: input.isActive === undefined && partial ? undefined : booleanValue(input.isActive, true),
        sortOrder: input.sortOrder === undefined && partial
            ? undefined
            : numberValue(input.sortOrder, "Orden", { fallback: 0, integer: true, min: -10000, max: 10000 }),
        userId: input.userId === undefined && partial ? undefined : optionalText(input.userId, "Usuario", 100),
    };
}

async function ensureActiveLimit(context: TenantServiceContext, requestedActive: boolean | undefined, excludeId?: string) {
    if (requestedActive === false) return;
    const count = await context.db.specialist.count({
        where: { isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (count >= MAX_ACTIVE_SPECIALISTS) {
        throw new TenantServiceError("CONFLICT", `Solo puedes tener hasta ${MAX_ACTIVE_SPECIALISTS} especialistas activos.`);
    }
}

async function ensureUserExists(context: TenantServiceContext, userId: string | null | undefined) {
    if (!userId) return;
    const user = await context.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new TenantServiceError("VALIDATION_ERROR", "El usuario seleccionado no pertenece a este negocio.", { field: "userId" });
}

export async function createSpecialist(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "specialists.write");
    const data = specialistData(rawInput);
    await Promise.all([ensureActiveLimit(context, data.isActive), ensureUserExists(context, data.userId)]);
    return context.db.specialist.create({ data: data as Prisma.SpecialistUncheckedCreateInput, include: SPECIALIST_INCLUDE });
}

export async function updateSpecialist(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "specialists.write");
    const id = identifier(rawId);
    const current = await context.db.specialist.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El especialista ya no existe.");
    const data = specialistData(rawInput, true);
    if (data.isActive === true && !current.isActive) await ensureActiveLimit(context, true, id);
    await ensureUserExists(context, data.userId);
    return context.db.specialist.update({ where: { id }, data, include: SPECIALIST_INCLUDE });
}

export async function deleteSpecialist(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "specialists.write");
    const id = identifier(rawId);
    const specialist = await context.db.specialist.findUnique({
        where: { id },
        include: {
            _count: { select: { appointments: true, patientConsultations: true, cashMovements: true, paymentLinks: true } },
        },
    });
    if (!specialist) throw new TenantServiceError("NOT_FOUND", "El especialista ya no existe.");
    if (specialist.isActive) {
        throw new TenantServiceError("CONFLICT", "Primero desactiva al especialista y después podrás eliminarlo.");
    }
    const history = Object.values(specialist._count).reduce((sum, count) => sum + count, 0);
    if (history > 0) {
        throw new TenantServiceError("CONFLICT", `El especialista conserva ${history} registros históricos. Déjalo inactivo.`);
    }
    await context.db.specialist.delete({ where: { id } });
    return { id, deleted: true };
}

async function assertBlockScope(context: TenantServiceContext, specialistId: string | null) {
    if (specialistId) {
        const specialist = await context.db.specialist.findUnique({ where: { id: specialistId }, select: { id: true, userId: true } });
        if (!specialist) throw new TenantServiceError("VALIDATION_ERROR", "El especialista ya no existe.", { field: "specialistId" });
        if (context.role === "PROFESSIONAL" && specialist.userId !== context.actor.id) {
            throw new TenantServiceError("FORBIDDEN", "Solo puedes administrar tus propios bloqueos de agenda.");
        }
    } else if (context.role === "PROFESSIONAL") {
        throw new TenantServiceError("FORBIDDEN", "Un profesional no puede bloquear toda la agenda del negocio.");
    }
}

function availabilityData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    const startTime = input.startTime === undefined && partial ? undefined : dateValue(input.startTime, "Inicio", { required: true })!;
    const endTime = input.endTime === undefined && partial ? undefined : dateValue(input.endTime, "Fin", { required: true })!;
    if (startTime && endTime && endTime <= startTime) {
        throw new TenantServiceError("VALIDATION_ERROR", "La hora de fin debe ser posterior al inicio.");
    }
    return {
        specialistId: input.specialistId === undefined && partial ? undefined : optionalText(input.specialistId, "Especialista", 100),
        title: input.title === undefined && partial ? undefined : text(input.title, "Título", { required: true, max: 160 }),
        type: input.type === undefined && partial ? undefined : text(input.type, "Tipo", { max: 40, fallback: "block" }) || "block",
        startTime,
        endTime,
        notes: input.notes === undefined && partial ? undefined : optionalText(input.notes, "Notas", 1000),
    };
}

export async function listAvailabilityBlocks(context: TenantServiceContext, rawSpecialistId: unknown) {
    assertTenantPermission(context, "calendar.read");
    const specialistId = identifier(rawSpecialistId, "Especialista");
    await assertBlockScope(context, specialistId);
    return context.db.specialistAvailabilityBlock.findMany({
        where: { specialistId },
        orderBy: { startTime: "asc" },
    });
}

export async function createAvailabilityBlock(context: TenantServiceContext, rawSpecialistId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "calendar.write");
    const specialistId = identifier(rawSpecialistId, "Especialista");
    await assertBlockScope(context, specialistId);
    const data = availabilityData(rawInput);
    return context.db.specialistAvailabilityBlock.create({
        data: { ...data, specialistId } as Prisma.SpecialistAvailabilityBlockUncheckedCreateInput,
    });
}

export async function updateAvailabilityBlock(context: TenantServiceContext, rawBlockId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "calendar.write");
    const id = identifier(rawBlockId, "Bloqueo");
    const current = await context.db.specialistAvailabilityBlock.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El bloqueo ya no existe.");
    await assertBlockScope(context, current.specialistId);
    const data = availabilityData(rawInput, true);
    const startTime = data.startTime || current.startTime;
    const endTime = data.endTime || current.endTime;
    if (endTime <= startTime) throw new TenantServiceError("VALIDATION_ERROR", "La hora de fin debe ser posterior al inicio.");
    if (data.specialistId !== undefined) await assertBlockScope(context, data.specialistId);
    return context.db.specialistAvailabilityBlock.update({ where: { id }, data });
}

export async function deleteAvailabilityBlock(context: TenantServiceContext, rawBlockId: unknown) {
    assertTenantPermission(context, "calendar.write");
    const id = identifier(rawBlockId, "Bloqueo");
    const current = await context.db.specialistAvailabilityBlock.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El bloqueo ya no existe.");
    await assertBlockScope(context, current.specialistId);
    await context.db.specialistAvailabilityBlock.delete({ where: { id } });
    return { id, deleted: true };
}
