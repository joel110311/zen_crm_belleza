import crypto from "crypto";
import { prisma } from "@/lib/db";
import {
    MESSAGE_SOURCE_META,
    MESSAGE_SOURCE_WUZAPI,
    normalizeMessageSourceType,
    resolveMessageSourceId,
    type MessageSourceType,
} from "@/lib/message-source";
import {
    findOrCreateActiveConversationForContactSource,
} from "@/lib/source-conversations";
import { getSystemSettingsOrDefaults, type AppSystemSettings } from "@/lib/system-settings";
import { buildOperationContext } from "@/lib/operation-context";
import {
    findOrCreateActiveConversationForContact,
    sendOutboundConversationMessage,
} from "@/lib/outbound-messages";
import { sendMetaTemplateMessage } from "@/lib/meta-whatsapp";

const DEFAULT_REMINDER_OFFSETS_MINUTES = [1440, 240];
const MAX_REMINDER_ATTEMPTS = 3;
const WORKER_LOCK_TTL_MS = 60_000;

const appointmentInclude = {
    contact: true,
    patient: true,
    specialist: true,
} as const;

type ReminderAppointment = Awaited<ReturnType<typeof loadAppointmentForReminder>>;

function getAppBaseUrl() {
    return (
        process.env.APP_BASE_URL ||
        process.env.AUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3006"
    ).replace(/\/+$/, "");
}

function makePublicToken() {
    return crypto.randomUUID().replace(/-/g, "");
}

function appointmentPatientName(appointment: NonNullable<ReminderAppointment>) {
    const patientName = [appointment.patient?.firstName, appointment.patient?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
    const contactName = [appointment.contact?.name, appointment.contact?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

    return patientName || contactName || appointment.title || "Cliente";
}

function specialistLabel(appointment: NonNullable<ReminderAppointment>) {
    const specialist = appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName;
    return specialist ? `Especialista: ${specialist}` : "";
}

function normalizeOffsets(value: unknown) {
    const raw = Array.isArray(value) ? value : DEFAULT_REMINDER_OFFSETS_MINUTES;
    const offsets = Array.from(
        new Set(
            raw
                .map((entry) => Number.parseInt(String(entry), 10))
                .filter((entry) => Number.isFinite(entry) && entry >= 15 && entry <= 10080),
        ),
    ).sort((left, right) => right - left);

    return offsets.length > 0 ? offsets : DEFAULT_REMINDER_OFFSETS_MINUTES;
}

function reminderLabel(offsetMinutes: number) {
    if (offsetMinutes % 1440 === 0) {
        const days = offsetMinutes / 1440;
        return `${days}d`;
    }
    if (offsetMinutes % 60 === 0) {
        const hours = offsetMinutes / 60;
        return `${hours}h`;
    }
    return `${offsetMinutes}min`;
}

function normalizeProvider(value: unknown): MessageSourceType {
    return normalizeMessageSourceType(typeof value === "string" ? value : MESSAGE_SOURCE_WUZAPI);
}

export function getAppointmentReminderSettings(settings: AppSystemSettings) {
    const provider = normalizeProvider(settings.appointmentReminderProvider);

    return {
        enabled: Boolean(settings.appointmentRemindersEnabled && settings.reminderWhatsAppEnabled),
        offsets: normalizeOffsets(settings.appointmentReminderOffsets),
        provider,
        messageKind: provider === MESSAGE_SOURCE_META ? "template" : "text",
        sendOnlyConfirmed: Boolean(settings.appointmentReminderSendOnlyConfirmed),
        wuzapiTemplate: settings.appointmentReminderWuzapiTemplate || "",
        metaTemplate24h: settings.appointmentReminderMetaTemplate24h || "",
        metaTemplate4h: settings.appointmentReminderMetaTemplate4h || "",
        metaLanguage: settings.appointmentReminderMetaLanguage || "es",
    };
}

async function loadAppointmentForReminder(appointmentId: string) {
    return prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: appointmentInclude,
    });
}

