import crypto from "node:crypto";
import { normalizeMetaCoexistenceChange, metaSyncedMessage } from "./meta-coexistence-webhook.ts";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function string(value: unknown, maxLength = 4_000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asTimestamp(value: unknown) {
    const raw = typeof value === "number" ? value : string(value, 80);
    if (raw === "" || raw === undefined) return undefined;
    const numeric = Number(raw);
    const date = Number.isFinite(numeric)
        ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
        : new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function boolean(value: unknown) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    return false;
}

function containsNonDirectJid(value: unknown): boolean {
    if (!value) return false;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized.includes("@g.us")
            || normalized.includes("@broadcast")
            || normalized.includes("@newsletter");
    }
    if (typeof value === "object") {
        const candidate = record(value);
        const server = string(field(candidate, "Server") || field(candidate, "RawServer"), 80).toLowerCase();
        return ["g.us", "broadcast", "newsletter"].includes(server)
            || Object.values(candidate).some((entry) => containsNonDirectJid(entry));
    }
    return false;
}

function isNonDirectWuzapiChat(info: JsonRecord) {
    if (boolean(field(info, "IsGroup"))) return true;

    return [
        field(info, "Chat"),
        field(info, "RemoteJid"),
        field(info, "Sender"),
        field(info, "Recipient"),
        field(info, "MessageSource"),
    ].some((value) => containsNonDirectJid(value));
}

function field(value: JsonRecord, key: string) {
    const direct = value[key];
    if (direct !== undefined) return direct;
    const normalized = key.toLowerCase();
    const entry = Object.entries(value).find(([name]) => name.toLowerCase() === normalized);
    return entry?.[1];
}

function nested(value: JsonRecord, key: string) {
    return record(field(value, key));
}

function unwrapWuzapiMessage(value: unknown): JsonRecord {
    const message = record(value);
    for (const wrapper of [
        "deviceSentMessage",
        "editedMessage",
        "ephemeralMessage",
        "viewOnceMessage",
        "viewOnceMessageV2",
        "viewOnceMessageV2Extension",
        "documentWithCaptionMessage",
    ]) {
        const wrapped = nested(message, wrapper);
        const inner = field(wrapped, "message");
        if (inner) return unwrapWuzapiMessage(inner);
    }
    return message;
}

function metaMessageText(message: JsonRecord, type: string) {
    if (type === "text") return string(record(message.text).body);
    if (type === "button") return string(record(message.button).text) || "[Botón]";
    if (type === "interactive") {
        const interactive = record(message.interactive);
        return string(record(interactive.button_reply).title) || string(record(interactive.list_reply).title) || "[Respuesta interactiva]";
    }
    if (type === "location") {
        const location = record(message.location);
        return `[Ubicación] ${string(location.name)} ${string(location.address)} https://maps.google.com/?q=${Number(location.latitude)},${Number(location.longitude)}`.trim();
    }
    if (type === "contacts") return `[Contacto]\n${JSON.stringify(message.contacts).slice(0, 3500)}`;
    const media = record(message[type]);
    return string(media.caption) || `[${type}]`;
}

