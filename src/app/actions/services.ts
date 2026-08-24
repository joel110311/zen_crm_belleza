"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/authz";
import { normalizeServicePreparation, type ServicePreparationRequirements } from "@/lib/services/preparation-requirements";

export type ServiceCategoryInput = {
    id?: string;
    name: string;
    description?: string;
    color?: string;
    isActive?: boolean;
    sortOrder?: number;
};

export type ServiceInput = {
    id?: string;
    name: string;
    description?: string;
    categoryId: string;
    price?: number;
    currency?: string;
    durationMinutes?: number;
    preparationRequirements?: ServicePreparationRequirements;
    imageUrl?: string;
    showPrice?: boolean;
    isFeatured?: boolean;
    isActive?: boolean;
    sortOrder?: number;
    specialistIds?: string[];
};

const SERVICE_INCLUDE = {
    category: true,
    specialists: {
        include: { specialist: true },
        orderBy: { specialist: { name: "asc" as const } },
    },
    _count: { select: { appointments: true } },
};

function cleanText(value?: string | null) {
    return value?.trim() || "";
}

function revalidateServiceSurfaces() {
    revalidatePath("/dashboard/services");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/billing");
    revalidatePath("/portal", "layout");
}

export async function getServicesCatalog() {
    await requirePermission("services.manage");

    const [categories, specialists] = await Promise.all([
        prisma.serviceCategory.findMany({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
                services: {
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                    include: SERVICE_INCLUDE,
                },
            },
        }),
        prisma.specialist.findMany({
            orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                displayName: true,
                specialty: true,
                color: true,
                photoUrl: true,
                isActive: true,
            },
        }),
    ]);

    return { categories, specialists };
}

export async function getActiveServicesForBooking() {
    await requireAnyPermission(["calendar.manage", "reception.manage", "services.manage"]);

    return prisma.service.findMany({
        where: { isActive: true, category: { isActive: true } },
        orderBy: [
            { isFeatured: "desc" },
            { category: { sortOrder: "asc" } },
            { sortOrder: "asc" },
            { name: "asc" },
        ],
        include: {
            category: { select: { id: true, name: true, color: true } },
            specialists: {
                where: { specialist: { isActive: true } },
                select: { specialistId: true },
            },
        },
    });
}

export async function saveServiceCategory(input: ServiceCategoryInput) {
    await requirePermission("services.manage");

    const name = cleanText(input.name);
    if (!name) return { success: false, error: "El nombre de la categoría es obligatorio." };

    try {
        const data = {
            name,
            description: cleanText(input.description) || null,
            color: cleanText(input.color) || "#B7923A",
            isActive: input.isActive !== false,
            sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
        };
        const category = input.id
            ? await prisma.serviceCategory.update({ where: { id: input.id }, data })
            : await prisma.serviceCategory.create({ data });
        revalidateServiceSurfaces();
        return { success: true, category };
    } catch (error) {
        console.error("Failed to save service category:", error);
        return { success: false, error: "No se pudo guardar la categoría. Revisa que el nombre no esté repetido." };
    }
}

export async function deleteServiceCategory(id: string) {
    await requirePermission("services.manage");

    try {
        const serviceCount = await prisma.service.count({ where: { categoryId: id } });
        if (serviceCount > 0) {
            return { success: false, error: "Mueve o elimina los servicios de esta categoría antes de borrarla." };
        }
        await prisma.serviceCategory.delete({ where: { id } });
        revalidateServiceSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to delete service category:", error);
        return { success: false, error: "No se pudo eliminar la categoría." };
    }
}

export async function saveService(input: ServiceInput) {
    await requirePermission("services.manage");

    const name = cleanText(input.name);
    const categoryId = cleanText(input.categoryId);
    const durationMinutes = Math.max(5, Math.min(480, Number(input.durationMinutes || 30)));
    const price = Math.max(0, Number(input.price || 0));
    const specialistIds = [...new Set((input.specialistIds || []).map(cleanText).filter(Boolean))];

    if (!name || !categoryId) return { success: false, error: "Nombre y categoría son obligatorios." };
    if (!Number.isFinite(durationMinutes) || !Number.isFinite(price)) {
        return { success: false, error: "Captura una duración y un precio válidos." };
    }

    try {
        const [category, validSpecialists] = await Promise.all([
            prisma.serviceCategory.findUnique({ where: { id: categoryId }, select: { id: true } }),
            prisma.specialist.findMany({
                where: { id: { in: specialistIds } },
                select: { id: true },
            }),
        ]);
        if (!category) return { success: false, error: "La categoría seleccionada ya no existe." };
        if (validSpecialists.length !== specialistIds.length) {
            return { success: false, error: "Uno de los especialistas seleccionados ya no existe." };
        }

        const service = await prisma.$transaction(async (tx) => {
            const data = {
                name,
                description: cleanText(input.description) || null,
                categoryId,
                price,
                currency: cleanText(input.currency).toUpperCase() || "MXN",
                durationMinutes,
                preparationRequirements: normalizeServicePreparation(input.preparationRequirements) as unknown as Prisma.InputJsonValue,
                imageUrl: cleanText(input.imageUrl) || null,
                showPrice: input.showPrice !== false,
                isFeatured: Boolean(input.isFeatured),
                isActive: input.isActive !== false,
                sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
            };
            const saved = input.id
                ? await tx.service.update({ where: { id: input.id }, data })
                : await tx.service.create({ data });

            await tx.specialistService.deleteMany({ where: { serviceId: saved.id } });
            if (specialistIds.length > 0) {
                await tx.specialistService.createMany({
                    data: specialistIds.map((specialistId) => ({ specialistId, serviceId: saved.id })),
                });
            }
            return tx.service.findUniqueOrThrow({ where: { id: saved.id }, include: SERVICE_INCLUDE });
        });

        revalidateServiceSurfaces();
        return { success: true, service };
    } catch (error) {
        console.error("Failed to save service:", error);
        return { success: false, error: "No se pudo guardar el servicio. Revisa que el nombre no esté repetido." };
    }
}

export async function deleteService(id: string) {
    await requirePermission("services.manage");

    try {
        await prisma.service.delete({ where: { id } });
        revalidateServiceSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to delete service:", error);
        return { success: false, error: "No se pudo eliminar el servicio." };
    }
}

export async function updateServiceFlags(id: string, flags: { isActive?: boolean; isFeatured?: boolean }) {
    await requirePermission("services.manage");

    try {
        const service = await prisma.service.update({ where: { id }, data: flags, include: SERVICE_INCLUDE });
        revalidateServiceSurfaces();
        return { success: true, service };
    } catch (error) {
        console.error("Failed to update service flags:", error);
        return { success: false, error: "No se pudo actualizar el servicio." };
    }
}