async function ensureAppointmentContact(appointment: NonNullable<ReminderAppointment>) {
    if (appointment.contact) {
        return appointment.contact;
    }

    const phone = appointment.patient?.phone?.trim();
    if (!phone) {
        return null;
    }

    const contact = await prisma.contact.upsert({
        where: { phone },
        create: {
            phone,
            name: appointment.patient?.firstName || null,
            lastName: appointment.patient?.lastName || null,
            email: appointment.patient?.email || null,
            status: "customer",
        },
        update: {
            name: appointment.patient?.firstName || undefined,
            lastName: appointment.patient?.lastName || undefined,
            email: appointment.patient?.email || undefined,
            status: "customer",
        },
    });

    await prisma.$transaction([
        prisma.appointment.update({
            where: { id: appointment.id },
            data: { contactId: contact.id },
        }),
        ...(appointment.patientId
            ? [
                prisma.patient.update({
                    where: { id: appointment.patientId },
                    data: { contactId: contact.id },
                }),
            ]
            : []),
    ]);

    return contact;
}

async function ensureAppointmentPublicToken(appointment: NonNullable<ReminderAppointment>) {
    if (appointment.publicToken) {
        return appointment.publicToken;
    }

    const updated = await prisma.appointment.update({
        where: { id: appointment.id },
        data: { publicToken: makePublicToken() },
        select: { publicToken: true },
    });

    return updated.publicToken;
}

function isReminderEligible(
    appointment: NonNullable<ReminderAppointment>,
    settings: AppSystemSettings,
    now = new Date(),
) {
    const reminderSettings = getAppointmentReminderSettings(settings);
    if (!reminderSettings.enabled) {
        return { eligible: false, reason: "Los recordatorios automaticos estan desactivados." };
    }

    if (appointment.remindersOptOut) {
        return { eligible: false, reason: "Los recordatorios estan desactivados para esta cita." };
    }

    if (["cancelled", "completed", "no_show"].includes(appointment.status)) {
        return { eligible: false, reason: "La cita ya no requiere recordatorio." };
    }

    const isPortalRequest = appointment.source === "portal";
    if (isPortalRequest && reminderSettings.sendOnlyConfirmed && appointment.confirmationStatus !== "confirmed") {
        return { eligible: false, reason: "La solicitud del portal aún no está confirmada por el equipo." };
    }

    if (appointment.startTime <= now) {
        return { eligible: false, reason: "La cita ya inicio o esta vencida." };
    }

    return { eligible: true, reason: "" };
}

function buildReminderContext(
    appointment: NonNullable<ReminderAppointment>,
    settings: AppSystemSettings,
    offsetMinutes = 0,
) {
    const operationContext = buildOperationContext(settings);
    const startTime = new Date(appointment.startTime);
    const date = new Intl.DateTimeFormat(operationContext.locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: operationContext.timeZone,
    }).format(startTime);
    const time = new Intl.DateTimeFormat(operationContext.locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: operationContext.timeZone,
    }).format(startTime);
    const link = appointment.publicToken
        ? `${getAppBaseUrl()}/portal/turno/${appointment.publicToken}`
        : "";

    return {
        cliente: appointmentPatientName(appointment),
        fecha: date,
        hora: time,
        especialista: specialistLabel(appointment),
        clinica: settings.portalClinicName || "Zen CRM Oftalmo",
        motivo: appointment.title || appointment.appointmentType || "Consulta",
        modalidad: appointment.visitMode === "virtual" ? "Virtual" : appointment.visitMode === "hibrida" ? "Hibrida" : "Presencial",
        link_turno: link,
        anticipacion: reminderLabel(offsetMinutes),
    };
}

function renderReminderTemplate(template: string, context: Record<string, string>) {
    return template.replace(/{{\s*([\w_]+)\s*}}/g, (_match, key: string) => context[key] ?? "");
}

