"use server";

import crypto from "crypto";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
    AppointmentSchedulingError,
    cancelManagedAppointment,
    createManagedAppointment,
    deleteManagedAppointment,
    updateManagedAppointment,
} from "@/lib/calendar/appointments";
import { syncGoogleCalendarToCrm } from "@/lib/google-calendar";
import {
    cancelAppointmentReminders,
    processDueAppointmentReminders,
    prepareManualAppointmentReminderDraft,
    retryAppointmentReminder,
    sendImmediateAppointmentReminder,
    syncAppointmentReminders,
    syncFutureAppointmentReminders,
} from "@/lib/appointment-reminders";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { requireAnyPermission, requirePermission } from "@/lib/authz";
import { buildOperationContext } from "@/lib/operation-context";
import { businessDayBounds } from "@/lib/calendar/business-hours";

const APPOINTMENT_INCLUDE = {
    user: true,
    contact: true,
    patient: true,
    specialist: true,
    service: true,
} as const;

function revalidateCalendarSurfaces() {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/reception");
    revalidatePath("/dashboard/patients");
}

function makePublicToken() {
    return crypto.randomUUID().replace(/-/g, "");
}

async function validateLinkedPatient(patientId: string | undefined | null) {
    const cleanPatientId = patientId?.trim();
    if (!cleanPatientId) {
        return {
            success: false as const,
            error: "Selecciona un paciente vinculado antes de agendar la cita.",
        };
    }

    const patient = await prisma.patient.findUnique({
        where: { id: cleanPatientId },
        select: { id: true },
    });

    if (!patient) {
        return {
            success: false as const,
            error: "El paciente seleccionado ya no existe. Actualiza el listado y vuelve a intentarlo.",
        };
    }

    return { success: true as const, patientId: cleanPatientId };
}

export async function getAppointments() {
    await requirePermission("calendar.manage");

    try {
        try {
            await syncGoogleCalendarToCrm(false);
        } catch (syncError) {
            console.error("[Google Calendar] Background sync failed while loading appointments:", syncError);
        }

        const settings = await prisma.systemSettings.findFirst({
            include: {
                googleCalendars: true,
            },
        });
        const visibleCalendarIds = settings?.googleCalendars
            .filter((source) => source.isSelected)
            .map((source) => source.calendarId) || [];

        return await prisma.appointment.findMany({
            where: {
                status: { not: "cancelled" },
                OR: [
                    { googleCalendarId: null },
                    ...(visibleCalendarIds.length > 0
                        ? [{ googleCalendarId: { in: visibleCalendarIds } }]
                        : []),
                ],
            },
            orderBy: { startTime: "asc" },
            include: APPOINTMENT_INCLUDE,
        });
    } catch (error) {
        console.error("Failed to get appointments:", error);
        return [];
    }
}

export async function createAppointment(data: {
    title: string;
    startTime: Date;
    endTime: Date;
    notes?: string;
    contactId?: string;
    patientId?: string;
    specialistId?: string;
    serviceId?: string;
    userId?: string;
    appointmentType?: string;
    source?: string;
    isFirstVisit?: boolean;
    isOverbook?: boolean;
    confirmationStatus?: string;
    remindersOptOut?: boolean;
    visitMode?: string;
    meetStatus?: string;
    meetLink?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    paymentCurrency?: string;
    paymentLinkUrl?: string;
    googleCalendarId?: string;
    googleCalendarName?: string;
    googleCalendarColor?: string;
    specialistName?: string;
    blockingCalendarIds?: string[];
}) {
    await requirePermission("calendar.manage");

    try {
        const patientValidation = await validateLinkedPatient(data.patientId);
        if (!patientValidation.success) return patientValidation;

        const appointment = await createManagedAppointment({
            ...data,
            patientId: patientValidation.patientId,
        });
        await syncAppointmentReminders(appointment.id);
        revalidateCalendarSurfaces();
        return { success: true, appointment };
    } catch (error) {
        console.error("Failed to create appointment:", error);
        if (error instanceof AppointmentSchedulingError) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "Failed to create appointment" };
    }
}

