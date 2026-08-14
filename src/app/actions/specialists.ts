"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { syncSpecialistsFromGoogleSources } from "@/lib/google-calendar";

const MAX_SPECIALISTS = 5;

type SpecialistInput = {
    id?: string;
    name: string;
    displayName?: string;
    specialty?: string;
    email?: string;
    phone?: string;
    professionalTitle?: string;
    professionalLicense?: string;
    color?: string;
    room?: string;
    bio?: string;
    photoUrl?: string;
    defaultDurationMinutes?: number;
    isActive?: boolean;
    sortOrder?: number;
    userId?: string | null;
    googleCalendarSourceId?: string | null;
};

type AvailabilityBlockInput = {
    id?: string;
    specialistId?: string | null;
    title: string;
    type?: string;
    startTime: string | Date;
    endTime: string | Date;
    notes?: string;
};

function cleanText(value?: string | null) {
    return value?.trim() || undefined;
}

function nullableText(value?: string | null) {
    return value?.trim() || null;
}

function parseDate(value: string | Date) {
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateSpecialistSurfaces() {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/reception");
    revalidatePath("/portal");
}

export async function getSpecialists(includeInactive = false) {
    if (includeInactive) {
        await requirePermission("specialists.manage");
    }

    return prisma.specialist.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
            },
            googleCalendarSource: true,
            availabilityBlocks: {
                orderBy: { startTime: "asc" },
                take: 20,
            },
            _count: {
                select: {
                    appointments: true,
                    availabilityBlocks: true,
                },
            },
        },
    });
}

export async function getSpecialistAssignableUsers() {
    await requirePermission("specialists.manage");

    return prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
        },
        orderBy: { name: "asc" },
    });
}

export async function syncSpecialistsFromGoogle() {
    await requirePermission("specialists.manage");

    try {
        const specialists = await syncSpecialistsFromGoogleSources();
        revalidateSpecialistSurfaces();
        return { success: true, specialists };
    } catch (error) {
        console.error("Failed to sync specialists from Google sources:", error);
        return { success: false, error: "No se pudieron sincronizar los especialistas de Google Calendar." };
    }
}

export async function saveSpecialist(input: SpecialistInput) {
    await requirePermission("specialists.manage");

    const name = cleanText(input.name);
    if (!name) {
        return { success: false, error: "El nombre del especialista es obligatorio." };
    }

    try {
        const wantsActive = input.isActive !== false;
        if (wantsActive) {
            const activeCount = await prisma.specialist.count({
                where: {
                    isActive: true,
                    ...(input.id ? { id: { not: input.id } } : {}),
                },
            });

            if (activeCount >= MAX_SPECIALISTS) {
                return { success: false, error: `Solo puedes tener hasta ${MAX_SPECIALISTS} especialistas activos.` };
            }
        }

        const data = {
            name,
            displayName: nullableText(input.displayName) || name,
            specialty: nullableText(input.specialty) || "Belleza",
            email: nullableText(input.email),
            phone: nullableText(input.phone),
            professionalTitle: nullableText(input.professionalTitle),
            professionalLicense: nullableText(input.professionalLicense),
            color: nullableText(input.color) || "#2563EB",
            room: nullableText(input.room),
            bio: nullableText(input.bio),
            photoUrl: nullableText(input.photoUrl),
            defaultDurationMinutes: Math.max(15, Math.min(180, Number(input.defaultDurationMinutes || 30))),
            isActive: wantsActive,
            sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
            userId: nullableText(input.userId),
            googleCalendarSourceId: nullableText(input.googleCalendarSourceId),
        };

        const specialist = input.id
            ? await prisma.specialist.update({
                where: { id: input.id },
                data,
                include: { googleCalendarSource: true },
            })
            : await prisma.specialist.create({
                data,
                include: { googleCalendarSource: true },
            });

        revalidateSpecialistSurfaces();
        return { success: true, specialist };
    } catch (error) {
        console.error("Failed to save specialist:", error);
        return { success: false, error: "No se pudo guardar el especialista." };
    }
}

export async function deactivateSpecialist(id: string) {
    await requirePermission("specialists.manage");

    try {
        await prisma.specialist.update({
            where: { id },
            data: { isActive: false },
        });
        revalidateSpecialistSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to deactivate specialist:", error);
        return { success: false, error: "No se pudo desactivar el especialista." };
    }
}

export async function deleteSpecialist(id: string) {
    await requirePermission("specialists.manage");

    try {
        const specialist = await prisma.specialist.findUnique({
            where: { id },
            select: {
                id: true,
                displayName: true,
                name: true,
                isActive: true,
                googleCalendarSourceId: true,
                _count: {
                    select: {
                        appointments: true,
                        patientConsultations: true,
                        cashMovements: true,
                        paymentLinks: true,
                    },
                },
            },
        });

        if (!specialist) {
            return { success: false, error: "El especialista ya no existe." };
        }

        if (specialist.isActive) {
            return { success: false, error: "Primero desactiva al especialista y después podrás eliminarlo." };
        }

        const historicalRecords =
            specialist._count.appointments
            + specialist._count.patientConsultations
            + specialist._count.cashMovements
            + specialist._count.paymentLinks;

        if (historicalRecords > 0) {
            return {
                success: false,
                error: `No se puede eliminar porque conserva ${historicalRecords} registro${historicalRecords === 1 ? "" : "s"} de citas, atención o cobros. Déjalo inactivo para preservar el historial.`,
            };
        }

        await prisma.$transaction(async (tx) => {
            if (specialist.googleCalendarSourceId) {
                await tx.googleCalendarSource.update({
                    where: { id: specialist.googleCalendarSourceId },
                    data: {
                        isSpecialist: false,
                        specialistName: null,
                    },
                });
            }

            await tx.specialist.delete({ where: { id } });
        });

        revalidateSpecialistSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to delete specialist:", error);
        return { success: false, error: "No se pudo eliminar el especialista." };
    }
}

export async function saveSpecialistAvailabilityBlock(input: AvailabilityBlockInput) {
    await requirePermission("specialists.manage");

    const title = cleanText(input.title);
    const startTime = parseDate(input.startTime);
    const endTime = parseDate(input.endTime);

    if (!title || !startTime || !endTime || endTime <= startTime) {
        return { success: false, error: "Captura titulo, inicio y fin validos para el bloqueo." };
    }

    try {
        const data = {
            specialistId: nullableText(input.specialistId),
            title,
            type: cleanText(input.type) || "block",
            startTime,
            endTime,
            notes: nullableText(input.notes),
        };

        const block = input.id
            ? await prisma.specialistAvailabilityBlock.update({ where: { id: input.id }, data })
            : await prisma.specialistAvailabilityBlock.create({ data });

        revalidateSpecialistSurfaces();
        return { success: true, block };
    } catch (error) {
        console.error("Failed to save specialist availability block:", error);
        return { success: false, error: "No se pudo guardar el bloqueo de agenda." };
    }
}

export async function deleteSpecialistAvailabilityBlock(id: string) {
    await requirePermission("specialists.manage");

    try {
        await prisma.specialistAvailabilityBlock.delete({ where: { id } });
        revalidateSpecialistSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to delete specialist availability block:", error);
        return { success: false, error: "No se pudo eliminar el bloqueo." };
    }
}