/** Splits a Meta delivery into independently idempotent, tenant-safe envelopes. */
export function normalizeMetaWebhook(payload: unknown, fallbackHash: string, binding?: { wabaId?: string | null; sourceId: string }): Array<{ providerEventId: string; sourceId: string; payload: QueuedWebhookPayload }> {
    const result: Array<{ providerEventId: string; sourceId: string; payload: QueuedWebhookPayload }> = [];
    const root = record(payload);
    if (root.object !== "whatsapp_business_account") return result;
    for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
        for (const rawChange of Array.isArray(record(rawEntry).changes) ? record(rawEntry).changes as unknown[] : []) {
            const change = record(rawChange);
            const value = record(change.value);
            if (change.field !== "messages") {
                result.push(...normalizeMetaCoexistenceChange(string(change.field, 80), value, string(record(rawEntry).id, 160), fallbackHash, binding));
                continue;
            }
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
                if (type === "edit" || type === "revoke") {
                    const changed = metaSyncedMessage(message, sourceId);
                    if (changed?.targetProviderMessageId) result.push({ sourceId, providerEventId: `meta:${sourceId}:change:${providerMessageId}`, payload: changed });
                    continue;
                }
                if (type === "unsupported") {
                    result.push({ sourceId, providerEventId: `meta:${sourceId}:unsupported:${providerMessageId}`, payload: { kind: "sync", sourceType: "meta", sourceId, syncError: "Meta no compartió este mensaje. Revísalo en WhatsApp Business del celular." } });
                    continue;
                }
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
                const messageType = (type === "sticker" ? "image" : ["image", "video", "audio", "document"].includes(type) ? type : "text") as QueuedWebhookPayload["messageType"];
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
        field(message, "conversation"),
        field(message, "text"),
        field(nested(message, "extendedTextMessage"), "text"),
        field(nested(message, "imageMessage"), "caption"),
        field(nested(message, "videoMessage"), "caption"),
        field(nested(message, "documentMessage"), "caption"),
        field(nested(message, "documentMessage"), "fileName"),
    ];
    const body = candidates.map((value) => string(value)).find(Boolean);
    if (body) return body;
    const location = nested(message, "locationMessage");
    if (Object.keys(location).length) return `[Ubicación] ${string(field(location, "name"))} ${string(field(location, "address"))} https://maps.google.com/?q=${Number(field(location, "degreesLatitude"))},${Number(field(location, "degreesLongitude"))}`.trim();
    const contact = nested(message, "contactMessage");
    if (Object.keys(contact).length) return `[Contacto] ${string(field(contact, "displayName"))}\n${string(field(contact, "vcard"), 3500)}`;
    const contacts = field(nested(message, "contactsArrayMessage"), "contacts");
    if (Array.isArray(contacts)) return `[Contactos]\n${JSON.stringify(contacts).slice(0, 3500)}`;
    return "";
}

function wuzapiMessageType(message: JsonRecord): QueuedWebhookPayload["messageType"] {
    if (field(message, "imageMessage")) return "image";
    if (field(message, "stickerMessage")) return "image";
    if (field(message, "videoMessage")) return "video";
    if (field(message, "audioMessage")) return "audio";
    if (field(message, "documentMessage")) return "document";
    return "text";
}

function normalizeJidValue(value: string) {
    return value.replace(/:\d+@/, "@").trim();
}

function isLidAddress(value: unknown): boolean {
    if (!value) return false;
    if (typeof value === "string") {
        return normalizeJidValue(value).toLowerCase().includes("@lid");
    }
    if (typeof value === "object") {
        const candidate = record(value);
        const server = field(candidate, "Server") ?? field(candidate, "RawServer");
        if (typeof server === "string" && server.toLowerCase().includes("lid")) return true;
        const jidString = field(candidate, "String");
        return typeof jidString === "string" && isLidAddress(jidString);
    }
    return false;
}

function extractJidPhone(value: unknown): string {
    if (!value || isLidAddress(value)) return "";
    if (typeof value === "string") {
        const normalized = normalizeJidValue(value);
        return (normalized.includes("@") ? normalized.split("@")[0] : normalized).replace(/\D/g, "");
    }
    if (typeof value === "object") {
        const candidate = record(value);
        const user = field(candidate, "User");
        if (typeof user === "string") return user.replace(/\D/g, "");
        const jidString = field(candidate, "String");
        if (typeof jidString === "string") return extractJidPhone(jidString);
    }
    return "";
}

/** Mirrors the proven WuzAPI sender resolution used by the legacy CRM. */
function resolveWuzapiPhone(info: JsonRecord, fromMe: boolean) {
    const candidates = fromMe
        ? [
            field(info, "RecipientAlt"),
            field(info, "Recipient"),
            field(info, "Chat"),
            field(info, "RemoteJid"),
        ]
        : [
            field(info, "Chat"),
            field(info, "SenderAlt"),
            field(info, "RecipientAlt"),
            field(info, "Sender"),
        ];
    const seen = new Set<string>();
    return candidates
        .map(extractJidPhone)
        .filter((candidate) => candidate.length >= 8 && candidate.length <= 15)
        .find((candidate) => {
            if (seen.has(candidate)) return false;
            seen.add(candidate);
            return true;
        }) || "";
}

