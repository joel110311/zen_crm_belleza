import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import { normalizeBusinessPolicies, type SpecialistAssignmentMode } from "@/lib/ai/business-policies";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import {
    AppointmentSchedulingError,
    cancelManagedAppointment,
    createManagedAppointment,
    formatAppointmentSuggestions,
    getAvailableSlotsForDate,
    getBusinessHoursConfig,
    releaseAppointmentSlotHold,
    updateManagedAppointment,
    validateManagedAppointment,
} from "@/lib/calendar/appointments";
import {
    findGoogleSpecialistByMention,
    getGoogleCalendarBookingContext,
} from "@/lib/google-calendar";
import {
    formatBusinessScheduleLines,
    formatDateTimeInZone,
    getBusinessDateKey,
    formatTimeLabel,
    shiftDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";

type PlannerResult = {
    intent: "schedule" | "other";
    action: "create" | "ask_missing" | "ignore";
    serviceId?: string | null;
    title?: string | null;
    notes?: string | null;
    localDate?: string | null;
    localTime?: string | null;
    missingFields?: string[];
};

type BookingCatalogService = {
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    price: number;
    currency: string;
    category: { name: string };
    specialists: Array<{
        specialist: {
            id: string;
            name: string;
            displayName: string | null;
            googleCalendarSource: { calendarId: string } | null;
        };
    }>;
};

type BookingSpecialist = {
    id: string;
    name: string;
    displayName: string | null;
    googleCalendarSource: { calendarId: string } | null;
};

type ReschedulePlannerResult = {
    intent: "reschedule" | "other";
    localDate?: string | null;
    localTime?: string | null;
    missingFields?: string[];
};

type AppointmentHandlingMode = "validate" | "create";

export type AppointmentHandlingResult =
    | { kind: "none"; reply: null }
    | { kind: "missing"; reply: string }
    | { kind: "unavailable"; reply: string }
    | { kind: "created"; reply: string }
    | {
        kind: "validated";
        reply: null;
        availableSlot: {
            title: string;
            localDate: string;
            localTime: string;
            durationMinutes: number;
            startTime: Date;
            endTime: Date;
            label: string;
        };
    };

const STRONG_APPOINTMENT_PATTERNS = [
    /\b(cita|agendar|agendame|agenda|programar|reservar|reservame|reunion|reunión|llamada|consulta|demo|calendario)\b/i,
    /\b(quiero|quisiera|puedo|podemos|me gustaria|me gustaría)\s+(ir|pasar|asistir|verlos|visitarlos|atenderme)\b/i,
    /\b(me pueden|pueden|podrian|podrían)\s+(atender|recibir|ver)\b/i,
];

const APPOINTMENT_AVAILABILITY_PATTERNS = [
    /\b(disponibilidad|disponible|horario|hora|espacio)\b.{0,50}\b(cita|agendar|agenda|atender|atencion|atención|consulta|demo|reunion|reunión|llamada)\b/i,
    /\b(cita|agendar|agenda|atender|atencion|atención|consulta|demo|reunion|reunión|llamada)\b.{0,50}\b(disponibilidad|disponible|horario|hora|espacio)\b/i,
];

const APPOINTMENT_FOLLOW_UP_PROMPTS = [
    /\b(que|qué)\s+d[ií]a\b.{0,80}\b(cita|agendar|calendario|horarios libres|disponibilidad real)\b/i,
    /\b(cita|agendar|calendario|horarios libres|disponibilidad real)\b.{0,80}\b(que|qué)\s+d[ií]a\b/i,
    /\b(consultar|revisar|ver)\b.{0,60}\bdisponibilidad\b.{0,80}\b(d[ií]a|fecha|hoy|mañana|manana)\b/i,
    /\b(d[ií]a|fecha|hoy|mañana|manana)\b.{0,80}\b(consultar|revisar|ver)\b.{0,60}\bdisponibilidad\b/i,
    /\b(horario|hora)\s+que\s+prefieras\b/i,
    /\bresponde\s+con\s+el\s+horario\b/i,
    /\b(confirmar|apartar|reservar)\b.{0,70}\b(cita|horario)\b/i,
    /\b(cita|horario)\b.{0,70}\b(confirmar|apartar|reservar|mantener)\b/i,
    /\b(te parece bien|te queda bien)\b.{0,90}\b(horario|hora|cita|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i,
    /\b(horarios?)\b.{0,60}\b(disponibles?|libres?)\b/i,
    /\b(mañana|manana|tarde)\b.{0,80}\b(disponibilidad|agenda|horario)\b/i,
    /\b(confirmar|confirma|confirmame|confírmame)\b.{0,60}\b(fecha exacta|fecha|dia|día)\b/i,
    /\b(que|qué|cual|cuál)\b.{0,40}\bservicios?\b.{0,50}\b(deseas|quieres|buscas|necesitas|interesa)\b/i,
    /\b(dime|indica(?:me)?|elige|selecciona)\b.{0,45}\bservicios?\b/i,
    /\b(que|qué)\b.{0,25}\b(te gustaria|te gustaría|quieres)\b.{0,25}\b(hacerte|realizarte)\b/i,
    /(?:que|qué)\s+servicios?\s+te\s+(?:interesa|gustaria|gustaría)/i,
    /(?:que|qué)\s+te\s+(?:gustaria|gustaría)\s+(?:hacerte|realizarte)/i,
    /\b(con quien|con quién|profesional|especialista)\b.{0,50}\b(prefieres|deseas|quieres|cita)\b/i,
];

const EVENT_OR_QUOTE_CONTEXT_PATTERNS = [
    /\b(fecha|d[ií]a)\b.{0,40}\b(evento|cotizaci[oó]n|cotizar|pedido|entrega)\b/i,
    /\b(evento|cotizaci[oó]n|cotizar|pedido|entrega)\b.{0,40}\b(fecha|d[ií]a)\b/i,
    /\b(cuantas|cuántas|piezas|unidades|tipo prefieres|glowsync|audior[ií]tmicas)\b/i,
];

const DATE_OR_TIME_ANSWER_PATTERN =
    /\b(hoy|mañana|manana|pasado mañana|pasado manana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))\b/i;

const APPOINTMENT_RESCHEDULE_PATTERNS = [
    /\b(reprogram(?:ar|arla|arlo|ame)?|cambi(?:ar|arla|arlo|ame|o)|mov(?:er|erla|erlo|eme)|recorr(?:er|erla|erlo|eme))\b.{0,100}\b(cita|reserva|fecha|d[ií]a|hora|horario|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i,
    /\b(cita|reserva)\b.{0,100}\b(reprogram(?:ar|arla|arlo)?|cambiar|mover|recorrer)\b/i,
];

const APPOINTMENT_RESCHEDULE_FOLLOW_UP_PATTERN =
    /\b(s[ií]|correct[oa]|confirmo|misma?|mismo|esa?|ese|fecha|servicio|hora|horario)\b/i;

const APPOINTMENT_RESCHEDULE_COMPLETED_PATTERN =
    /\b(cita|reserva)\b.{0,50}\b(qued[oó]|est[aá])\b.{0,30}\b(reprogramada|movida|cambiada)\b/i;

const APPOINTMENT_CANCEL_PATTERNS = [
    /\b(canc[eé]l(?:ar|arla|arlo|arme|ame|o)?|anul(?:ar|arla|arlo|arme|ame|o)?)\b.{0,100}\b(cita|reserva|horario)\b/i,
    /\b(cita|reserva|horario)\b.{0,100}\b(canc[eé]l(?:ar|arla|arlo|arme|ame|o)?|anul(?:ar|arla|arlo|arme|ame|o)?)\b/i,
];

const APPOINTMENT_CANCEL_CONFIRMATION_PATTERN =
    /\b(s[ií]|confirmo|correcto|correcta|solo\s+(?:esta|esa)|únicamente\s+(?:esta|esa)|unicamente\s+(?:esta|esa)|canc[eé]lala|canc[eé]lalo)\b/i;

const APPOINTMENT_CANCEL_COMPLETED_PATTERN =
    /\b(cita|reserva)\b.{0,50}\b(qued[oó]|est[aá])\b.{0,30}\b(cancelada|anulada)\b/i;

const APPOINTMENT_CREATED_COMPLETED_PATTERN =
    /\b(tu\s+)?(cita|reserva)\b.{0,50}\b(qued[oó]|est[aá])\b.{0,30}\b(agendada|reservada|confirmada)\b/i;

const SAME_SPECIALIST_PATTERN =
    /\b(mismo|misma)\s+(especialista|profesional|persona)|\bcon\s+(el|la)\s+mism[oa]\b/i;

const NEW_BOOKING_CONTEXT_PATTERNS = [
    /\b(otra|nueva|segunda)\s+(cita|reserva)\b/i,
    /\b(otro|otra|diferente)\s+(dia|fecha|servicio|tratamiento)\b/i,
    /\b(mejor|ahora|en\s+vez\s+de|cambiar|cambiemos)\b.{0,80}\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia|fecha|servicio|tratamiento|corte|cabello|unas|pestanas|cejas|barba|facial|masaje|spa|manicure|pedicure)\b/i,
];

const ACTIVE_BOOKING_CONTEXT_GAP_MS = 12 * 60 * 60 * 1000;

const AMBIGUOUS_RELATIVE_WEEKDAY_PATTERN =
    /\b(?:el\s+)?(?:(proximo|próximo|siguiente)\s+(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)|(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+(proximo|próximo|siguiente))\b/i;

const EXPLICIT_CALENDAR_DATE_PATTERN =
    /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i;

const WEEKDAY_INDEX: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
};

function stripCodeFences(value: string) {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return fenced?.[1]?.trim() || value.trim();
}

function parsePlannerResult(raw: string): PlannerResult | null {
    try {
        const clean = stripCodeFences(raw);
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start === -1 || end === -1) return null;
        return JSON.parse(clean.slice(start, end + 1)) as PlannerResult;
    } catch {
        return null;
    }
}