export function renderAppointmentReminderText(
    appointment: NonNullable<ReminderAppointment>,
    settings: AppSystemSettings,
    offsetMinutes = 0,
) {
    const reminderSettings = getAppointmentReminderSettings(settings);
    const context = buildReminderContext(appointment, settings, offsetMinutes);
    const template = reminderSettings.wuzapiTemplate.trim() || [
        "Hola {{cliente}}, te recordamos tu cita en {{clinica}}.",
        "",
        "Fecha y hora: {{fecha}} a las {{hora}}.",
        "{{especialista}}",
        "",
        "Si necesitas cambiar tu cita, responde a este WhatsApp.",
    ].join("\n");

    return renderReminderTemplate(template, context)
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line, index, lines) => line || lines[index - 1])
        .join("\n")
        .trim();
}

function buildMetaReminderComponents(
    appointment: NonNullable<ReminderAppointment>,
    settings: AppSystemSettings,
    offsetMinutes: number,
) {
    const context = buildReminderContext(appointment, settings, offsetMinutes);

    return [{
        type: "BODY" as const,
        parameters: [
            context.cliente,
            context.fecha,
            context.hora,
            context.especialista.replace(/^Especialista:\s*/, "") || "-",
            context.clinica,
            context.link_turno || "-",
            context.motivo,
            context.anticipacion,
        ].map((text) => ({
            type: "text" as const,
            text,
        })),
    }];
}

async function sendWuzapiReminder(params: {
    appointment: NonNullable<ReminderAppointment>;
    contactId: string;
    content: string;
}) {
    const conversation = await findOrCreateActiveConversationForContact(params.contactId);
    return sendOutboundConversationMessage({
        conversationId: conversation.id,
        content: params.content,
        type: "text",
        preserveBotActive: true,
        senderType: "system",
        sourceType: MESSAGE_SOURCE_WUZAPI,
    });
}

async function sendMetaReminder(params: {
    appointment: NonNullable<ReminderAppointment>;
    contactId: string;
    phone: string;
    content: string;
    settings: AppSystemSettings;
    offsetMinutes: number;
}) {
    const reminderSettings = getAppointmentReminderSettings(params.settings);
    const templateName = params.offsetMinutes >= 1440
        ? reminderSettings.metaTemplate24h
        : reminderSettings.metaTemplate4h;

    if (!templateName.trim()) {
        throw new Error(`Falta configurar la plantilla de WhatsApp API para ${reminderLabel(params.offsetMinutes)}.`);
    }

    const sourceId = resolveMessageSourceId(MESSAGE_SOURCE_META, params.settings);
    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: params.contactId,
        sourceType: MESSAGE_SOURCE_META,
        sourceId,
        defaults: {
            botActive: false,
            sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
    });
    const message = await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: params.content || `[Plantilla: ${templateName}]`,
            direction: "outbound",
            status: "sending",
            type: "template",
            senderType: "system",
            sourceType: MESSAGE_SOURCE_META,
            sourceId,
        },
    });

    try {
        const result = await sendMetaTemplateMessage({
            to: params.phone,
            templateName,
            languageCode: reminderSettings.metaLanguage,
            components: buildMetaReminderComponents(params.appointment, params.settings, params.offsetMinutes),
        });
        const updatedMessage = await prisma.message.update({
            where: { id: message.id },
            data: {
                status: "sent",
                providerMessageId: result.Id || null,
            },
        });

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
                sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                botActive: false,
            },
        });

        return {
            message: updatedMessage,
            conversation,
        };
    } catch (error) {
        await prisma.message.update({
            where: { id: message.id },
            data: { status: "failed" },
        });
        throw error;
    }
}