export async function updateAppointment(id: string, data: {
    title?: string;
    startTime?: Date;
    endTime?: Date;
    notes?: string;
    contactId?: string;
    patientId?: string;
    specialistId?: string;
    serviceId?: string;
    userId?: string;
    status?: string;
    appointmentType?: string;
    source?: string;
    isFirstVisit?: boolean;
    isOverbook?: boolean;
    confirmationStatus?: string;
    remindersOptOut?: boolean;
    visitMode?: string;
    meetStatus?: string;
    meetLink?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    paymentCurrency?: string;
    paymentLinkUrl?: string;
    googleCalendarId?: string;
    googleCalendarName?: string;
    googleCalendarColor?: string;
    specialistName?: string;
    blockingCalendarIds?: string[];
}) {
    await requirePermission("calendar.manage");

    try {
        const nextData = { ...data };
        if (Object.prototype.hasOwnProperty.call(nextData, "patientId")) {
            const patientValidation = await validateLinkedPatient(nextData.patientId);
            if (!patientValidation.success) return patientValidation;
            nextData.patientId = patientValidation.patientId;
        }

        const appointment = await updateManagedAppointment(id, nextData);
        await syncAppointmentReminders(id);
        revalidateCalendarSurfaces();
        return { success: true, appointment };
    } catch (error) {
        console.error("Failed to update appointment:", error);
        if (error instanceof AppointmentSchedulingError) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "Failed to update appointment" };
    }
}

export async function getReceptionAppointments(date?: string | Date) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const settings = await getSystemSettingsOrDefaults();
    const operationContext = buildOperationContext(settings);
    const { start, end } = businessDayBounds(date, operationContext.timeZone);

    return prisma.appointment.findMany({
        where: {
            startTime: { gte: start, lt: end },
            status: { not: "cancelled" },
        },
        orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
        include: {
            ...APPOINTMENT_INCLUDE,
            appointmentReminders: {
                orderBy: { offsetMinutes: "desc" },
            },
        },
    });
}

export async function getAppointmentRemindersByDate(date?: string | Date) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const settings = await getSystemSettingsOrDefaults();
    const operationContext = buildOperationContext(settings);
    const { start, end } = businessDayBounds(date, operationContext.timeZone);

    return prisma.appointmentReminder.findMany({
        where: {
            scheduledFor: { gte: start, lt: end },
        },
        orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
        include: {
            appointment: {
                select: {
                    id: true,
                    title: true,
                    startTime: true,
                    endTime: true,
                    status: true,
                    confirmationStatus: true,
                    patient: {
                        select: {
                            firstName: true,
                            lastName: true,
                            phone: true,
                        },
                    },
                    contact: {
                        select: {
                            name: true,
                            lastName: true,
                            phone: true,
                        },
                    },
                    specialist: {
                        select: {
                            name: true,
                            displayName: true,
                        },
                    },
                },
            },
        },
    });
}

export async function updateAppointmentStatus(id: string, nextStatus: string, reason?: string) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    try {
        if (nextStatus === "cancelled") {
            const appointment = await cancelManagedAppointment(
                id,
                reason?.trim() || "Cita cancelada desde el CRM.",
            );
            revalidateCalendarSurfaces();
            return { success: true, appointment };
        }

        const now = new Date();
        const data: Record<string, unknown> = {
            status: nextStatus,
            updatedAt: now,
        };

        if (nextStatus === "confirmed") {
            data.status = "scheduled";
            data.confirmationStatus = "confirmed";
            data.confirmedAt = now;
        }
        if (nextStatus === "waiting") {
            data.arrivalAt = now;
            data.confirmationStatus = "confirmed";
            data.confirmedAt = now;
        }
        if (nextStatus === "called") data.calledAt = now;
        if (nextStatus === "in_progress") data.startedAt = now;
        if (nextStatus === "completed") data.completedAt = now;
        if (nextStatus === "no_show") data.noShowAt = now;
        if (nextStatus === "scheduled") {
            data.confirmationStatus = "pending";
        }

        const appointment = await prisma.appointment.update({
            where: { id },
            data,
            include: APPOINTMENT_INCLUDE,
        });

        if (nextStatus === "confirmed") {
            await syncAppointmentReminders(id);
        } else if (["scheduled", "waiting", "called", "in_progress", "completed", "no_show"].includes(nextStatus)) {
            await cancelAppointmentReminders(
                id,
                nextStatus === "scheduled"
                    ? "La cita quedo pendiente de confirmacion."
                    : "La cita ya no requiere recordatorios automaticos.",
            );
        }

        revalidateCalendarSurfaces();
        return { success: true, appointment };
    } catch (error) {
        console.error("Failed to update appointment status:", error);
        return { success: false, error: "No se pudo actualizar el estado de la cita." };
    }
}

