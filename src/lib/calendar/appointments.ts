import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import {
    deleteAppointmentFromGoogleCalendar,
    getGoogleCalendarBookingContext,
    syncAppointmentToGoogleCalendar,
    syncGoogleCalendarToCrm,
} from "@/lib/google-calendar";
import {
    BusinessHoursConfig,
    businessBoundsForDate,
    formatDateTimeInZone,
    formatTimeLabel,
    getBusinessDateKey,
    normalizeBusinessHours,
    shiftDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";

type AppointmentInput = {
    title: string;
    startTime: Date;
    endTime: Date;
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
    publicToken?: string;
    visitMode?: string;
    meetStatus?: string;
    meetLink?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    paymentCurrency?: string;
    paymentMethod?: string;
    paymentLinkUrl?: string;
    googleCalendarId?: string | null;
    googleCalendarName?: string | null;
    googleCalendarColor?: string | null;
    specialistName?: string | null;
    blockingCalendarIds?: string[];
};

type ConflictCheckInput = {
    startTime: Date;
    endTime: Date;
    excludeAppointmentId?: string;
    specialistId?: string | null;
    googleCalendarId?: string | null;
    allowOverbook?: boolean;
    blockingCalendarIds?: string[];
};

type AvailableSlotOptions = {
    from?: Date;
    limit?: number;
    excludeAppointmentId?: string;
    specialistId?: string | null;
    calendarIds?: string[];
};

export class AppointmentSchedulingError extends Error {
    code: "INVALID_RANGE" | "PAST_DATE" | "OUTSIDE_BUSINESS_HOURS" | "TIME_CONFLICT";
    suggestions: Date[];

    constructor(
        code: AppointmentSchedulingError["code"],
        message: string,
        suggestions: Date[] = [],
    ) {
        super(message);
        this.code = code;
        this.suggestions = suggestions;
    }
}

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
    const settings = await getSystemSettingsOrDefaults();
    return normalizeBusinessHours(settings);
}

export async function findConflictingAppointments({
    startTime,
    endTime,
    excludeAppointmentId,
    specialistId,
    blockingCalendarIds,
}: ConflictCheckInput) {
    return prisma.appointment.findMany({
        where: {
            ...(excludeAppointmentId
                ? { id: { not: excludeAppointmentId } }
                : {}),
            status: { notIn: ["cancelled", "no_show"] },
            ...(specialistId
                ? { specialistId }
                : blockingCalendarIds && blockingCalendarIds.length > 0
                ? { googleCalendarId: { in: blockingCalendarIds } }
                : {}),
            startTime: { lt: endTime },
            endTime: { gt: startTime },
        },
        orderBy: { startTime: "asc" },
        include: {
            contact: true,
            patient: true,
        },
    });
}

async function findConflictingAvailabilityBlocks({
    startTime,
    endTime,
    specialistId,
}: ConflictCheckInput) {
    return prisma.specialistAvailabilityBlock.findMany({
        where: {
            OR: [
                { specialistId: specialistId || null },
                ...(specialistId ? [{ specialistId: null }] : []),
            ],
            startTime: { lt: endTime },
            endTime: { gt: startTime },
        },
        orderBy: { startTime: "asc" },
    });
}

export function formatAppointmentSuggestions(
    suggestions: Date[],
    config: BusinessHoursConfig,
) {
    return suggestions.map((slot) =>
        `- ${formatDateTimeInZone(slot, config.timeZone, "es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
        })}`,
    );
}