async function sendPreparedReminder(params: {
    appointment: NonNullable<ReminderAppointment>;
    offsetMinutes: number;
    settings: AppSystemSettings;
}) {
    const appointment = params.appointment;
    const token = params.settings.confirmationLinkEnabled
        ? await ensureAppointmentPublicToken(appointment)
        : appointment.publicToken;
    const appointmentWithToken = token
        ? { ...appointment, publicToken: token }
        : appointment;
    const contact = await ensureAppointmentContact(appointmentWithToken);

    if (!contact?.id || !contact.phone) {
        throw new Error("La cita no tiene teléfono de cliente para WhatsApp.");
    }

    const content = renderAppointmentReminderText(appointmentWithToken, params.settings, params.offsetMinutes);
    const provider = getAppointmentReminderSettings(params.settings).provider;

    return provider === MESSAGE_SOURCE_META
        ? sendMetaReminder({
            appointment: appointmentWithToken,
            contactId: contact.id,
            phone: contact.phone,
            content,
            settings: params.settings,
            offsetMinutes: params.offsetMinutes,
        })
        : sendWuzapiReminder({
            appointment: appointmentWithToken,
            contactId: contact.id,
            content,
        });
}

export async function refreshAppointmentReminderStatus(appointmentId: string) {
    const reminders = await prisma.appointmentReminder.findMany({
        where: { appointmentId },
        select: { status: true },
    });

    const status = reminders.some((reminder) => ["queued", "sending"].includes(reminder.status))
        ? "queued"
        : reminders.some((reminder) => reminder.status === "failed")
            ? "failed"
            : reminders.some((reminder) => reminder.status === "sent")
                ? "sent"
                : "pending";

    await prisma.appointment.update({
        where: { id: appointmentId },
        data: { reminderStatus: status },
    }).catch(() => undefined);

    return status;
}

export async function cancelAppointmentReminders(appointmentId: string, reason = "cancelled") {
    await prisma.appointmentReminder.updateMany({
        where: {
            appointmentId,
            status: { in: ["queued", "sending", "failed", "skipped"] },
        },
        data: {
            status: "cancelled",
            lastError: reason,
            lockId: null,
            lockExpiresAt: null,
        },
    });

    await refreshAppointmentReminderStatus(appointmentId);
}

export async function syncAppointmentReminders(appointmentId: string) {
    const [settings, appointment] = await Promise.all([
        getSystemSettingsOrDefaults(),
        loadAppointmentForReminder(appointmentId),
    ]);

    if (!appointment) {
        return { success: false, error: "La cita no existe." };
    }

    const eligibility = isReminderEligible(appointment, settings);
    if (!eligibility.eligible) {
        await cancelAppointmentReminders(appointmentId, eligibility.reason);
        return { success: true, scheduled: 0, skipped: 0, reason: eligibility.reason };
    }

    const reminderSettings = getAppointmentReminderSettings(settings);
    const now = new Date();
    const existing = await prisma.appointmentReminder.findMany({
        where: { appointmentId },
    });
    const existingByOffset = new Map(existing.map((reminder) => [reminder.offsetMinutes, reminder]));
    let scheduled = 0;
    let skipped = 0;

    for (const offsetMinutes of reminderSettings.offsets) {
        const label = reminderLabel(offsetMinutes);
        const scheduledFor = new Date(appointment.startTime.getTime() - offsetMinutes * 60 * 1000);
        const current = existingByOffset.get(offsetMinutes);

        if (scheduledFor <= now) {
            skipped += 1;
            if (current && !["sent", "sending"].includes(current.status)) {
                await prisma.appointmentReminder.update({
                    where: { id: current.id },
                    data: {
                        label,
                        scheduledFor,
                        status: "skipped",
                        lastError: "La ventana de envio ya paso.",
                        provider: reminderSettings.provider,
                        messageKind: reminderSettings.messageKind,
                        lockId: null,
                        lockExpiresAt: null,
                    },
                });
            }
            continue;
        }

        scheduled += 1;
        const data = {
            label,
            scheduledFor,
            provider: reminderSettings.provider,
            messageKind: reminderSettings.messageKind,
            status: "queued",
            lastError: null,
            lockId: null,
            lockExpiresAt: null,
        };

        if (current) {
            if (!["sent", "sending"].includes(current.status)) {
                await prisma.appointmentReminder.update({
                    where: { id: current.id },
                    data,
                });
            }
        } else {
            await prisma.appointmentReminder.create({
                data: {
                    appointmentId,
                    offsetMinutes,
                    channel: "whatsapp",
                    ...data,
                },
            });
        }
    }

    const configuredOffsets = new Set(reminderSettings.offsets);
    await prisma.appointmentReminder.updateMany({
        where: {
            appointmentId,
            offsetMinutes: { notIn: [...configuredOffsets] },
            status: { notIn: ["sent", "cancelled"] },
        },
        data: {
            status: "cancelled",
            lastError: "El offset ya no esta configurado.",
            lockId: null,
            lockExpiresAt: null,
        },
    });

    await refreshAppointmentReminderStatus(appointmentId);
    return { success: true, scheduled, skipped };
}