function hasExplicitAppointmentIntent(text: string) {
    return (
        STRONG_APPOINTMENT_PATTERNS.some((pattern) => pattern.test(text)) ||
        APPOINTMENT_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(text))
    );
}

function isEventOrQuoteDataCollectionContext(text: string) {
    return EVENT_OR_QUOTE_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeDateOrTimeAnswer(text: string) {
    const normalized = text.trim();
    if (!normalized || normalized.length > 80) return false;
    return DATE_OR_TIME_ANSWER_PATTERN.test(normalized);
}

function getLastAssistantMessage(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
) {
    return messages.find((message) =>
        message.direction === "outbound" || message.senderType === "bot",
    )?.content || "";
}

function getRecentAssistantMessages(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
    limit = 5,
) {
    return messages
        .filter((message) => message.direction === "outbound" || message.senderType === "bot")
        .slice(0, limit)
        .map((message) => message.content);
}

function assistantRequestedAppointmentDetail(text: string) {
    return APPOINTMENT_FOLLOW_UP_PROMPTS.some((pattern) => pattern.test(text));
}

function hasAppointmentContext(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
    latestUserMessage: string,
) {
    if (hasExplicitAppointmentIntent(latestUserMessage)) {
        return true;
    }

    const lastAssistantMessage = getLastAssistantMessage(messages);
    if (isEventOrQuoteDataCollectionContext(lastAssistantMessage)) {
        return false;
    }

    if (!getRecentAssistantMessages(messages).some(assistantRequestedAppointmentDetail)) {
        return false;
    }

    // Las respuestas a una pregunta operativa de agenda suelen ser muy cortas
    // ("si", "ese horario" o una transcripcion de audio como "a la una").
    // El planificador decide despues si realmente contienen una confirmacion.
    return looksLikeDateOrTimeAnswer(latestUserMessage) || latestUserMessage.trim().length <= 160;
}

function isCompletedBookingReply(text: string) {
    return APPOINTMENT_CREATED_COMPLETED_PATTERN.test(text) ||
        APPOINTMENT_RESCHEDULE_COMPLETED_PATTERN.test(text) ||
        APPOINTMENT_CANCEL_COMPLETED_PATTERN.test(text);
}

function startsNewBookingContext(text: string) {
    const normalized = normalizeCatalogText(text);
    return NEW_BOOKING_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function getCurrentBookingInboundMessages(
    messages: Array<{ content: string; direction: string; senderType: string | null; createdAt: Date }>,
    latestUserMessage: string,
) {
    const ordered = [...messages].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const scopedMessages: string[] = [];
    let newerMessageAt = ordered.find((message) =>
        message.direction === "inbound" && message.content === latestUserMessage,
    )?.createdAt || new Date();

    for (const message of ordered) {
        if (newerMessageAt.getTime() - message.createdAt.getTime() > ACTIVE_BOOKING_CONTEXT_GAP_MS) break;
        if (
            (message.direction === "outbound" || message.senderType === "bot") &&
            isCompletedBookingReply(message.content)
        ) break;

        if (message.direction === "inbound") {
            if (!scopedMessages.includes(message.content)) scopedMessages.push(message.content);
            if (startsNewBookingContext(message.content) && !SAME_SPECIALIST_PATTERN.test(message.content)) break;
        }
        newerMessageAt = message.createdAt;
    }

    return [
        latestUserMessage,
        ...scopedMessages.filter((message) => message !== latestUserMessage),
    ];
}

function normalizeCatalogText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es-MX")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function resolveCatalogService(
    planner: PlannerResult,
    services: BookingCatalogService[],
    conversationText: string,
) {
    const byPlannerId = planner.serviceId
        ? services.find((service) => service.id === planner.serviceId)
        : null;
    if (byPlannerId) return byPlannerId;

    const normalizedConversation = normalizeCatalogText(conversationText);
    const exactNameMatches = services.filter((service) => {
        const normalizedName = normalizeCatalogText(service.name);
        return normalizedName.length >= 3 && normalizedConversation.includes(normalizedName);
    });

    if (exactNameMatches.length === 1) return exactNameMatches[0];
    if (services.length === 1) return services[0];
    return null;
}

function specialistPreferenceScore(
    text: string,
    specialist: BookingSpecialist,
    allowBareAnswer: boolean,
    aliases: string[] = [],
) {
    const normalizedText = normalizeCatalogText(text);
    const names = [...new Set([specialist.name, specialist.displayName, ...aliases]
        .filter((value): value is string => Boolean(value))
        .map(normalizeCatalogText)
        .filter(Boolean))];
    let bestScore = -1;

    for (const name of names) {
        if (allowBareAnswer && (
            normalizedText === name ||
            normalizedText === `${name} por favor` ||
            normalizedText === `el ${name}` ||
            normalizedText === `la ${name}`
        )) {
            bestScore = Math.max(bestScore, 10_000);
        }

        const negativePhrases = [`no con ${name}`, `sin ${name}`, `no quiero ${name}`];
        if (negativePhrases.some((phrase) => normalizedText.includes(phrase))) continue;

        const positivePhrases = [
            `con ${name}`,
            `prefiero ${name}`,
            `quiero ${name}`,
            `que me atienda ${name}`,
            `que me atienda el ${name}`,
            `que me atienda la ${name}`,
            `especialista ${name}`,
            `profesional ${name}`,
        ];
        for (const phrase of positivePhrases) {
            const index = normalizedText.lastIndexOf(phrase);
            if (index >= 0) bestScore = Math.max(bestScore, index);
        }
    }

    return bestScore;
}

function findSpecialistByExplicitPreference(
    latestUserMessage: string,
    previousInboundMessages: string[],
    specialists: BookingSpecialist[],
) {
    const messages = [latestUserMessage, ...previousInboundMessages.filter((message) => message !== latestUserMessage)];
    const preferredNames = specialists.map((specialist) =>
        normalizeCatalogText(specialist.displayName || specialist.name),
    );
    const uniqueFirstNameAliases = new Map<string, string[]>();
    for (const [index, specialist] of specialists.entries()) {
        const firstName = preferredNames[index]?.split(" ")[0];
        if (firstName && firstName.length >= 3 && preferredNames.filter((name) => name.split(" ")[0] === firstName).length === 1) {
            uniqueFirstNameAliases.set(specialist.id, [firstName]);
        }
    }
    for (const [messageIndex, message] of messages.entries()) {
        const matches = specialists
            .map((specialist) => ({
                specialist,
                score: specialistPreferenceScore(
                    message,
                    specialist,
                    messageIndex === 0,
                    uniqueFirstNameAliases.get(specialist.id),
                ),
            }))
            .filter((entry) => entry.score >= 0)
            .sort((left, right) => right.score - left.score);
        if (matches[0]) return matches[0].specialist;
    }
    return null;
}

async function selectAutomaticSpecialist(input: {
    mode: Extract<SpecialistAssignmentMode, "first_available" | "least_busy">;
    specialists: BookingSpecialist[];
    localDate?: string | null;
    localTime?: string | null;
    durationMinutes: number;
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>;
    bookingContext: Awaited<ReturnType<typeof getGoogleCalendarBookingContext>>;
    slotHoldOwnerKey: string;
}) {
    const { mode, specialists, localDate, localTime, durationMinutes, config, bookingContext } = input;
    if (specialists.length <= 1) return specialists[0] || null;

    const appointmentCounts = async (start?: Date, end?: Date) => {
        const counts = await prisma.appointment.groupBy({
            by: ["specialistId"],
            where: {
                specialistId: { in: specialists.map((specialist) => specialist.id) },
                status: { notIn: ["cancelled", "no_show"] },
                startTime: start && end ? { gte: start, lt: end } : { gte: new Date() },
            },
            _count: { _all: true },
        });
        return new Map(counts.map((entry) => [entry.specialistId, entry._count._all]));
    };

    if (!localDate) {
        if (mode === "first_available") return specialists[0];
        const counts = await appointmentCounts();
        return [...specialists].sort((left, right) =>
            (counts.get(left.id) || 0) - (counts.get(right.id) || 0),
        )[0] || null;
    }

    const requestedStart = localTime
        ? zonedDateTimeToUtc(localDate, localTime, config.timeZone)
        : null;
    const availabilityRows = [] as Array<{
        specialist: BookingSpecialist;
        slots: Date[];
        dayStart: Date;
        dayEnd: Date;
        originalIndex: number;
    }>;

    for (const [originalIndex, specialist] of specialists.entries()) {
        const mappedCalendar = specialist.googleCalendarSource?.calendarId
            ? bookingContext.allSources.find((source) => source.calendarId === specialist.googleCalendarSource?.calendarId)
            : null;
        const availability = await getAvailableSlotsForDate(
            localDate,
            durationMinutes * 60 * 1000,
            config,
            {
                calendarIds: mappedCalendar?.calendarId
                    ? [mappedCalendar.calendarId]
                    : bookingContext.availabilitySources.map((source) => source.calendarId),
                specialistId: specialist.id,
                limit: 96,
                slotHoldOwnerKey: input.slotHoldOwnerKey,
            },
        );
        availabilityRows.push({
            specialist,
            slots: availability.slots,
            dayStart: availability.start,
            dayEnd: availability.end,
            originalIndex,
        });
    }

    const availableAtRequestedTime = requestedStart
        ? availabilityRows.filter((entry) => entry.slots.some((slot) => slot.getTime() === requestedStart.getTime()))
        : [];
    const rowsWithAvailability = availabilityRows.filter((entry) => entry.slots.length > 0);
    const candidates = availableAtRequestedTime.length > 0
        ? availableAtRequestedTime
        : rowsWithAvailability.length > 0
            ? rowsWithAvailability
            : availabilityRows;

    if (mode === "first_available") {
        return [...candidates].sort((left, right) => {
            const leftTime = left.slots[0]?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const rightTime = right.slots[0]?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return leftTime - rightTime || left.originalIndex - right.originalIndex;
        })[0]?.specialist || null;
    }

    const dayStart = availabilityRows[0]?.dayStart;
    const dayEnd = availabilityRows[0]?.dayEnd;
    const counts = await appointmentCounts(dayStart, dayEnd);
    return [...candidates].sort((left, right) => {
        const loadDifference = (counts.get(left.specialist.id) || 0) - (counts.get(right.specialist.id) || 0);
        const leftTime = left.slots[0]?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.slots[0]?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return loadDifference || leftTime - rightTime || left.originalIndex - right.originalIndex;
    })[0]?.specialist || null;
}

function hasAppointmentRescheduleIntent(text: string) {
    return APPOINTMENT_RESCHEDULE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasAppointmentCancelIntent(text: string) {
    return APPOINTMENT_CANCEL_PATTERNS.some((pattern) => pattern.test(text));
}

async function maybeHandleAppointmentCancellation(
    conversationId: string,
    latestUserMessage: string,
): Promise<AppointmentHandlingResult | null> {
    const couldBeFollowUp =
        APPOINTMENT_CANCEL_CONFIRMATION_PATTERN.test(latestUserMessage) ||
        /^\s*[1-3]\s*$/.test(latestUserMessage);
    if (!hasAppointmentCancelIntent(latestUserMessage) && !couldBeFollowUp) {
        return null;
    }

    const [conversation, config] = await Promise.all([
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                contact: true,
                messages: {
                    where: { type: { not: "system" } },
                    orderBy: { createdAt: "desc" },
                    take: 16,
                },
            },
        }),
        getBusinessHoursConfig(),
    ]);

    if (!conversation?.contactId) return null;

    const latestInboundCancellation = conversation.messages.find((message) =>
        message.direction === "inbound" && hasAppointmentCancelIntent(message.content),
    );
    const latestCompletedCancellation = conversation.messages.find((message) =>
        message.direction === "outbound" && APPOINTMENT_CANCEL_COMPLETED_PATTERN.test(message.content),
    );
    const hasPendingCancellation = Boolean(
        latestInboundCancellation &&
        (
            !latestCompletedCancellation ||
            latestInboundCancellation.createdAt > latestCompletedCancellation.createdAt
        ),
    );
    if (!hasAppointmentCancelIntent(latestUserMessage) && !hasPendingCancellation) {
        return null;
    }

    const appointments = await prisma.appointment.findMany({
        where: {
            contactId: conversation.contactId,
            status: { notIn: ["cancelled", "no_show", "completed"] },
            endTime: { gte: new Date() },
        },
        orderBy: { startTime: "asc" },
        take: 3,
    });

    if (appointments.length === 0) {
        return {
            kind: "missing",
            reply: "No encuentro una cita próxima vinculada a este número para cancelar.",
        };
    }

    const latestSelection = conversation.messages.find((message) =>
        message.direction === "inbound" &&
        /^\s*[1-3]\s*$/.test(message.content) &&
        Boolean(
            latestInboundCancellation &&
            message.createdAt > latestInboundCancellation.createdAt
        ),
    );
    const selectionText = latestUserMessage.match(/^\s*[1-3]\s*$/)
        ? latestUserMessage
        : latestSelection?.content || "";
    const appointmentSelection = selectionText.match(/^\s*([1-3])\s*$/);
    const selectedAppointmentIndex = appointmentSelection
        ? Number(appointmentSelection[1]) - 1
        : -1;

    if (
        appointments.length > 1 &&
        (selectedAppointmentIndex < 0 || selectedAppointmentIndex >= appointments.length)
    ) {
        return {
            kind: "missing",
            reply: [
                "Veo más de una cita próxima. ¿Cuál quieres cancelar?",
                "",
                ...appointments.map((appointment, index) =>
                    `${index + 1}. *${appointment.title}* — ${formatDateTimeInZone(appointment.startTime, config.timeZone, "es-MX", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                    })}`,
                ),
            ].join("\n"),
        };
    }

    const appointment = appointments.length > 1
        ? appointments[selectedAppointmentIndex]
        : appointments[0];
    const appointmentLabel = formatDateTimeInZone(
        appointment.startTime,
        config.timeZone,
        "es-MX",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        },
    );
    const isConfirmedFollowUp =
        !hasAppointmentCancelIntent(latestUserMessage) &&
        APPOINTMENT_CANCEL_CONFIRMATION_PATTERN.test(latestUserMessage) &&
        !/^\s*[1-3]\s*$/.test(latestUserMessage);

    if (!isConfirmedFollowUp) {
        return {
            kind: "missing",
            reply: `¿Confirmas que deseas cancelar la cita de *${appointment.title}* del *${appointmentLabel}*?`,
        };
    }

    try {
        const cancelled = await cancelManagedAppointment(
            appointment.id,
            "Cancelada por el cliente mediante WhatsApp.",
        );
        revalidatePath("/dashboard/calendar");
        revalidatePath("/dashboard/contacts");

        return {
            kind: "created",
            reply: [
                "Tu cita quedó cancelada.",
                "",
                `*Servicio:* ${cancelled.title}`,
                `*Fecha cancelada:* ${appointmentLabel}`,
            ].join("\n"),
        };
    } catch (error) {
        console.error("[Appointments] Failed to cancel appointment from conversation:", error);
        return {
            kind: "unavailable",
            reply: "No fue posible cancelar la cita de forma segura. La cita continúa activa y necesitas atención humana para revisarla.",
        };
    }
}

