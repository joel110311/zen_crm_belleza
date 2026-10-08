import type { PrismaClient } from "@prisma/client";
import { buildPhoneMatchClauses, normalizeMetaRecipient } from "./phone.ts";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";

type Database = Pick<PrismaClient, "message" | "contact" | "conversation" | "$transaction">;
type Media = { type?: string; mediaUrl?: string | null; mediaType?: string | null; mediaFileName?: string | null };
type ResolveMedia = (payload: QueuedWebhookPayload) => Promise<Media>;
function date(value?: string) { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? parsed : null; }

async function contactForPhone(db: Database, rawPhone: string, name?: string) {
    const phone = normalizeMetaRecipient(rawPhone);
    if (!phone) throw new Error("El evento de coexistencia no tiene destinatario válido.");
    const existing = await db.contact.findFirst({ where: { sourceType: "meta", OR: buildPhoneMatchClauses([phone]) } });
    return existing || db.contact.upsert({ where: { phone_sourceType: { phone, sourceType: "meta" } }, update: {}, create: { phone, sourceType: "meta", name, status: "lead" } });
}

/** Import/echo only: never calls the AI, opens a service window or sends to WhatsApp. */
export async function storeMetaSyncedMessage(db: Database, payload: QueuedWebhookPayload, resolveMedia: ResolveMedia) {
    if (!payload.phone || !payload.providerMessageId || payload.sourceType !== "meta" || !payload.sourceId) throw new Error("Evento de coexistencia inválido.");
    const where = { sourceType: "meta", sourceId: payload.sourceId, providerMessageId: payload.providerMessageId };
    const known = await db.message.findFirst({ where });
    if (known?.providerRevokedAt) return { duplicate: true, messageId: known.id, conversationId: known.conversationId };
    const contact = await contactForPhone(db, payload.phone, payload.contactName);
    let conversation = known ? await db.conversation.findUnique({ where: { id: known.conversationId } }) : await db.conversation.findFirst({ where: { contactId: contact.id, sourceType: "meta", sourceId: payload.sourceId, status: "active" } });
    if (!conversation) {
        try { conversation = await db.conversation.create({ data: { contactId: contact.id, sourceType: "meta", sourceId: payload.sourceId, status: "active", botActive: false,
            ...(payload.isHistorical && date(payload.occurredAt) ? { updatedAt: date(payload.occurredAt)! } : {}) } }); }
        catch (error) {
            conversation = await db.conversation.findFirst({ where: { contactId: contact.id, sourceType: "meta", sourceId: payload.sourceId, status: "active" } });
            if (!conversation) throw error;
        }
    }
    // Pause before downloading attachments so the bot cannot race a phone reply.
    if (!payload.isHistorical && payload.direction === "outbound" && known?.senderType !== "bot" && known?.senderType !== "system") {
        await db.conversation.update({ where: { id: conversation.id }, data: { botActive: false, updatedAt: new Date() } });
    }
    const media = known?.mediaUrl ? { type: known.type, mediaUrl: known.mediaUrl, mediaType: known.mediaType, mediaFileName: known.mediaFileName }
        : payload.mediaPlaceholder || (payload.isHistorical && !payload.providerMediaId) ? { type: payload.messageType || "text" } : await resolveMedia(payload);
    const conversationId = conversation.id;
    return db.$transaction(async tx => {
        // Serialize history chunks and media supplements for the same native message.
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text", `meta:${payload.sourceId}:${payload.providerMessageId}`);
        const existing = await tx.message.findFirst({ where });
        if (existing) {
            if (!existing.providerRevokedAt && !existing.mediaUrl && media.mediaUrl) await tx.message.updateMany({ where: { id: existing.id, providerRevokedAt: null }, data: { type: media.type || payload.messageType, mediaUrl: media.mediaUrl, mediaType: media.mediaType, mediaFileName: media.mediaFileName, ...(!existing.providerChangedAt ? { content: payload.content || existing.content } : {}) } });
            return { duplicate: true, messageId: existing.id, conversationId: existing.conversationId };
        }
        const occurredAt = date(payload.occurredAt) || new Date();
        const message = await tx.message.create({ data: { conversationId, content: payload.content || "[Mensaje de WhatsApp]", type: media.type || payload.messageType || "text",
            direction: payload.direction || "inbound", status: payload.messageStatus || "sent", senderType: payload.direction === "outbound" ? "human" : null,
            sourceType: "meta", sourceId: payload.sourceId, providerMessageId: payload.providerMessageId,
            mediaUrl: media.mediaUrl, mediaType: media.mediaType, mediaFileName: media.mediaFileName, createdAt: occurredAt,
            ...(payload.isHistorical ? { botProcessedAt: new Date() } : {}) } });
        await tx.conversation.updateMany({ where: { id: conversationId, updatedAt: { lt: occurredAt } }, data: { updatedAt: occurredAt } });
        return { duplicate: false, messageId: message.id, conversationId };
    });
}

