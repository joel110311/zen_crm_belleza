import "server-only";
import { Prisma } from "@prisma/client";
import { normalizeServicePreparation } from "@/lib/services/preparation-requirements";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";
import {
    asRecord,
    booleanValue,
    identifier,
    numberValue,
    optionalText,
    stringArray,
    text,
} from "@/lib/tenant-services/validation";

const SERVICE_INCLUDE = {
    category: true,
    specialists: {
        include: { specialist: true },
        orderBy: { specialist: { name: "asc" as const } },
    },
    _count: { select: { appointments: true } },
};

export async function listServiceCatalog(context: TenantServiceContext) {
    assertTenantPermission(context, "services.read");
    const [categories, specialists] = await Promise.all([
        context.db.serviceCategory.findMany({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
                services: {
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                    include: SERVICE_INCLUDE,
                },
            },
        }),
        context.db.specialist.findMany({
            orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true, displayName: true, specialty: true, color: true, photoUrl: true, isActive: true },
        }),
    ]);
    return { categories, specialists };
}

export async function getService(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "services.read");
    const id = identifier(rawId);
    const service = await context.db.service.findUnique({ where: { id }, include: SERVICE_INCLUDE });
    if (!service) throw new TenantServiceError("NOT_FOUND", "El servicio ya no existe.");
    return service;
}

export async function createServiceCategory(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "services.write");
    const input = asRecord(rawInput);
    return context.db.serviceCategory.create({
        data: {
            name: text(input.name, "Nombre", { required: true, max: 160 }),
            description: optionalText(input.description, "Descripción", 500),
            color: text(input.color, "Color", { max: 20, fallback: "#B7923A" }) || "#B7923A",
            isActive: booleanValue(input.isActive, true),
            sortOrder: numberValue(input.sortOrder, "Orden", { fallback: 0, integer: true, min: -10000, max: 10000 }),
        },
    });
}

export async function updateServiceCategory(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "services.write");
    const id = identifier(rawId);
    const input = asRecord(rawInput);
    const current = await context.db.serviceCategory.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "La categoría ya no existe.");
    return context.db.serviceCategory.update({
        where: { id },
        data: {
            name: input.name === undefined ? undefined : text(input.name, "Nombre", { required: true, max: 160 }),
            description: input.description === undefined ? undefined : optionalText(input.description, "Descripción", 500),
            color: input.color === undefined ? undefined : text(input.color, "Color", { required: true, max: 20 }),
            isActive: input.isActive === undefined ? undefined : booleanValue(input.isActive, current.isActive),
            sortOrder: input.sortOrder === undefined ? undefined : numberValue(input.sortOrder, "Orden", { integer: true, min: -10000, max: 10000 }),
        },
    });
}

export async function deleteServiceCategory(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "services.write");
    const id = identifier(rawId);
    const category = await context.db.serviceCategory.findUnique({
        where: { id },
        include: { _count: { select: { services: true } } },
    });
    if (!category) throw new TenantServiceError("NOT_FOUND", "La categoría ya no existe.");
    if (category._count.services > 0) {
        throw new TenantServiceError("CONFLICT", "Mueve o elimina los servicios de esta categoría antes de borrarla.");
    }
    await context.db.serviceCategory.delete({ where: { id } });
    return { id, deleted: true };
}