async function maybeHandleAppointmentReschedule(
    conversationId: string,
    latestUserMessage: string,
): Promise<AppointmentHandlingResult | null> {
    const couldBeFollowUp =
        APPOINTMENT_RESCHEDULE_FOLLOW_UP_PATTERN.test(latestUserMessage) ||
        /^\s*[1-3]\s*$/.test(latestUserMessage);
    if (!hasAppointmentRescheduleIntent(latestUserMessage) && !couldBeFollowUp) {
        return null;
    }

    const [conversation, config] = await Promise.all([
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                contact: true,
                messages: {
                    where: { type: { not: "system" } },
                    orderBy: { createdAt: "desc" },
                    take: 16,
                },
            },
        }),
        getBusinessHoursConfig(),
    ]);

    if (!conversation?.contactId) return null;

    const latestInboundReschedule = conversation.messages.find((message) =>
        message.direction === "inbound" && hasAppointmentRescheduleIntent(message.content),
    );
    const latestCompletedReschedule = conversation.messages.find((message) =>
        message.direction === "outbound" && APPOINTMENT_RESCHEDULE_COMPLETED_PATTERN.test(message.content),
    );
    const hasRecentRescheduleContext = Boolean(
        latestInboundReschedule &&
        (
            !latestCompletedReschedule ||
            latestInboundReschedule.createdAt > latestCompletedReschedule.createdAt
        ),
    );
    if (!hasAppointmentRescheduleIntent(latestUserMessage) && !hasRecentRescheduleContext) {
        return null;
    }

    const appointments = await prisma.appointment.findMany({
        where: {
            contactId: conversation.contactId,
            status: { notIn: ["cancelled", "no_show", "completed"] },
            endTime: { gte: new Date() },
        },
        orderBy: { startTime: "asc" },
        take: 3,
    });

    if (appointments.length === 0) {
        return {
            kind: "missing",
            reply: "No encuentro una cita próxima vinculada a este número para poder moverla. Puedo ayudarte a crear una nueva o canalizarte con atención humana.",
        };
    }

    const appointmentSelection = latestUserMessage.match(/^\s*([1-3])\s*$/);
    const selectedAppointmentIndex = appointmentSelection
        ? Number(appointmentSelection[1]) - 1
        : -1;

    if (
        appointments.length > 1 &&
        (selectedAppointmentIndex < 0 || selectedAppointmentIndex >= appointments.length)
    ) {
        return {
            kind: "missing",
            reply: [
                "Veo más de una cita próxima. ¿Cuál quieres mover?",
                "",
                ...appointments.map((appointment, index) =>
                    `${index + 1}. *${appointment.title}* — ${formatDateTimeInZone(appointment.startTime, config.timeZone, "es-MX", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                    })}`,
                ),
            ].join("\n"),
        };
    }

    const appointment = appointments.length > 1
        ? appointments[selectedAppointmentIndex]
        : appointments[0];
    const durationMinutes = Math.max(
        15,
        Math.round((appointment.endTime.getTime() - appointment.startTime.getTime()) / 60000),
    );
    const currentDate = getBusinessDateKey(appointment.startTime, config.timeZone);
    const currentTime = formatDateTimeInZone(appointment.startTime, config.timeZone, "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });
    const transcript = buildConversationTranscript(
        [...conversation.messages].reverse().map((message) => ({
            content: message.content,
            direction: message.direction,
            senderType: message.senderType,
        })),
    );

    const parserPrompt = `
Analiza la conversación para mover una cita que ya existe. Devuelve SOLO JSON válido:
{
  "intent": "reschedule" | "other",
  "localDate": "YYYY-MM-DD" | null,
  "localTime": "HH:mm" | null,
  "missingFields": string[]
}

CONTEXTO OPERATIVO
- Fecha local actual: ${getBusinessDateKey(new Date(), config.timeZone)}
- Zona horaria: ${config.timeZone}
- Servicio de la cita existente: ${appointment.title}
- Fecha actual de la cita: ${currentDate}
- Hora actual de la cita: ${currentTime}

REGLAS
- Usa el historial completo para resolver referencias como "el miércoles", "mañana", "misma hora", "ese servicio" o una confirmación corta como "sí, es correcto".
- Interpreta "misma hora" como ${currentTime} y "misma fecha" como ${currentDate}.
- Si menciona un día de la semana sin número, usa la siguiente fecha futura que corresponda desde la fecha local actual.
- Ignora cualquier afirmación previa del asistente sobre si el horario estaba libre u ocupado: la disponibilidad se validará después contra el calendario real.
- Esta operación sólo mueve fecha y hora. Conserva el servicio, duración y profesional de la cita existente.
- No inventes fecha ni hora. Si falta fecha, incluye "date" en missingFields; si falta hora, incluye "time".

HISTORIAL
${transcript || "Sin historial"}

ÚLTIMO MENSAJE
Cliente: ${latestUserMessage}
    `.trim();

    const raw = await generateCompletion([{ role: "system", content: parserPrompt }], 0);
    let planner: ReschedulePlannerResult | null = null;
    try {
        const clean = stripCodeFences(raw || "");
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
            planner = JSON.parse(clean.slice(start, end + 1)) as ReschedulePlannerResult;
        }
    } catch {
        planner = null;
    }

    if (!planner || planner.intent !== "reschedule") {
        return {
            kind: "missing",
            reply: "No pude identificar con seguridad el cambio solicitado. Dime únicamente la nueva fecha y hora para mover la cita.",
        };
    }

    if (!planner.localDate) {
        return {
            kind: "missing",
            reply: `Claro, puedo mover tu cita de *${appointment.title}*. ¿Para qué fecha la quieres?`,
        };
    }

    if (!planner.localTime) {
        const availability = await getAvailableSlotsForDate(
            planner.localDate,
            durationMinutes * 60 * 1000,
            config,
            {
                excludeAppointmentId: appointment.id,
                specialistId: appointment.specialistId,
                calendarIds: appointment.googleCalendarId ? [appointment.googleCalendarId] : undefined,
                limit: 96,
                slotHoldOwnerKey: conversation.id,
            },
        );

        return {
            kind: "missing",
            reply: buildDateAvailabilityReply(planner.localDate, availability, config),
        };
    }

    const startTime = zonedDateTimeToUtc(planner.localDate, planner.localTime, config.timeZone);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    if (
        startTime.getTime() === appointment.startTime.getTime() &&
        endTime.getTime() === appointment.endTime.getTime()
    ) {
        return {
            kind: "created",
            reply: `La cita ya está registrada para ${formatDateTimeInZone(startTime, config.timeZone, "es-MX", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
            })}.`,
        };
    }

    const slotHoldOwnerKey = `reschedule:${conversation.id}`;
    let slotHeld = false;
    try {
        await validateManagedAppointment({
            startTime,
            endTime,
            excludeAppointmentId: appointment.id,
            specialistId: appointment.specialistId,
            googleCalendarId: appointment.googleCalendarId,
            blockingCalendarIds: appointment.googleCalendarId
                ? [appointment.googleCalendarId]
                : undefined,
            slotHoldOwnerKey,
        });
        slotHeld = true;

        const updated = await updateManagedAppointment(appointment.id, {
            startTime,
            endTime,
            blockingCalendarIds: appointment.googleCalendarId
                ? [appointment.googleCalendarId]
                : undefined,
            slotHoldOwnerKey,
        });

        revalidatePath("/dashboard/calendar");
        revalidatePath("/dashboard/contacts");

        return {
            kind: "created",
            reply: [
                "Listo, la cita quedó reprogramada.",
                "",
                `*Servicio:* ${updated.title}`,
                `*Nueva fecha:* ${formatDateTimeInZone(updated.startTime, config.timeZone, "es-MX", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                })}`,
                `*Hora:* ${formatDateTimeInZone(updated.startTime, config.timeZone, "es-MX", {
                    hour: "numeric",
                    minute: "2-digit",
                })}`,
                `*Duración aproximada:* ${durationMinutes} minutos`,
                ...(updated.specialistName ? [`*Profesional:* ${updated.specialistName}`] : []),
            ].join("\n"),
        };
    } catch (error) {
        if (error instanceof AppointmentSchedulingError) {
            return {
                kind: "unavailable",
                reply: buildUnavailableReply(error, config),
            };
        }
        throw error;
    } finally {
        if (slotHeld) {
            await releaseAppointmentSlotHold(slotHoldOwnerKey);
        }
    }
}

