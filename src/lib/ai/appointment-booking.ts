import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import {
    AppointmentSchedulingError,
    createManagedAppointment,
    formatAppointmentSuggestions,
    getAvailableSlotsForDate,
    getBusinessHoursConfig,
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
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";
import { getContactFullName } from "@/lib/contact-name";

type PlannerResult = {
    intent: "schedule" | "other";
    action: "create" | "ask_missing" | "ignore";
    title?: string | null;
    notes?: string | null;
    localDate?: string | null;
    localTime?: string | null;
    durationMinutes?: number | null;
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
    /\b(horario|hora)\s+que\s+prefieras\b/i,
    /\bresponde\s+con\s+el\s+horario\b/i,
];

const EVENT_OR_QUOTE_CONTEXT_PATTERNS = [
    /\b(fecha|d[ií]a)\b.{0,40}\b(evento|cotizaci[oó]n|cotizar|pedido|entrega)\b/i,
    /\b(evento|cotizaci[oó]n|cotizar|pedido|entrega)\b.{0,40}\b(fecha|d[ií]a)\b/i,
    /\b(cuantas|cuántas|piezas|unidades|tipo prefieres|glowsync|audior[ií]tmicas)\b/i,
];

const DATE_OR_TIME_ANSWER_PATTERN =
    /\b(hoy|mañana|manana|pasado mañana|pasado manana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))\b/i;

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

    return (
        looksLikeDateOrTimeAnswer(latestUserMessage) &&
        assistantRequestedAppointmentDetail(lastAssistantMessage)
    );
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

    return [
        `*Si hay disponibilidad para el ${dateLabel}.*`,
        "",
        "*Horarios libres:*",
        ...availability.slots.map((slot, index) =>
            `${index + 1}. ${formatDateTimeInZone(slot, config.timeZone, "es-MX", {
                hour: "numeric",
                minute: "2-digit",
            })}`,
        ),
        "",
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
    const [conversation, config] = await Promise.all([
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

    const parserPrompt = `
Analiza la conversacion y decide si el cliente quiere *agendar una cita nueva*.
Devuelve SOLO JSON valido, sin markdown, con esta forma exacta:
{
  "intent": "schedule" | "other",
  "action": "create" | "ask_missing" | "ignore",
  "title": string | null,
  "notes": string | null,
  "localDate": "YYYY-MM-DD" | null,
  "localTime": "HH:mm" | null,
  "durationMinutes": number | null,
  "missingFields": string[]
}

CONTEXTO
- Fecha y hora local actual: ${formatDateTimeInZone(now, config.timeZone, "es-MX")}
- Fecha local actual ISO: ${getBusinessDateKey(now, config.timeZone)}
- Zona horaria del negocio: ${config.timeZone}
- Horario comercial por dia:
${formatBusinessScheduleLines(config)}
- Nombre del cliente: ${conversation.contact?.name || "Sin nombre"}

REGLAS
- Usa el historial para resolver mensajes como "manana a las 3" o "si, a esa hora".
- Solo marca intent = "schedule" si realmente quiere una cita, reunion, llamada, demo o consulta.
- Si pregunta por horarios o disponibilidad para una cita, tambien es intent = "schedule".
- Si la fecha es del evento, entrega, pedido o cotizacion, NO es una cita del CRM: usa intent = "other" y action = "ignore".
- Si el asistente pregunto "que fecha es tu evento" o pidio datos para cotizar, una respuesta como "17 de octubre" NO debe activar agenda.
- No niegues atencion por calendario salvo que el cliente haya pedido claramente agendar/ser atendido en una fecha u horario.
- Si falta fecha o falta hora, usa action = "ask_missing".
- Si menciona un dia pero no una hora, localDate debe tener ese dia y localTime debe ser null.
- Si menciona una hora pero no un dia, localTime debe tener esa hora y localDate debe ser null.
- Si no hay intencion clara de cita, usa intent = "other" y action = "ignore".
- Si no mencionan duracion, deja durationMinutes en null.
- El titulo debe ser corto y util.
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
        planner: parsePlannerResult(raw || ""),
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
    const planned = await planAppointmentFromConversation(conversationId, latestUserMessage);

    if (!planned?.planner || planned.planner.intent !== "schedule") {
        return { kind: "none", reply: null };
    }

    const { planner, conversation, config } = planned;
    const durationMinutes = Math.min(
        Math.max(planner.durationMinutes || config.defaultDurationMinutes, 15),
        180,
    );
    const bookingContext = await getGoogleCalendarBookingContext();
    const specialistContextText = [
        latestUserMessage,
        ...conversation.messages.map((message) => message.content),
    ].join("\n");
    let selectedSpecialist = await findGoogleSpecialistByMention(specialistContextText);

    if (!selectedSpecialist && bookingContext.specialists.length === 1) {
        selectedSpecialist = bookingContext.specialists[0];
    }

    if (!selectedSpecialist && bookingContext.specialists.length > 1) {
        return {
            kind: "missing",
            reply: buildSpecialistReply(bookingContext.specialists),
        };
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
                    limit: 6,
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

    if (planner.action === "ignore") {
        return { kind: "none", reply: null };
    }

    try {
        const startTime = zonedDateTimeToUtc(planner.localDate, planner.localTime, config.timeZone);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        const title =
            planner.title?.trim() ||
            `Cita con ${getContactFullName(conversation.contact, conversation.contact?.phone || "cliente")}`;

        if (mode === "validate") {
            await validateManagedAppointment({
                startTime,
                endTime,
                googleCalendarId: targetCalendar?.calendarId || undefined,
                blockingCalendarIds,
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
            userId: conversation.assignedUserId || undefined,
            googleCalendarId: targetCalendar?.calendarId || undefined,
            googleCalendarName: targetCalendar?.summary || undefined,
            googleCalendarColor: targetCalendar?.backgroundColor || undefined,
            specialistName: selectedSpecialist?.specialistName || selectedSpecialist?.summary || undefined,
            blockingCalendarIds,
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
                selectedSpecialist?.specialistName || selectedSpecialist?.summary || null,
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