export async function syncFutureAppointmentReminders(limit = 500) {
    const appointments = await prisma.appointment.findMany({
        where: {
            startTime: { gt: new Date() },
            status: { notIn: ["cancelled", "completed", "no_show"] },
            remindersOptOut: false,
        },
        select: { id: true },
        orderBy: { startTime: "asc" },
        take: Math.max(1, limit),
    });

    let scheduled = 0;
    for (const appointment of appointments) {
        const result = await syncAppointmentReminders(appointment.id);
        if (result.success) {
            scheduled += result.scheduled || 0;
        }
    }

    return { success: true, appointments: appointments.length, scheduled };
}

export async function sendImmediateAppointmentReminder(appointmentId: string) {
    const [settings, appointment] = await Promise.all([
        getSystemSettingsOrDefaults(),
        loadAppointmentForReminder(appointmentId),
    ]);

    if (!appointment) {
        return { success: false, error: "La cita no existe." };
    }

    if (!settings.reminderWhatsAppEnabled) {
        return { success: false, error: "Los recordatorios por WhatsApp estan desactivados." };
    }

    try {
        const result = await sendPreparedReminder({
            appointment,
            offsetMinutes: 0,
            settings,
        });
        await prisma.appointment.update({
            where: { id: appointmentId },
            data: { reminderStatus: "sent" },
        });

        return {
            success: true,
            messageId: result.message.id,
            providerMessageId: result.message.providerMessageId,
        };
    } catch (error) {
        await prisma.appointment.update({
            where: { id: appointmentId },
            data: { reminderStatus: "failed" },
        }).catch(() => undefined);
        return {
            success: false,
            error: error instanceof Error ? error.message : "No se pudo enviar el recordatorio.",
        };
    }
}

export async function prepareManualAppointmentReminderDraft(appointmentId: string) {
    const [settings, appointment] = await Promise.all([
        getSystemSettingsOrDefaults(),
        loadAppointmentForReminder(appointmentId),
    ]);

    if (!appointment) {
        return { success: false as const, error: "La cita no existe." };
    }

    if (!settings.reminderWhatsAppEnabled) {
        return { success: false as const, error: "Los recordatorios por WhatsApp están desactivados." };
    }

    if (["cancelled", "completed", "no_show"].includes(appointment.status)) {
        return { success: false as const, error: "Esta cita ya está cerrada y no se puede notificar." };
    }

    if (appointment.startTime <= new Date()) {
        return { success: false as const, error: "Esta cita ya inició o está vencida. No se puede preparar la notificación." };
    }

    const token = settings.confirmationLinkEnabled
        ? await ensureAppointmentPublicToken(appointment)
        : appointment.publicToken;
    const appointmentWithToken = token
        ? { ...appointment, publicToken: token }
        : appointment;
    const contact = await ensureAppointmentContact(appointmentWithToken);

    if (!contact?.id || !contact.phone) {
        return { success: false as const, error: "La cita no tiene teléfono de cliente para WhatsApp." };
    }

    const conversation = await findOrCreateActiveConversationForContact(contact.id);
    const content = renderAppointmentReminderText(appointmentWithToken, settings, 0);

    return {
        success: true as const,
        conversationId: conversation.id,
        contactId: contact.id,
        content,
    };
}