function getUnresolvedAmbiguousDate(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
    latestUserMessage: string,
) {
    const inboundMessages = messages
        .filter((message) => message.direction === "inbound" && message.senderType !== "bot")
        .map((message) => message.content?.trim())
        .filter((message): message is string => Boolean(message));

    if (inboundMessages[inboundMessages.length - 1] !== latestUserMessage.trim()) {
        inboundMessages.push(latestUserMessage.trim());
    }

    let ambiguousIndex = -1;
    let ambiguousMatch: RegExpMatchArray | null = null;

    for (let index = 0; index < inboundMessages.length; index += 1) {
        const message = inboundMessages[index];
        const match = message.match(AMBIGUOUS_RELATIVE_WEEKDAY_PATTERN);
        if (match) {
            ambiguousIndex = index;
            ambiguousMatch = match;
        }
    }

    if (ambiguousIndex === -1 || !ambiguousMatch) return null;

    const wasClarified = inboundMessages
        .slice(ambiguousIndex + 1)
        .some((message) => EXPLICIT_CALENDAR_DATE_PATTERN.test(message));

    if (wasClarified) return null;

    const weekday = (ambiguousMatch[2] || ambiguousMatch[3] || "").toLowerCase();
    return {
        phrase: ambiguousMatch[0],
        weekday,
    };
}