async function ensureAppointmentIsSchedulable(
    startTime: Date,
    endTime: Date,
    config: BusinessHoursConfig,
    excludeAppointmentId?: string,
    blockingCalendarIds?: string[],
    specialistId?: string | null,
    allowOverbook = false,
) {
    if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime()) || !(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
        throw new AppointmentSchedulingError("INVALID_RANGE", "La fecha u hora de la cita no son validas.");
    }

    if (endTime <= startTime) {
        throw new AppointmentSchedulingError("INVALID_RANGE", "La cita debe terminar despues de la hora de inicio.");
    }

    const now = new Date();
    if (startTime <= now) {
        const suggestions = await suggestAvailableSlots(now, endTime.getTime() - startTime.getTime(), config, {
            from: now,
            excludeAppointmentId,
            specialistId,
            calendarIds: blockingCalendarIds,
        });
        throw new AppointmentSchedulingError(
            "PAST_DATE",
            "Solo se pueden agendar citas desde este momento en adelante.",
            suggestions,
        );
    }

    const startBounds = businessBoundsForDate(startTime, config);
    const endBounds = businessBoundsForDate(endTime, config);

    if (
        !startBounds.isOpen ||
        startBounds.dateKey !== endBounds.dateKey ||
        startTime < startBounds.start ||
        endTime > startBounds.end
    ) {
        const suggestions = await suggestAvailableSlots(startTime, endTime.getTime() - startTime.getTime(), config, {
            from: startTime > startBounds.start ? startTime : startBounds.start,
            excludeAppointmentId,
        });
        const message = !startBounds.isOpen
            ? "Ese dia el negocio esta cerrado."
            : `La cita esta fuera del horario comercial de ese dia (${formatTimeLabel(startBounds.schedule.start)} - ${formatTimeLabel(startBounds.schedule.end)}).`;
        throw new AppointmentSchedulingError(
            "OUTSIDE_BUSINESS_HOURS",
            message,
            suggestions,
        );
    }

    const conflicts = allowOverbook
        ? []
        : await findConflictingAppointments({
            startTime,
            endTime,
            excludeAppointmentId,
            specialistId,
            blockingCalendarIds,
        });

    const blockConflicts = allowOverbook
        ? []
        : await findConflictingAvailabilityBlocks({
            startTime,
            endTime,
            specialistId,
        });

    if (conflicts.length > 0 || blockConflicts.length > 0) {
        const suggestions = await suggestAvailableSlots(startTime, endTime.getTime() - startTime.getTime(), config, {
            from: startTime,
            limit: 3,
            excludeAppointmentId,
            specialistId,
            calendarIds: blockingCalendarIds,
        });
        throw new AppointmentSchedulingError(
            "TIME_CONFLICT",
            blockConflicts.length > 0
                ? "Ese horario esta bloqueado para el especialista."
                : "Ya existe otra cita ocupando ese horario.",
            suggestions,
        );
    }
}

export async function validateManagedAppointment(
    input: ConflictCheckInput,
) {
    const config = await getBusinessHoursConfig();
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : input.googleCalendarId
                ? [input.googleCalendarId]
                : undefined;
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before validation:", syncError);
    }

    await ensureAppointmentIsSchedulable(
        input.startTime,
        input.endTime,
        config,
        input.excludeAppointmentId,
        blockingCalendarIds,
        input.specialistId,
        input.allowOverbook,
    );

    return config;
}

export async function suggestAvailableSlots(
    reference: Date,
    durationMs: number,
    config: BusinessHoursConfig,
    options: AvailableSlotOptions = {},
) {
    const stepMs = 15 * 60 * 1000;
    const safeDurationMs = Math.max(durationMs, 15 * 60 * 1000);
    const limit = options.limit ?? 3;
    const suggestions: Date[] = [];

    for (let dayOffset = 0; dayOffset < 10 && suggestions.length < limit; dayOffset += 1) {
        const dateKey = shiftDateKey(getBusinessDateKey(reference, config.timeZone), dayOffset);
        const dayReference = zonedDateTimeToUtc(dateKey, "12:00", config.timeZone);
        const dayBounds = businessBoundsForDate(dayReference, config);

        if (!dayBounds.isOpen) {
            continue;
        }

        const dayStart = dayBounds.start;
        const dayEnd = dayBounds.end;
        const dayAppointments = await prisma.appointment.findMany({
            where: {
                ...(options.excludeAppointmentId
                    ? { id: { not: options.excludeAppointmentId } }
                    : {}),
                ...(options.calendarIds && options.calendarIds.length > 0
                    ? { googleCalendarId: { in: options.calendarIds } }
                    : {}),
                ...(options.specialistId
                    ? { specialistId: options.specialistId }
                    : {}),
                status: { notIn: ["cancelled", "no_show"] },
                startTime: { lt: dayEnd },
                endTime: { gt: dayStart },
            },
            orderBy: { startTime: "asc" },
        });
        const dayBlocks = await prisma.specialistAvailabilityBlock.findMany({
            where: {
                OR: [
                    { specialistId: options.specialistId || null },
                    ...(options.specialistId ? [{ specialistId: null }] : []),
                ],
                startTime: { lt: dayEnd },
                endTime: { gt: dayStart },
            },
            orderBy: { startTime: "asc" },
        });

        const firstCursor = options.from && dayOffset === 0 && options.from > dayStart
            ? new Date(Math.ceil(options.from.getTime() / stepMs) * stepMs)
            : dayStart;

        for (let cursor = firstCursor.getTime(); cursor + safeDurationMs <= dayEnd.getTime(); cursor += stepMs) {
            const slotStart = new Date(cursor);
            const slotEnd = new Date(cursor + safeDurationMs);

            const conflict = dayAppointments.some((appointment) =>
                appointment.startTime < slotEnd && appointment.endTime > slotStart,
            ) || dayBlocks.some((block) =>
                block.startTime < slotEnd && block.endTime > slotStart,
            );

            if (!conflict) {
                suggestions.push(slotStart);
            }

            if (suggestions.length >= limit) {
                break;
            }
        }
    }

    return suggestions;
}

