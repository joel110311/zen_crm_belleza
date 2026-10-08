import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";
import { normalizeMetaRecipient } from "./phone.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown, max = 4000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const list = (value: unknown) => Array.isArray(value) ? value : [];
const digits = (value: unknown) => text(value, 80).replace(/\D/g, "");
function timestamp(value: unknown) {
    const n = Number(value); const d = new Date(n * 1000); return value !== undefined && value !== "" && Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}
type Envelope = { providerEventId: string; sourceId: string; payload: QueuedWebhookPayload };

export function metaSyncedMessage(raw: unknown, sourceId: string, options: { historical?: boolean; phone?: string; outbound?: boolean } = {}): QueuedWebhookPayload | null {
    const message = record(raw);
    const id = text(message.id, 300);
    const outbound = options.outbound ?? Boolean(message.to);
    if (text(outbound ? message.to : message.from, 80).includes("@")) return null;
    const phone = options.phone || digits(outbound ? message.to : message.from);
    if (!id || !phone || /@/.test(phone)) return null;
    const rawType = text(message.type, 40) || "text";
    const change = rawType === "edit" ? record(message.edit) : record(message.revoke);
    if (["edit", "revoke", "reaction"].includes(rawType) && !text(rawType === "reaction" ? record(message.reaction).message_id : change.original_message_id, 300)) return null;
    const body = rawType === "edit" ? record(change.message) : message;
    const type = text(body.type, 40) || rawType;
    const media = record(body[type]);
    const messageType = (type === "sticker" ? "image" : ["image", "video", "audio", "document"].includes(type) ? type : "text") as QueuedWebhookPayload["messageType"];
    const content = type === "text" ? text(record(body.text).body) : text(media.caption)
        || (type === "location" ? `[Ubicación] ${text(record(body.location).name)} https://maps.google.com/?q=${Number(record(body.location).latitude)},${Number(record(body.location).longitude)}`
        : type === "contacts" ? `[Contacto] ${JSON.stringify(body.contacts).slice(0, 3500)}`
        : type === "media_placeholder" ? "[Archivo histórico: WhatsApp aún no compartió el contenido]" : `[${type}]`);
    const status = text(record(message.history_context).status, 30).toUpperCase();
    return { kind: rawType === "edit" || rawType === "revoke" ? "message_change" : rawType === "reaction" ? "reaction" : "message",
        sourceType: "meta", sourceId, providerMessageId: id, phone,
        direction: outbound ? "outbound" : "inbound", content, messageType,
        occurredAt: timestamp(message.timestamp), isHistorical: Boolean(options.historical), mediaPlaceholder: type === "media_placeholder",
        messageStatus: status === "READ" || status === "PLAYED" ? "read" : status === "ERROR" ? "failed" : status === "DELIVERED" || !outbound ? "delivered" : "sent",
        providerMediaId: text(media.id, 300) || undefined, mediaMimeType: text(media.mime_type, 160) || undefined, mediaFileName: text(media.filename, 255) || undefined,
        ...(rawType === "reaction" ? { targetProviderMessageId: text(record(message.reaction).message_id, 300), reaction: text(record(message.reaction).emoji, 32) || null } : {}),
        ...(rawType === "edit" || rawType === "revoke" ? { targetProviderMessageId: text(change.original_message_id, 300), changeAction: rawType } : {}) };
}

/** Coexistence events never infer a tenant from the customer's phone number. */
export function normalizeMetaCoexistenceChange(field: string, value: RecordValue, wabaId: string, hash: string, binding?: { wabaId?: string | null; sourceId: string }): Envelope[] {
    const metadata = record(value.metadata);
    const sourceId = text(metadata.phone_number_id, 160) || (field === "account_update" && binding?.wabaId === wabaId ? binding.sourceId : "");
    if (!sourceId) return [];
    const result: Envelope[] = [];
    const push = (payload: QueuedWebhookPayload, key: string) => result.push({ sourceId, providerEventId: `meta:${sourceId}:${key}`, payload });
    const base = { sourceType: "meta" as const, sourceId, wabaId };
    if (field === "smb_message_echoes") {
        for (const raw of list(value.message_echoes)) {
            const payload = metaSyncedMessage(raw, sourceId, { outbound: true });
            if (payload) push(payload, `echo:${payload.providerMessageId}`);
        }
    } else if (field === "history") {
        const historyItems: QueuedWebhookPayload[] = [];
        let progress = 0; let error: string | undefined;
        for (const raw of list(value.history)) {
            const history = record(raw);
            progress = Math.max(progress, Number(record(history.metadata).progress) || 0);
            for (const issue of list(history.errors)) {
                const e = record(issue); error = Number(e.code) === 2593109 ? "El negocio decidió no compartir su historial." : text(e.message) || text(e.title) || "Meta no pudo sincronizar el historial.";
            }
            for (const rawThread of list(history.threads)) {
                const thread = record(rawThread); const phone = digits(thread.id);
                if (!phone || text(thread.id).includes("@")) continue;
                for (const rawMessage of list(thread.messages)) {
                    const message = record(rawMessage);
                    const outbound = normalizeMetaRecipient(digits(message.from)) !== normalizeMetaRecipient(phone) || Boolean(message.to);
                    const item = metaSyncedMessage(message, sourceId, { historical: true, phone, outbound });
                    if (item) historyItems.push(item);
                }
            }
        }
        // Recent historical media arrives separately, with the same native message ID.
        for (const raw of list(value.messages)) {
            const item = metaSyncedMessage(raw, sourceId, { historical: true });
            if (item) historyItems.push(item);
        }
        for (let i = 0; i < historyItems.length; i += 50) push({ ...base, kind: "history", historyItems: historyItems.slice(i, i + 50) }, `history:${hash}:${i}`);
        push({ ...base, kind: "sync", syncProgress: Math.min(100, progress), syncError: error }, `sync:${hash}`);
    } else if (field === "smb_app_state_sync") {
        const items: NonNullable<QueuedWebhookPayload["contactItems"]> = [];
        for (const raw of list(value.state_sync)) {
            const state = record(raw); if (state.type !== "contact" || !["add", "remove"].includes(text(state.action))) continue;
            const contact = record(state.contact); const phone = digits(contact.phone_number);
            if (phone) items.push({ phone, name: text(contact.full_name, 160) || text(contact.first_name, 160) || undefined,
                action: state.action as "add" | "remove", occurredAt: timestamp(record(state.metadata).timestamp) });
        }
        for (let i = 0; i < items.length; i += 50) push({ ...base, kind: "contacts", contactItems: items.slice(i, i + 50) }, `contacts:${hash}:${i}`);
    } else if (field === "account_update") {
        push({ ...base, kind: "channel", channelEvent: text(value.event, 80), syncError: text(record(value.disconnection_info).reason, 160) || undefined }, `account:${hash}`);
    }
    return result;
}