function buildAmbiguousDateReply(
    phrase: string,
    weekday: string,
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>,
) {
    const todayKey = getBusinessDateKey(new Date(), config.timeZone);
    const [year, month, day] = todayKey.split("-").map(Number);
    const currentWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const targetWeekday = WEEKDAY_INDEX[weekday];
    const firstOffset = ((targetWeekday - currentWeekday + 7) % 7) || 7;
    const firstDateKey = shiftDateKey(todayKey, firstOffset);
    const secondDateKey = shiftDateKey(firstDateKey, 7);
    const formatCandidate = (dateKey: string) => formatDateTimeInZone(
        zonedDateTimeToUtc(dateKey, "12:00", config.timeZone),
        config.timeZone,
        "es-MX",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );

    return [
        "*Antes de apartar el horario necesito confirmar la fecha exacta.*",
        "",
        `Cuando dices *${phrase}*, te refieres al *${formatCandidate(firstDateKey)}* o al *${formatCandidate(secondDateKey)}*?`,
        "",
        "Respondeme con el dia, mes y año para evitar cualquier confusion.",
    ].join("\n");
}

function buildConversationTranscript(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
) {
    return messages
        .slice(-8)
        .map((message) => {
            const role =
                message.direction === "outbound" || message.senderType === "bot"
                    ? "Asistente"
                    : "Cliente";
            return `${role}: ${message.content}`;
        })
        .join("\n");
}