export async function getAvailableSlotsForDate(
    localDate: string,
    durationMs: number,
    config: BusinessHoursConfig,
    options: AvailableSlotOptions = {},
) {
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before availability lookup:", syncError);
    }

    const stepMs = 15 * 60 * 1000;
    const safeDurationMs = Math.max(durationMs, 15 * 60 * 1000);
    const limit = options.limit ?? 6;
    const dayReference = zonedDateTimeToUtc(localDate, "12:00", config.timeZone);
    const dayBounds = businessBoundsForDate(dayReference, config);

    if (!dayBounds.isOpen) {
        return {
            ...dayBounds,
            slots: [] as Date[],
        };
    }

    const dayAppointments = await prisma.appointment.findMany({
        where: {
            ...(options.excludeAppointmentId
                ? { id: { not: options.excludeAppointmentId } }
                : {}),
            ...(options.calendarIds && options.calendarIds.length > 0
                ? { googleCalendarId: { in: options.calendarIds } }
                : {}),
            ...(options.specialistId
                ? { specialistId: options.specialistId }
                : {}),
            status: { notIn: ["cancelled", "no_show"] },
            startTime: { lt: dayBounds.end },
            endTime: { gt: dayBounds.start },
        },
        orderBy: { startTime: "asc" },
    });
    const dayBlocks = await prisma.specialistAvailabilityBlock.findMany({
        where: {
            OR: [
                { specialistId: options.specialistId || null },
                ...(options.specialistId ? [{ specialistId: null }] : []),
            ],
            startTime: { lt: dayBounds.end },
            endTime: { gt: dayBounds.start },
        },
        orderBy: { startTime: "asc" },
    });

    const now = new Date();
    const todayKey = getBusinessDateKey(now, config.timeZone);
    const from = options.from && getBusinessDateKey(options.from, config.timeZone) === dayBounds.dateKey
        ? options.from
        : null;
    const lowerBound = todayKey === dayBounds.dateKey && now > dayBounds.start
        ? now
        : dayBounds.start;
    const firstCursor = new Date(
        Math.ceil(Math.max(lowerBound.getTime(), from?.getTime() || dayBounds.start.getTime()) / stepMs) * stepMs,
    );
    const slots: Date[] = [];

    for (let cursor = firstCursor.getTime(); cursor + safeDurationMs <= dayBounds.end.getTime(); cursor += stepMs) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(cursor + safeDurationMs);
        const conflict = dayAppointments.some((appointment) =>
            appointment.startTime < slotEnd && appointment.endTime > slotStart,
        ) || dayBlocks.some((block) =>
            block.startTime < slotEnd && block.endTime > slotStart,
        );

        if (!conflict) {
            slots.push(slotStart);
        }

        if (slots.length >= limit) {
            break;
        }
    }

    return {
        ...dayBounds,
        slots,
    };
}