/** Normalizes the supported WuzAPI webhook variants without importing the legacy webhook route. */
export function normalizeWuzapiWebhook(payload: unknown, externalAccountId: string, fallbackHash: string): { providerEventId: string; payload: QueuedWebhookPayload } {
    let root = record(payload);
    const jsonData = field(root, "jsonData");
    if (typeof jsonData === "string") {
        try { root = { ...root, ...record(JSON.parse(jsonData)) }; } catch { /* invalid envelope is ignored below */ }
    }
    const event = nested(root, "event");
    const rawInfo = record(field(event, "Info") || field(root, "Info"));
    const info = { ...nested(rawInfo, "MessageSource"), ...rawInfo };
    const message = unwrapWuzapiMessage(event.Message || event.message || root.Message || root.message);
    const rawId = string(info.ID || info.Id || info.id || root.id, 300);
    const providerEventId = `wuzapi:message:${externalAccountId}:${rawId || fallbackHash}`;
    const fromMe = boolean(field(info, "IsFromMe"));
    const phone = resolveWuzapiPhone(info, fromMe);
    // Outgoing PushName belongs to the CRM owner, not the recipient.
    const contactName = string(fromMe
        ? field(info, "RecipientName") || field(info, "RecipientPushName")
        : field(info, "PushName") || field(event, "PushName") || field(root, "PushName"), 160) || undefined;
    const messageType = wuzapiMessageType(message);
    const isSticker = Boolean(field(message, "stickerMessage"));
    const media = nested(message, isSticker ? "stickerMessage" : `${messageType}Message`);
    const reaction = nested(message, "reactionMessage");
    const reactionTarget = string(field(nested(reaction, "key"), "id"), 300);
    if (phone && !isNonDirectWuzapiChat(info) && reactionTarget) return {
        providerEventId: `wuzapi:reaction:${externalAccountId}:${rawId || fallbackHash}`,
        payload: { kind: "reaction", sourceType: "wuzapi", sourceId: externalAccountId, providerMessageId: rawId || undefined, targetProviderMessageId: reactionTarget, reaction: string(field(reaction, "text"), 32) || null },
    };
    const mediaDownload = wuzapiDownloadDescriptor(media);
    const s3 = nested(root, "s3");
    const content = wuzapiText(message)
        || (isSticker ? "[Sticker]" : messageType === "image" ? "[Imagen]"
            : messageType === "video" ? "[Video]"
                : messageType === "audio" ? "[Audio]"
                    : messageType === "document" ? "[Documento]"
                        : "");
    const isProtocolEvent = Boolean(field(message, "protocolMessage"));
    const isNonDirectChat = isNonDirectWuzapiChat(info);
    return {
        providerEventId,
        payload: phone && Object.keys(info).length > 0 && content && !isProtocolEvent && !isNonDirectChat
            ? {
                kind: "message", sourceType: "wuzapi", sourceId: externalAccountId, providerMessageId: rawId || undefined,
                phone, contactName, content, messageType,
                mediaMimeType: string(field(media, "mimetype") || field(root, "mimeType") || field(s3, "mimeType"), 160) || undefined,
                mediaFileName: string(field(media, "fileName") || field(root, "fileName") || field(s3, "fileName"), 255) || undefined,
                ...(mediaDownload ? { mediaDownload, mediaDownloadKind: isSticker ? "sticker" : messageType as "image" | "audio" | "video" | "document" } : {}),
                ...(!mediaDownload && string(field(root, "base64"), 25 * 1024 * 1024) ? { mediaBase64: string(field(root, "base64"), 25 * 1024 * 1024) } : {}),
                ...(string(field(s3, "url"), 4000) ? { mediaRemoteUrl: string(field(s3, "url"), 4000) } : {}),
                direction: fromMe ? "outbound" : "inbound", occurredAt: asTimestamp(info.Timestamp || info.timestamp || event.Timestamp || event.timestamp),
            }
            : { kind: "ignored", sourceType: "wuzapi", sourceId: externalAccountId },
    };
}

/** Same download fields as zen_crm_go, retained for tenant-scoped authenticated download. */
function wuzapiDownloadDescriptor(media: JsonRecord): QueuedWebhookPayload["mediaDownload"] | undefined {
    const Url = string(field(media, "URL"));
    const MediaKey = string(field(media, "mediaKey"), 300);
    const Mimetype = string(field(media, "mimetype"), 160);
    const FileSHA256 = string(field(media, "fileSHA256"), 300);
    const FileLength = Number(field(media, "fileLength"));
    if (!Url || !MediaKey || !Mimetype || !FileSHA256 || !Number.isSafeInteger(FileLength) || FileLength <= 0) return undefined;
    return { Url, MediaKey, Mimetype, FileSHA256, FileLength,
        DirectPath: string(field(media, "directPath")) || undefined,
        FileEncSHA256: string(field(media, "fileEncSHA256"), 300) || undefined };
}

export function webhookBodyHash(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