function buildMissingInfoReply(
    missingFields: string[],
    planner?: PlannerResult,
) {
    const needsDate = missingFields.includes("date");
    const needsTime = missingFields.includes("time");
    const requestedTime = planner?.localTime
        ? formatTimeLabel(planner.localTime)
        : null;

    if (needsDate) {
        return [
            "*Claro, reviso disponibilidad real en calendario.*",
            "",
            requestedTime
                ? `Para que dia quieres la cita a las *${requestedTime}*?`
                : "Primero dime *que dia te interesa*.",
            "",
            "Ejemplo: manana, este viernes o 28 de mayo.",
        ].join("\n");
    }

    if (needsTime) {
        return [
            "*Perfecto, reviso ese dia.*",
            "",
            "Solo me falta *la hora* que prefieres.",
        ].join("\n");
    }

    return [
        "*Claro, puedo ayudarte a agendar.*",
        "",
        "Dime primero *que dia te interesa* y reviso los horarios libres.",
    ].join("\n");
}

function buildDateAvailabilityReply(
    localDate: string,
    availability: Awaited<ReturnType<typeof getAvailableSlotsForDate>>,
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>,
) {
    const dateReference = zonedDateTimeToUtc(localDate, "12:00", config.timeZone);
    const dateLabel = formatDateTimeInZone(dateReference, config.timeZone, "es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    if (!availability.isOpen) {
        return [
            `*El ${dateLabel} no tenemos atencion.*`,
            "",
            "Dime otro dia y reviso disponibilidad real en calendario.",
        ].join("\n");
    }

    if (availability.slots.length === 0) {
        return [
            `*Para el ${dateLabel} no veo horarios libres en calendario.*`,
            "",
            "Quieres que revise otro dia?",
        ].join("\n");
    }

    const ranges = availability.slots.reduce<Array<{ first: Date; last: Date }>>((groups, slot) => {
        const previous = groups.at(-1);
        if (previous && slot.getTime() - previous.last.getTime() === 15 * 60 * 1000) {
            previous.last = slot;
        } else {
            groups.push({ first: slot, last: slot });
        }
        return groups;
    }, []);
    const formatSlot = (slot: Date) => formatDateTimeInZone(slot, config.timeZone, "es-MX", {
        hour: "numeric",
        minute: "2-digit",
    });

    return [
        `*Si hay disponibilidad para el ${dateLabel}.*`,
        "",
        "*Horas de inicio disponibles:*",
        ...ranges.map((range) => range.first.getTime() === range.last.getTime()
            ? `- ${formatSlot(range.first)}`
            : `- De ${formatSlot(range.first)} a ${formatSlot(range.last)}`),
        "",
        "Dentro de esos rangos puedes elegir inicios cada 15 minutos.",
        "Responde con el horario que prefieras y lo confirmo en calendario.",
    ].join("\n");
}

function buildSpecialistReply(
    specialists: Array<{ specialistName?: string | null; summary: string }>,
) {
    const names = specialists
        .map((specialist) => specialist.specialistName || specialist.summary)
        .filter(Boolean);

    return [
        "*Claro, puedo ayudarte a agendarla.*",
        "",
        `Solo necesito saber *con quien* prefieres la cita: ${names.join(", ")}.`,
    ].join("\n");
}

function buildServiceReply(services: BookingCatalogService[]) {
    if (services.length === 0) {
        return [
            "*Todavia no hay servicios activos disponibles para agendar.*",
            "",
            "Necesito apoyo del negocio para continuar con tu cita.",
        ].join("\n");
    }
    const visibleServices = services.slice(0, 8).map((service) => `- ${service.name}`);
    return [
        "*Antes de revisar horarios necesito identificar el servicio.*",
        "",
        "Dime cual de estos servicios deseas:",
        ...visibleServices,
        ...(services.length > visibleServices.length
            ? ["- O escribe el nombre del servicio que buscas"]
            : []),
    ].join("\n");
}

function buildSuccessReply(
    title: string,
    startTime: Date,
    durationMinutes: number,
    timeZone: string,
    specialistName?: string | null,
) {
    return [
        "*Tu cita quedo agendada*",
        "",
        `*Motivo:* ${title}`,
        ...(specialistName ? [`*Especialista:* ${specialistName}`] : []),
        `*Fecha:* ${formatDateTimeInZone(startTime, timeZone, "es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        })}`,
        `*Hora:* ${formatDateTimeInZone(startTime, timeZone, "es-MX", {
            hour: "numeric",
            minute: "2-digit",
        })}`,
        `*Duracion:* ${durationMinutes} min`,
        "",
        "Si necesitas reprogramarla, dimelo y la movemos.",
    ].join("\n");
}

function buildUnavailableReply(
    error: AppointmentSchedulingError,
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>,
) {
    const suggestions = formatAppointmentSuggestions(error.suggestions, config);

    if (error.code === "OUTSIDE_BUSINESS_HOURS") {
        return [
            "*Ese horario no esta disponible.*",
            "",
            error.message,
            ...(suggestions.length > 0
                ? ["", "*Te puedo proponer estos horarios:*", ...suggestions]
                : []),
        ].join("\n");
    }

    if (error.code === "TIME_CONFLICT") {
        return [
            "*Ese horario ya esta ocupado.*",
            ...(suggestions.length > 0
                ? ["", "*Te puedo proponer estos horarios:*", ...suggestions]
                : []),
        ].join("\n");
    }

    return error.message;
}

function buildValidatedSlotLabel(
    startTime: Date,
    timeZone: string,
) {
    const dateLabel = formatDateTimeInZone(startTime, timeZone, "es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    const timeLabel = formatDateTimeInZone(startTime, timeZone, "es-MX", {
        hour: "numeric",
        minute: "2-digit",
    });

    return `${dateLabel} a las ${timeLabel}`;
}