export async function createManagedAppointment(input: AppointmentInput) {
    const config = await getBusinessHoursConfig();
    const settings = await getSystemSettingsOrDefaults();
    const defaultPaymentCurrency = settings.paymentDefaultCurrency || "MXN";
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before create:", syncError);
    }
    const bookingContext = await getGoogleCalendarBookingContext();
    const specialist = input.specialistId
        ? await prisma.specialist.findUnique({
            where: { id: input.specialistId },
            include: { googleCalendarSource: true },
        })
        : null;
    const specialistSource = specialist?.googleCalendarSource &&
        specialist.googleCalendarSource.isSelected &&
        specialist.googleCalendarSource.accessRole &&
        ["writer", "owner"].includes(specialist.googleCalendarSource.accessRole.toLowerCase())
        ? specialist.googleCalendarSource
        : null;
    const resolvedWriteTarget =
        specialistSource ||
        (input.googleCalendarId
            ? bookingContext.allSources.find((source) => source.calendarId === input.googleCalendarId)
            : null) ||
        bookingContext.writeTarget;
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : resolvedWriteTarget?.calendarId
                ? [resolvedWriteTarget.calendarId]
                : undefined;

    await ensureAppointmentIsSchedulable(
        input.startTime,
        input.endTime,
        config,
        undefined,
        blockingCalendarIds,
        input.specialistId,
        Boolean(input.isOverbook),
    );

    const appointment = await prisma.appointment.create({
        data: {
            title: input.title,
            startTime: input.startTime,
            endTime: input.endTime,
            notes: input.notes,
            contactId: input.contactId,
            patientId: input.patientId,
            specialistId: input.specialistId,
            serviceId: input.serviceId,
            userId: input.userId,
            status: input.status || "scheduled",
            appointmentType: input.appointmentType || "Consulta",
            source: input.source || "internal",
            isFirstVisit: Boolean(input.isFirstVisit),
            isOverbook: Boolean(input.isOverbook),
            confirmationStatus: input.confirmationStatus || "pending",
            remindersOptOut: Boolean(input.remindersOptOut),
            publicToken: input.publicToken,
            visitMode: input.visitMode || "presencial",
            meetStatus: input.meetStatus || "none",
            meetLink: input.meetLink,
            paymentStatus: input.paymentStatus || "unpaid",
            paymentAmount: Number(input.paymentAmount || 0),
            paymentCurrency: input.paymentCurrency || defaultPaymentCurrency,
            paymentMethod: input.paymentMethod || "local",
            paymentLinkUrl: input.paymentLinkUrl,
            googleCalendarId: input.googleCalendarId || resolvedWriteTarget?.calendarId || null,
            googleCalendarName: input.googleCalendarName || resolvedWriteTarget?.summary || null,
            googleCalendarColor: input.googleCalendarColor || resolvedWriteTarget?.backgroundColor || null,
            specialistName: input.specialistName || specialist?.displayName || specialist?.name || resolvedWriteTarget?.specialistName || null,
        },
        include: {
            contact: true,
            patient: true,
            specialist: true,
            user: true,
        },
    });

    try {
        await syncAppointmentToGoogleCalendar(appointment.id);
    } catch (syncError) {
        console.error("[Google Calendar] Push failed after create:", syncError);
    }
    return appointment;
}