export async function sendAppointmentReminderJob(reminderId: string, expectedLockId?: string) {
    const reminder = await prisma.appointmentReminder.findUnique({
        where: { id: reminderId },
        include: {
            appointment: {
                include: appointmentInclude,
            },
        },
    });

    if (!reminder) {
        return { success: false, error: "El recordatorio no existe." };
    }

    if (expectedLockId && reminder.lockId !== expectedLockId) {
        return { success: false, error: "El recordatorio ya fue tomado por otro proceso." };
    }

    if (reminder.status === "sent") {
        return { success: true, skipped: true };
    }

    const settings = await getSystemSettingsOrDefaults();
    const eligibility = isReminderEligible(reminder.appointment, settings);
    if (!eligibility.eligible) {
        await prisma.appointmentReminder.update({
            where: { id: reminder.id },
            data: {
                status: "skipped",
                lastError: eligibility.reason,
                lockId: null,
                lockExpiresAt: null,
            },
        });
        await refreshAppointmentReminderStatus(reminder.appointmentId);
        return { success: true, skipped: true };
    }

    try {
        if (reminder.status !== "sending") {
            await prisma.appointmentReminder.update({
                where: { id: reminder.id },
                data: {
                    status: "sending",
                    lockId: expectedLockId || crypto.randomUUID(),
                    lockExpiresAt: new Date(Date.now() + WORKER_LOCK_TTL_MS),
                },
            });
        }

        const result = await sendPreparedReminder({
            appointment: reminder.appointment,
            offsetMinutes: reminder.offsetMinutes,
            settings,
        });

        await prisma.appointmentReminder.update({
            where: { id: reminder.id },
            data: {
                status: "sent",
                attempts: { increment: 1 },
                sentAt: new Date(),
                messageId: result.message.id,
                providerMessageId: result.message.providerMessageId,
                lastError: null,
                lockId: null,
                lockExpiresAt: null,
            },
        });
        await refreshAppointmentReminderStatus(reminder.appointmentId);

        return { success: true, messageId: result.message.id };
    } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo enviar el recordatorio.";
        await prisma.appointmentReminder.update({
            where: { id: reminder.id },
            data: {
                status: "failed",
                attempts: { increment: 1 },
                lastError: message,
                lockId: null,
                lockExpiresAt: null,
            },
        });
        await refreshAppointmentReminderStatus(reminder.appointmentId);
        return { success: false, error: message };
    }
}

export async function retryAppointmentReminder(reminderId: string) {
    const lockId = crypto.randomUUID();
    const claimed = await prisma.appointmentReminder.updateMany({
        where: {
            id: reminderId,
            status: { in: ["queued", "failed", "skipped"] },
        },
        data: {
            status: "sending",
            lockId,
            lockExpiresAt: new Date(Date.now() + WORKER_LOCK_TTL_MS),
        },
    });

    if (claimed.count !== 1) {
        return { success: false, error: "El recordatorio no esta disponible para reintento." };
    }

    return sendAppointmentReminderJob(reminderId, lockId);
}

export async function processDueAppointmentReminders(limit = 25) {
    const now = new Date();
    const candidates = await prisma.appointmentReminder.findMany({
        where: {
            status: "queued",
            scheduledFor: { lte: now },
            attempts: { lt: MAX_REMINDER_ATTEMPTS },
            OR: [
                { lockExpiresAt: null },
                { lockExpiresAt: { lt: now } },
            ],
        },
        orderBy: { scheduledFor: "asc" },
        take: Math.max(1, limit),
    });

    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const reminder of candidates) {
        const lockId = crypto.randomUUID();
        const claimed = await prisma.appointmentReminder.updateMany({
            where: {
                id: reminder.id,
                status: "queued",
                scheduledFor: { lte: now },
                OR: [
                    { lockExpiresAt: null },
                    { lockExpiresAt: { lt: now } },
                ],
            },
            data: {
                status: "sending",
                lockId,
                lockExpiresAt: new Date(Date.now() + WORKER_LOCK_TTL_MS),
            },
        });

        if (claimed.count === 1) {
            const result = await sendAppointmentReminderJob(reminder.id, lockId);
            results.push({ id: reminder.id, success: result.success, error: result.error });
        }
    }

    return {
        success: true,
        processed: results.length,
        results,
    };
}