function serviceData(rawInput: unknown, partial = false) {
    const input = asRecord(rawInput);
    const specialistIds = input.specialistIds === undefined && partial
        ? undefined
        : stringArray(input.specialistIds, "Especialistas", 50, 100);
    return {
        input,
        specialistIds,
        data: {
            name: input.name === undefined && partial ? undefined : text(input.name, "Nombre", { required: true, max: 160 }),
            description: input.description === undefined && partial ? undefined : optionalText(input.description, "Descripción", 1000),
            categoryId: input.categoryId === undefined && partial ? undefined : identifier(input.categoryId, "Categoría"),
            price: input.price === undefined && partial ? undefined : numberValue(input.price, "Precio", { fallback: 0, min: 0, max: 1000000 }),
            currency: input.currency === undefined && partial ? undefined : (text(input.currency, "Moneda", { max: 3, fallback: "MXN" }) || "MXN").toUpperCase(),
            durationMinutes: input.durationMinutes === undefined && partial ? undefined : numberValue(input.durationMinutes, "Duración", { fallback: 30, integer: true, min: 5, max: 480 }),
            preparationRequirements: input.preparationRequirements === undefined && partial
                ? undefined
                : normalizeServicePreparation(input.preparationRequirements) as unknown as Prisma.InputJsonValue,
            imageUrl: input.imageUrl === undefined && partial ? undefined : optionalText(input.imageUrl, "Imagen", 2000),
            showPrice: input.showPrice === undefined && partial ? undefined : booleanValue(input.showPrice, true),
            isFeatured: input.isFeatured === undefined && partial ? undefined : booleanValue(input.isFeatured, false),
            isActive: input.isActive === undefined && partial ? undefined : booleanValue(input.isActive, true),
            sortOrder: input.sortOrder === undefined && partial ? undefined : numberValue(input.sortOrder, "Orden", { fallback: 0, integer: true, min: -10000, max: 10000 }),
        },
    };
}

async function validateServiceRelations(context: TenantServiceContext, categoryId?: string, specialistIds?: string[]) {
    if (categoryId) {
        const category = await context.db.serviceCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!category) throw new TenantServiceError("VALIDATION_ERROR", "La categoría seleccionada ya no existe.", { field: "categoryId" });
    }
    if (specialistIds) {
        const count = await context.db.specialist.count({ where: { id: { in: specialistIds } } });
        if (count !== specialistIds.length) {
            throw new TenantServiceError("VALIDATION_ERROR", "Uno de los especialistas seleccionados ya no existe.", { field: "specialistIds" });
        }
    }
}

export async function createService(context: TenantServiceContext, rawInput: unknown) {
    assertTenantPermission(context, "services.write");
    const parsed = serviceData(rawInput);
    await validateServiceRelations(context, parsed.data.categoryId, parsed.specialistIds);
    return context.db.$transaction(async (tx) => {
        const saved = await tx.service.create({ data: parsed.data as Prisma.ServiceUncheckedCreateInput });
        if (parsed.specialistIds?.length) {
            await tx.specialistService.createMany({
                data: parsed.specialistIds.map((specialistId) => ({ serviceId: saved.id, specialistId })),
            });
        }
        return tx.service.findUniqueOrThrow({ where: { id: saved.id }, include: SERVICE_INCLUDE });
    });
}

export async function updateService(context: TenantServiceContext, rawId: unknown, rawInput: unknown) {
    assertTenantPermission(context, "services.write");
    const id = identifier(rawId);
    const current = await context.db.service.findUnique({ where: { id } });
    if (!current) throw new TenantServiceError("NOT_FOUND", "El servicio ya no existe.");
    const parsed = serviceData(rawInput, true);
    await validateServiceRelations(context, parsed.data.categoryId, parsed.specialistIds);
    return context.db.$transaction(async (tx) => {
        await tx.service.update({ where: { id }, data: parsed.data });
        if (parsed.specialistIds) {
            await tx.specialistService.deleteMany({ where: { serviceId: id } });
            if (parsed.specialistIds.length) {
                await tx.specialistService.createMany({
                    data: parsed.specialistIds.map((specialistId) => ({ serviceId: id, specialistId })),
                });
            }
        }
        return tx.service.findUniqueOrThrow({ where: { id }, include: SERVICE_INCLUDE });
    });
}

export async function deleteService(context: TenantServiceContext, rawId: unknown) {
    assertTenantPermission(context, "services.write");
    const id = identifier(rawId);
    const service = await context.db.service.findUnique({
        where: { id },
        include: { _count: { select: { appointments: true } } },
    });
    if (!service) throw new TenantServiceError("NOT_FOUND", "El servicio ya no existe.");
    if (service._count.appointments > 0) {
        throw new TenantServiceError("CONFLICT", "Este servicio tiene citas históricas. Desactívalo para conservar el historial.");
    }
    await context.db.service.delete({ where: { id } });
    return { id, deleted: true };
}