export async function updateManagedAppointment(id: string, input: Partial<AppointmentInput>) {
    const existing = await prisma.appointment.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new Error("La cita no existe.");
    }

    const startTime = input.startTime || existing.startTime;
    const endTime = input.endTime || existing.endTime;
    const specialistId = input.specialistId === undefined ? existing.specialistId : input.specialistId;
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : existing.googleCalendarId
                ? [existing.googleCalendarId]
                : undefined;
    const config = await getBusinessHoursConfig();
    const settings = await getSystemSettingsOrDefaults();
    const defaultPaymentCurrency = settings.paymentDefaultCurrency || "MXN";
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before update:", syncError);
    }
    const scheduleChanged =
        input.startTime !== undefined ||
        input.endTime !== undefined ||
        input.specialistId !== undefined ||
        input.googleCalendarId !== undefined ||
        input.blockingCalendarIds !== undefined ||
        input.isOverbook !== undefined;
    if (scheduleChanged) {
        await ensureAppointmentIsSchedulable(
            startTime,
            endTime,
            config,
            id,
            blockingCalendarIds,
            specialistId,
            Boolean(input.isOverbook ?? existing.isOverbook),
        );
    }

    const specialist = specialistId
        ? await prisma.specialist.findUnique({
            where: { id: specialistId },
            include: { googleCalendarSource: true },
        })
        : null;

    const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
    };
    if (input.title !== undefined) updateData.title = input.title;
    if (input.startTime !== undefined) updateData.startTime = input.startTime;
    if (input.endTime !== undefined) updateData.endTime = input.endTime;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.contactId !== undefined) updateData.contactId = input.contactId || null;
    if (input.patientId !== undefined) updateData.patientId = input.patientId || null;
    if (input.specialistId !== undefined) updateData.specialistId = input.specialistId || null;
    if (input.serviceId !== undefined) updateData.serviceId = input.serviceId || null;
    if (input.userId !== undefined) updateData.userId = input.userId || null;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.appointmentType !== undefined) updateData.appointmentType = input.appointmentType;
    if (input.source !== undefined) updateData.source = input.source;
    if (input.isFirstVisit !== undefined) updateData.isFirstVisit = Boolean(input.isFirstVisit);
    if (input.isOverbook !== undefined) updateData.isOverbook = Boolean(input.isOverbook);
    if (input.confirmationStatus !== undefined) updateData.confirmationStatus = input.confirmationStatus;
    if (input.remindersOptOut !== undefined) updateData.remindersOptOut = Boolean(input.remindersOptOut);
    if (input.publicToken !== undefined) updateData.publicToken = input.publicToken || null;
    if (input.visitMode !== undefined) updateData.visitMode = input.visitMode || "presencial";
    if (input.meetStatus !== undefined) updateData.meetStatus = input.meetStatus || "none";
    if (input.meetLink !== undefined) updateData.meetLink = input.meetLink || null;
    if (input.paymentStatus !== undefined) updateData.paymentStatus = input.paymentStatus;
    if (input.paymentAmount !== undefined) updateData.paymentAmount = Number(input.paymentAmount || 0);
    if (input.paymentCurrency !== undefined) updateData.paymentCurrency = input.paymentCurrency || defaultPaymentCurrency;
    if (input.paymentMethod !== undefined) updateData.paymentMethod = input.paymentMethod || "local";
    if (input.paymentLinkUrl !== undefined) updateData.paymentLinkUrl = input.paymentLinkUrl || null;
    if (input.googleCalendarId !== undefined) updateData.googleCalendarId = input.googleCalendarId || null;
    if (input.googleCalendarName !== undefined) updateData.googleCalendarName = input.googleCalendarName || null;
    if (input.googleCalendarColor !== undefined) updateData.googleCalendarColor = input.googleCalendarColor || null;
    if (input.specialistName !== undefined) updateData.specialistName = input.specialistName || null;
    if (specialist && input.specialistId !== undefined) {
        updateData.specialistName = specialist.displayName || specialist.name;
        if (specialist.googleCalendarSource) {
            updateData.googleCalendarId = specialist.googleCalendarSource.calendarId;
            updateData.googleCalendarName = specialist.googleCalendarSource.summary;
            updateData.googleCalendarColor = specialist.googleCalendarSource.backgroundColor;
        }
    }

    const appointment = await prisma.appointment.update({
        where: { id },
        data: updateData,
        include: {
            contact: true,
            patient: true,
            specialist: true,
            user: true,
        },
    });

    try {
        await syncAppointmentToGoogleCalendar(appointment.id);
    } catch (syncError) {
        console.error("[Google Calendar] Push failed after update:", syncError);
    }
    return appointment;
}

export async function deleteManagedAppointment(id: string) {
    try {
        await deleteAppointmentFromGoogleCalendar(id);
    } catch (syncError) {
        console.error("[Google Calendar] Delete sync failed:", syncError);
    }
    return prisma.appointment.delete({
        where: { id },
    });
}