export async function cloneAppointmentAsOverbook(id: string) {
    await requirePermission("calendar.manage");

    try {
        const appointment = await prisma.appointment.findUnique({
            where: { id },
            include: APPOINTMENT_INCLUDE,
        });

        if (!appointment) {
            return { success: false, error: "La cita original no existe." };
        }

        const cloned = await createManagedAppointment({
            title: `${appointment.title} (sobreturno)`,
            startTime: appointment.startTime,
            endTime: appointment.endTime,
            notes: appointment.notes || undefined,
            contactId: appointment.contactId || undefined,
            patientId: appointment.patientId || undefined,
            specialistId: appointment.specialistId || undefined,
            userId: appointment.userId || undefined,
            appointmentType: appointment.appointmentType || "Consulta",
            source: "internal",
            isFirstVisit: appointment.isFirstVisit,
            isOverbook: true,
            confirmationStatus: "pending",
            remindersOptOut: appointment.remindersOptOut,
            visitMode: appointment.visitMode,
            meetStatus: appointment.meetStatus,
            meetLink: appointment.meetLink || undefined,
            paymentStatus: appointment.paymentAmount > 0 ? "pending" : "unpaid",
            paymentAmount: appointment.paymentAmount,
            paymentCurrency: appointment.paymentCurrency,
            paymentLinkUrl: appointment.paymentLinkUrl || undefined,
            googleCalendarId: appointment.googleCalendarId || undefined,
            googleCalendarName: appointment.googleCalendarName || undefined,
            googleCalendarColor: appointment.googleCalendarColor || undefined,
            specialistName: appointment.specialistName || undefined,
        });

        await prisma.appointment.update({
            where: { id: cloned.id },
            data: { parentAppointmentId: appointment.id },
        });

        revalidateCalendarSurfaces();
        return { success: true, appointment: cloned };
    } catch (error) {
        console.error("Failed to clone appointment:", error);
        return { success: false, error: "No se pudo crear el sobreturno." };
    }
}

export async function ensureAppointmentPublicToken(id: string) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const appointment = await prisma.appointment.findUnique({
        where: { id },
        select: { publicToken: true },
    });

    if (!appointment) {
        return { success: false, error: "La cita no existe." };
    }

    if (appointment.publicToken) {
        return { success: true, token: appointment.publicToken };
    }

    const updated = await prisma.appointment.update({
        where: { id },
        data: { publicToken: makePublicToken() },
        select: { publicToken: true },
    });

    return { success: true, token: updated.publicToken };
}

export async function sendAppointmentReminder(id: string) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const result = await sendImmediateAppointmentReminder(id);
    if (result.success) {
        revalidateCalendarSurfaces();
    }
    return result;
}

export async function prepareAppointmentReminderDraft(id: string) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const result = await prepareManualAppointmentReminderDraft(id);
    if (result.success) {
        revalidatePath("/dashboard/inbox");
    }
    return result;
}

export async function sendDueAppointmentReminders() {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    await syncFutureAppointmentReminders();
    const result = await processDueAppointmentReminders();
    revalidateCalendarSurfaces();
    return result;
}

export async function retryAppointmentReminderSend(reminderId: string) {
    await requireAnyPermission(["reception.manage", "calendar.manage"]);

    const result = await retryAppointmentReminder(reminderId);
    revalidateCalendarSurfaces();
    return result;
}

export async function getAppointmentByPublicToken(token: string) {
    const cleanToken = token.trim();
    if (!cleanToken) return null;

    return prisma.appointment.findUnique({
        where: { publicToken: cleanToken },
        include: APPOINTMENT_INCLUDE,
    });
}

export async function confirmAppointmentByToken(token: string) {
    void token;
    return {
        success: false,
        error: "La cita debe ser confirmada por la clinica.",
    };
}

export async function cancelAppointmentByToken(token: string, reason?: string) {
    const appointment = await getAppointmentByPublicToken(token);
    if (!appointment) {
        return { success: false, error: "No encontramos esta cita." };
    }

    await cancelManagedAppointment(
        appointment.id,
        reason?.trim() || "Cancelado por el paciente",
    );
    const updated = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
        include: APPOINTMENT_INCLUDE,
    });

    revalidateCalendarSurfaces();
    revalidatePath(`/portal/turno/${token}`);
    return { success: true, appointment: updated };
}

export async function deleteAppointment(id: string) {
    await requirePermission("calendar.manage");

    try {
        await deleteManagedAppointment(id);
        revalidateCalendarSurfaces();
        return { success: true };
    } catch (error) {
        console.error("Failed to delete appointment:", error);
        return { success: false, error: "Failed to delete appointment" };
    }
}