async function planAppointmentFromConversation(
    conversationId: string,
    latestUserMessage: string,
) {
    const [conversation, config, services, activeSpecialists] = await Promise.all([
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                contact: true,
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 16,
                },
            },
        }),
        getBusinessHoursConfig(),
        prisma.service.findMany({
            where: { isActive: true, category: { isActive: true } },
            orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                description: true,
                durationMinutes: true,
                price: true,
                currency: true,
                category: { select: { name: true } },
                specialists: {
                    where: { specialist: { isActive: true } },
                    select: {
                        specialist: {
                            select: {
                                id: true,
                                name: true,
                                displayName: true,
                                googleCalendarSource: { select: { calendarId: true } },
                            },
                        },
                    },
                },
            },
        }),
        prisma.specialist.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                displayName: true,
                googleCalendarSource: { select: { calendarId: true } },
            },
        }),
    ]);

    if (!conversation) {
        return null;
    }

    if (!hasAppointmentContext(conversation.messages, latestUserMessage)) {
        return null;
    }

    const now = new Date();
    const transcript = buildConversationTranscript(
        [...conversation.messages].reverse().map((message) => ({
            content: message.content,
            direction: message.direction,
            senderType: message.senderType,
        })),
    );
    const ambiguousDate = getUnresolvedAmbiguousDate(
        [...conversation.messages].reverse().map((message) => ({
            content: message.content,
            direction: message.direction,
            senderType: message.senderType,
        })),
        latestUserMessage,
    );

    const parserPrompt = `
Analiza la conversacion y decide si el cliente quiere *agendar una cita nueva*.
Devuelve SOLO JSON valido, sin markdown, con esta forma exacta:
{
  "intent": "schedule" | "other",
  "action": "create" | "ask_missing" | "ignore",
  "serviceId": string | null,
  "title": string | null,
  "notes": string | null,
  "localDate": "YYYY-MM-DD" | null,
  "localTime": "HH:mm" | null,
  "missingFields": string[]
}

CONTEXTO
- Fecha y hora local actual: ${formatDateTimeInZone(now, config.timeZone, "es-MX")}
- Fecha local actual ISO: ${getBusinessDateKey(now, config.timeZone)}
- Zona horaria del negocio: ${config.timeZone}
- Horario comercial por dia:
${formatBusinessScheduleLines(config)}
- Nombre del cliente: ${conversation.contact?.name || "Sin nombre"}
- Servicios activos (usa solamente uno de estos IDs):
${JSON.stringify(services.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
    })))}

REGLAS
- Usa el historial para resolver mensajes como "manana a las 3" o "si, a esa hora".
- Si aparece una fecha relativa ambigua como "proximo martes" o "martes siguiente", no la confirmes ni la conviertas silenciosamente en una cita. El sistema pedira primero una fecha exacta.
- Solo marca intent = "schedule" si realmente quiere una cita, reunion, llamada, demo o consulta.
- Si pregunta por horarios o disponibilidad para una cita, tambien es intent = "schedule".
- Si la fecha es del evento, entrega, pedido o cotizacion, NO es una cita del CRM: usa intent = "other" y action = "ignore".
- Si el asistente pregunto "que fecha es tu evento" o pidio datos para cotizar, una respuesta como "17 de octubre" NO debe activar agenda.
- No niegues atencion por calendario salvo que el cliente haya pedido claramente agendar/ser atendido en una fecha u horario.
- Si falta fecha o falta hora, usa action = "ask_missing".
- Identifica el servicio solicitado usando el historial completo y devuelve exactamente su serviceId.
- Nunca inventes un serviceId. Si el servicio no esta claro, serviceId debe ser null, action = "ask_missing" y agrega "service" a missingFields.
- Si menciona un dia pero no una hora, localDate debe tener ese dia y localTime debe ser null.
- Si menciona una hora pero no un dia, localTime debe tener esa hora y localDate debe ser null.
- Si no hay intencion clara de cita, usa intent = "other" y action = "ignore".
- El titulo debe ser el nombre del servicio identificado; no inventes otro servicio.
- No inventes fecha ni hora si no se pueden deducir con seguridad.
- No trates el horario comercial como disponibilidad real; la disponibilidad se valida despues con calendario.

HISTORIAL
${transcript || "Sin historial"}

ULTIMO MENSAJE
Cliente: ${latestUserMessage}
    `.trim();

    const raw = await generateCompletion(
        [{ role: "system", content: parserPrompt }],
        0,
    );

    return {
        conversation,
        config,
        services,
        activeSpecialists,
        planner: parsePlannerResult(raw || ""),
        ambiguousDate,
    };
}