export async function applyMetaContactSync(db: Database, payload: QueuedWebhookPayload) {
    for (const item of payload.contactItems || []) {
        if (item.action === "remove" && !await db.contact.findFirst({ where: { sourceType: "meta", OR: buildPhoneMatchClauses([normalizeMetaRecipient(item.phone)]) } })) continue;
        const contact = await contactForPhone(db, item.phone, item.name);
        const occurredAt = date(item.occurredAt) || new Date();
        await db.contact.updateMany({ where: { id: contact.id, sourceType: "meta", OR: [{ providerContactUpdatedAt: null }, { providerContactUpdatedAt: { lt: occurredAt } }] }, data: {
            providerContactUpdatedAt: occurredAt, providerContactRemovedAt: item.action === "remove" ? occurredAt : null,
            ...(item.action === "add" && item.name ? { name: item.name } : {}),
        } });
    }
    // Removing a phone-book entry never deletes CRM history, appointments or payments.
    return { duplicate: false };
}

export async function applyMetaSyncedReaction(db: Database, payload: QueuedWebhookPayload) {
    const message = await db.message.findFirst({ where: { sourceType: "meta", sourceId: payload.sourceId, providerMessageId: payload.targetProviderMessageId || "missing" } });
    if (!message) throw new Error("La reacción llegó antes del mensaje; se reintentará.");
    await db.message.update({ where: { id: message.id }, data: { reaction: payload.reaction || null } });
    return { duplicate: false };
}

export async function applyMetaMessageChange(db: Database, payload: QueuedWebhookPayload, resolveMedia: ResolveMedia) {
    const message = await db.message.findFirst({ where: { sourceType: "meta", sourceId: payload.sourceId, providerMessageId: payload.targetProviderMessageId || "missing" } });
    if (!message) throw new Error("La edición o eliminación llegó antes del mensaje; se reintentará.");
    if (message.providerRevokedAt) return { duplicate: true };
    const occurredAt = date(payload.occurredAt) || new Date();
    if (payload.changeAction === "revoke") {
        await db.message.update({ where: { id: message.id }, data: { content: "[Mensaje eliminado en WhatsApp]", type: "text", mediaUrl: null, mediaType: null, mediaFileName: null, providerRevokedAt: occurredAt, providerChangedAt: occurredAt } });
    } else {
        if (message.providerChangedAt && message.providerChangedAt >= occurredAt) return { duplicate: true };
        const media = await resolveMedia(payload);
        await db.message.updateMany({ where: { id: message.id, providerRevokedAt: null, OR: [{ providerChangedAt: null }, { providerChangedAt: { lt: occurredAt } }] }, data: { providerChangedAt: occurredAt, content: payload.content || message.content, type: media.type || payload.messageType || message.type,
            ...(media.mediaUrl ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType, mediaFileName: media.mediaFileName } : {}) } });
    }
    if (payload.direction === "outbound" && !payload.isHistorical) await db.conversation.update({ where: { id: message.conversationId }, data: { botActive: false } });
    return { duplicate: false };
}
