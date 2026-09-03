import crypto from "node:crypto";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function string(value: unknown, maxLength = 4_000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asTimestamp(value: unknown) {
    const numeric = typeof value === "number" ? value : Number(string(value, 40));
    if (!Number.isFinite(numeric)) return undefined;
    const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function boolean(value: unknown) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    return false;
}

function metaMessageText(message: JsonRecord, type: string) {
    if (type === "text") return string(record(message.text).body);
    if (type === "button") return string(record(message.button).text) || "[Botón]";
    if (type === "interactive") {
        const interactive = record(message.interactive);
        return string(record(interactive.button_reply).title) || string(record(interactive.list_reply).title) || "[Respuesta interactiva]";
    }
    const media = record(message[type]);
    return string(media.caption) || `[${type}]`;
}

/** Splits a Meta delivery into independently idempotent, tenant-safe envelopes. */
export function normalizeMetaWebhook(payload: unknown, fallbackHash: string): Array<{ providerEventId: string; sourceId: string; payload: QueuedWebhookPayload }> {
    const result: Array<{ providerEventId: string; sourceId: string; payload: QueuedWebhookPayload }> = [];
    const root = record(payload);
    if (root.object !== "whatsapp_business_account") return result;
    for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
        for (const rawChange of Array.isArray(record(rawEntry).changes) ? record(rawEntry).changes as unknown[] : []) {
            const change = record(rawChange);
            if (change.field !== "messages") continue;
            const value = record(change.value);
            const sourceId = string(record(value.metadata).phone_number_id, 160);
            if (!sourceId) continue;
            const contacts = new Map((Array.isArray(value.contacts) ? value.contacts : []).map((contact) => {
                const current = record(contact);
                return [string(current.wa_id, 80), string(record(current.profile).name, 160)];
            }));

            for (const rawStatus of Array.isArray(value.statuses) ? value.statuses : []) {
                const status = record(rawStatus);
                const providerMessageId = string(status.id, 300);
                if (!providerMessageId) continue;
                const received = string(status.status, 30);
                const messageStatus = received === "read" ? "read" : received === "delivered" ? "delivered" : received === "failed" ? "failed" : "sent";
                result.push({
                    providerEventId: `meta:status:${providerMessageId}:${messageStatus}`,
                    sourceId,
                    payload: { kind: "status", sourceType: "meta", sourceId, providerMessageId, messageStatus, occurredAt: asTimestamp(status.timestamp) },
                });
            }

            for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
                const message = record(rawMessage);
                const providerMessageId = string(message.id, 300);
                const phone = string(message.from, 80).replace(/\D/g, "");
                const type = string(message.type, 40) || "text";
                if (!providerMessageId || !phone) continue;
                if (type === "reaction") {
                    const reaction = record(message.reaction);
                    const targetProviderMessageId = string(reaction.message_id, 300);
                    if (!targetProviderMessageId) continue;
                    result.push({
                        providerEventId: `meta:reaction:${providerMessageId}`,
                        sourceId,
                        payload: { kind: "reaction", sourceType: "meta", sourceId, providerMessageId, targetProviderMessageId, reaction: string(reaction.emoji, 32) || null, occurredAt: asTimestamp(message.timestamp) },
                    });
                    continue;
                }
                const messageType = (["image", "video", "audio", "document"].includes(type) ? type : "text") as QueuedWebhookPayload["messageType"];
                const media = record(message[type]);
                result.push({
                    providerEventId: `meta:message:${providerMessageId}`,
                    sourceId,
                    payload: {
                        kind: "message", sourceType: "meta", sourceId, providerMessageId, phone,
                        contactName: contacts.get(phone) || undefined,
                        content: metaMessageText(message, type), messageType, direction: "inbound",
                        occurredAt: asTimestamp(message.timestamp),
                        providerMediaId: string(media.id, 300) || undefined,
                        mediaMimeType: string(media.mime_type, 160) || undefined,
                        mediaFileName: string(media.filename, 255) || undefined,
                    },
                });
            }
        }
    }
    if (result.length === 0) {
        result.push({
            providerEventId: `meta:ignored:${fallbackHash}`,
            sourceId: "unknown",
            payload: { kind: "ignored", sourceType: "meta", sourceId: "unknown" },
        });
    }
    return result;
}

function wuzapiText(message: JsonRecord) {
    const candidates = [
        message.conversation,
        message.text,
        record(message.extendedTextMessage).text,
        record(message.imageMessage).caption,
        record(message.videoMessage).caption,
        record(message.documentMessage).caption,
    ];
    return candidates.map((value) => string(value)).find(Boolean) || "[Mensaje de WhatsApp]";
}

function wuzapiMessageType(message: JsonRecord): QueuedWebhookPayload["messageType"] {
    if (message.imageMessage) return "image";
    if (message.videoMessage) return "video";
    if (message.audioMessage) return "audio";
    if (message.documentMessage) return "document";
    return "text";
}

/** Normalizes the supported WuzAPI webhook variants without importing the legacy webhook route. */
export function normalizeWuzapiWebhook(payload: unknown, externalAccountId: string, fallbackHash: string): { providerEventId: string; payload: QueuedWebhookPayload } {
    const root = record(payload);
    const event = record(root.event);
    const info = record(event.Info || event.info || root.Info || root.info);
    const message = record(event.Message || event.message || root.Message || root.message);
    const rawId = string(info.ID || info.Id || info.id || root.id, 300);
    const providerEventId = `wuzapi:message:${externalAccountId}:${rawId || fallbackHash}`;
    const fromMe = boolean(info.IsFromMe ?? info.isFromMe);
    const phone = string(fromMe ? (info.RecipientAlt || info.recipientAlt || info.Chat || info.chat) : (info.SenderAlt || info.senderAlt || info.Chat || info.chat), 160)
        .replace(/@.+$/, "").replace(/\D/g, "");
    const contactName = string(event.PushName || event.pushName || root.PushName || root.pushName, 160) || undefined;
    return {
        providerEventId,
        payload: phone && Object.keys(info).length > 0
            ? {
                kind: "message", sourceType: "wuzapi", sourceId: externalAccountId, providerMessageId: rawId || undefined,
                phone, contactName, content: wuzapiText(message), messageType: wuzapiMessageType(message),
                direction: fromMe ? "outbound" : "inbound", occurredAt: asTimestamp(info.Timestamp || info.timestamp || event.Timestamp || event.timestamp),
            }
            : { kind: "ignored", sourceType: "wuzapi", sourceId: externalAccountId },
    };
}

export function webhookBodyHash(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