export async function maybeHandleAppointmentBooking(
    conversationId: string,
    latestUserMessage: string,
    options?: {
        mode?: AppointmentHandlingMode;
    },
): Promise<AppointmentHandlingResult> {
    const mode = options?.mode || "create";
    const cancellationResult = await maybeHandleAppointmentCancellation(
        conversationId,
        latestUserMessage,
    );
    if (cancellationResult) {
        return cancellationResult;
    }

    const rescheduleResult = await maybeHandleAppointmentReschedule(
        conversationId,
        latestUserMessage,
    );
    if (rescheduleResult) {
        return rescheduleResult;
    }

    const planned = await planAppointmentFromConversation(conversationId, latestUserMessage);

    if (!planned?.planner || planned.planner.intent !== "schedule") {
        return { kind: "none", reply: null };
    }

    const { planner, conversation, config, services, activeSpecialists } = planned;
    if (planned.ambiguousDate) {
        return {
            kind: "missing",
            reply: buildAmbiguousDateReply(
                planned.ambiguousDate.phrase,
                planned.ambiguousDate.weekday,
                config,
            ),
        };
    }
    if (planner.action === "ignore") {
        return { kind: "none", reply: null };
    }
    const bookingContextText = [
        latestUserMessage,
        ...conversation.messages.map((message) => message.content),
    ].join("\n");
    const selectedService = resolveCatalogService(planner, services, bookingContextText);
    if (!selectedService) {
        return {
            kind: "missing",
            reply: buildServiceReply(services),
        };
    }
    const durationMinutes = Math.min(Math.max(selectedService.durationMinutes, 5), 480);
    const bookingContext = await getGoogleCalendarBookingContext();
    const settings = await getSystemSettingsOrDefaults();
    const specialistAssignmentMode = normalizeBusinessPolicies(settings.businessPolicies)
        .scheduling.specialistAssignmentMode;
    const assignedSpecialists = selectedService.specialists.map((entry) => entry.specialist);
    const eligibleSpecialists = assignedSpecialists.length > 0
        ? assignedSpecialists
        : activeSpecialists;
    const bookingInboundMessages = getCurrentBookingInboundMessages(
        conversation.messages,
        latestUserMessage,
    );
    const previousInboundMessages = bookingInboundMessages.slice(1);
    let selectedCrmSpecialist = findSpecialistByExplicitPreference(
        latestUserMessage,
        previousInboundMessages,
        eligibleSpecialists,
    );

    if (
        !selectedCrmSpecialist &&
        SAME_SPECIALIST_PATTERN.test(latestUserMessage) &&
        conversation.contactId &&
        eligibleSpecialists.length > 0
    ) {
        const previousAppointment = await prisma.appointment.findFirst({
            where: {
                contactId: conversation.contactId,
                specialistId: { in: eligibleSpecialists.map((specialist) => specialist.id) },
                status: { notIn: ["cancelled", "no_show"] },
            },
            orderBy: { createdAt: "desc" },
            select: { specialistId: true },
        });
        selectedCrmSpecialist = eligibleSpecialists.find((specialist) =>
            specialist.id === previousAppointment?.specialistId,
        ) || null;
    }

    const shouldAskForCrmSpecialist = !selectedCrmSpecialist && (
        (specialistAssignmentMode === "ask_always" && eligibleSpecialists.length > 0) ||
        (specialistAssignmentMode === "ask_when_multiple" && eligibleSpecialists.length > 1)
    );
    if (shouldAskForCrmSpecialist) {
        return {
            kind: "missing",
            reply: buildSpecialistReply(eligibleSpecialists.map((specialist) => ({
                specialistName: specialist.displayName || specialist.name,
                summary: specialist.displayName || specialist.name,
            }))),
        };
    }

    if (!selectedCrmSpecialist && eligibleSpecialists.length === 1) {
        selectedCrmSpecialist = eligibleSpecialists[0];
    }

    if (
        !selectedCrmSpecialist &&
        (specialistAssignmentMode === "first_available" || specialistAssignmentMode === "least_busy")
    ) {
        selectedCrmSpecialist = await selectAutomaticSpecialist({
            mode: specialistAssignmentMode,
            specialists: eligibleSpecialists,
            localDate: planner.localDate,
            localTime: planner.localTime,
            durationMinutes,
            config,
            bookingContext,
            slotHoldOwnerKey: conversation.id,
        });
    }

    let selectedSpecialist = selectedCrmSpecialist
        ? selectedCrmSpecialist.googleCalendarSource?.calendarId
            ? bookingContext.allSources.find((source) =>
                source.calendarId === selectedCrmSpecialist?.googleCalendarSource?.calendarId,
            ) || null
            : null
        : await findGoogleSpecialistByMention(bookingInboundMessages.join("\n"));

    if (
        !selectedCrmSpecialist &&
        !selectedSpecialist &&
        bookingContext.specialists.length === 1 &&
        specialistAssignmentMode !== "ask_always"
    ) {
        selectedSpecialist = bookingContext.specialists[0];
    }

    const shouldAskForGoogleSpecialist = !selectedCrmSpecialist && !selectedSpecialist && (
        (specialistAssignmentMode === "ask_always" && bookingContext.specialists.length > 0) ||
        (specialistAssignmentMode === "ask_when_multiple" && bookingContext.specialists.length > 1)
    );
    if (shouldAskForGoogleSpecialist) {
        return {
            kind: "missing",
            reply: buildSpecialistReply(bookingContext.specialists),
        };
    }

    if (
        !selectedCrmSpecialist &&
        !selectedSpecialist &&
        bookingContext.specialists.length > 0 &&
        (specialistAssignmentMode === "first_available" || specialistAssignmentMode === "least_busy")
    ) {
        selectedSpecialist = bookingContext.specialists[0];
    }

    const targetCalendar = selectedSpecialist || bookingContext.writeTarget;
    const blockingCalendarIds =
        selectedSpecialist?.calendarId
            ? [selectedSpecialist.calendarId]
            : bookingContext.availabilitySources.map((source) => source.calendarId);

    if (!planner.localDate || !planner.localTime) {
        if (planner.localDate && !planner.localTime) {
            const availability = await getAvailableSlotsForDate(
                planner.localDate,
                durationMinutes * 60 * 1000,
                config,
                {
                    calendarIds: blockingCalendarIds,
                    specialistId: selectedCrmSpecialist?.id,
                    limit: 96,
                    slotHoldOwnerKey: conversation.id,
                },
            );

            return {
                kind: "missing",
                reply: buildDateAvailabilityReply(planner.localDate, availability, config),
            };
        }

        return {
            kind: "missing",
            reply: buildMissingInfoReply(planner.missingFields || [], planner),
        };
    }

    try {
        const startTime = zonedDateTimeToUtc(planner.localDate, planner.localTime, config.timeZone);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        const title = selectedService.name;

        if (mode === "validate") {
            await validateManagedAppointment({
                startTime,
                endTime,
                googleCalendarId: targetCalendar?.calendarId || undefined,
                blockingCalendarIds,
                specialistId: selectedCrmSpecialist?.id,
                slotHoldOwnerKey: conversation.id,
            });

            return {
                kind: "validated",
                reply: null,
                availableSlot: {
                    title,
                    localDate: planner.localDate,
                    localTime: planner.localTime,
                    durationMinutes,
                    startTime,
                    endTime,
                    label: buildValidatedSlotLabel(startTime, config.timeZone),
                },
            };
        }

        await createManagedAppointment({
            title,
            startTime,
            endTime,
            notes: planner.notes?.trim() || latestUserMessage,
            contactId: conversation.contactId,
            specialistId: selectedCrmSpecialist?.id,
            serviceId: selectedService.id,
            userId: conversation.assignedUserId || undefined,
            appointmentType: selectedService.name,
            source: "whatsapp",
            paymentStatus: selectedService.price > 0 ? "pending" : "unpaid",
            paymentAmount: selectedService.price,
            paymentCurrency: selectedService.currency,
            googleCalendarId: targetCalendar?.calendarId || undefined,
            googleCalendarName: targetCalendar?.summary || undefined,
            googleCalendarColor: targetCalendar?.backgroundColor || undefined,
            specialistName:
                selectedCrmSpecialist?.displayName ||
                selectedCrmSpecialist?.name ||
                selectedSpecialist?.specialistName ||
                selectedSpecialist?.summary ||
                undefined,
            blockingCalendarIds,
            slotHoldOwnerKey: conversation.id,
        });

        revalidatePath("/dashboard/calendar");
        revalidatePath("/dashboard/contacts");

        return {
            kind: "created",
            reply: buildSuccessReply(
                title,
                startTime,
                durationMinutes,
                config.timeZone,
                selectedCrmSpecialist?.displayName ||
                    selectedCrmSpecialist?.name ||
                    selectedSpecialist?.specialistName ||
                    selectedSpecialist?.summary ||
                    null,
            ),
        };
    } catch (error) {
        if (error instanceof AppointmentSchedulingError) {
            return {
                kind: "unavailable",
                reply: buildUnavailableReply(error, config),
            };
        }

        console.error("[Appointments] Failed to book appointment:", error);
        return {
            kind: "unavailable",
            reply: [
                "*No pude agendar la cita en este momento.*",
                "",
                "Si quieres, intenta de nuevo con la fecha y hora exactas.",
            ].join("\n"),
        };
    }
}
