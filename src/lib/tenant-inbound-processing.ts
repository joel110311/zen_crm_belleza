import "server-only";
import { processInboundMessage } from "@/app/actions/chat";
import { getControlDb } from "@/lib/control-db";
import { runWithTenantPrisma } from "@/lib/routed-prisma";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";
import { storeWuzapiOutboundEcho } from "@/lib/wuzapi-outbound-echo-runtime";
import { resolveTenantInboundMedia } from "@/lib/tenant-inbound-media";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";
import { storeMetaSyncedMessage, applyMetaContactSync, applyMetaMessageChange, applyMetaSyncedReaction } from "@/lib/meta-coexistence-processing";
import { patchMetaConnectionSync } from "@/lib/tenant-channels";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function text(value: unknown, maximum = 4_000) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

/**
 * Stores either direction of a tenant message before Redis is involved. Redis is used only by
 * processInboundMessage for chatbot batching, never as a prerequisite for inbox persistence.
 */
export async function processTenantInboundWebhookEvent(tenantId: string, webhookEventId: string) {
    const controlDb = getControlDb();
    const event = await controlDb.webhookEvent.findFirst({
        where: { id: webhookEventId, tenantId },
        select: { payload: true },
    });
    const payload = record(event?.payload);
    if (!event || !["message", "history", "contacts", "sync", "channel", "message_change"].includes(text(payload.kind))) {
        throw new Error("Inbound tenant webhook event was not found.");
    }

    if (payload.sourceType === "meta" && (payload.kind !== "message" || payload.direction === "outbound")) {
        const sourceId = text(payload.sourceId, 160);
        const connection = await controlDb.channelConnection.findFirst({ where: { tenantId, provider: "META_CLOUD", externalAccountId: sourceId } });
        if (!connection) throw new Error("El evento no pertenece al canal oficial de este negocio.");
        const typed = payload as QueuedWebhookPayload;
        await controlDb.webhookEvent.update({ where: { id: webhookEventId }, data: { status: "PROCESSING", processingError: null } });
        const tenantDb = await getTenantPrismaManager().getForTenant(tenantId);
        const result = await runWithTenantPrisma(tenantDb, async () => {
            const resolveMedia = (item: QueuedWebhookPayload) => resolveTenantInboundMedia(tenantId, `${webhookEventId}:${item.providerMessageId || "change"}`, item);
            if (typed.kind === "contacts") return applyMetaContactSync(tenantDb, typed);
            if (typed.kind === "message_change") return applyMetaMessageChange(tenantDb, typed, resolveMedia);
            if (typed.kind === "history") {
                for (const item of typed.historyItems || []) {
                    if (item.sourceType !== "meta" || item.sourceId !== sourceId) throw new Error("El historial contiene un mensaje de otro canal.");
                    if (item.kind === "message_change") await applyMetaMessageChange(tenantDb, item, resolveMedia);
                    else if (item.kind === "message") await storeMetaSyncedMessage(tenantDb, item, resolveMedia);
                    else if (item.kind === "reaction") await applyMetaSyncedReaction(tenantDb, item);
                }
            } else if (typed.kind === "message") return storeMetaSyncedMessage(tenantDb, typed, resolveMedia);
            else if (typed.kind === "sync") {
                if (typed.syncProgress !== undefined) await controlDb.$executeRawUnsafe(`UPDATE "ChannelConnection" SET "coexistenceSync" = COALESCE("coexistenceSync", '{}'::jsonb) || jsonb_build_object('historyProgress', GREATEST(COALESCE(("coexistenceSync"->>'historyProgress')::int, 0), $2::int)), "updatedAt" = NOW() WHERE "id" = $1`, connection.id, typed.syncProgress);
                if (typed.syncError) await patchMetaConnectionSync(connection.id, { error: typed.syncError });
            } else if (typed.kind === "channel" && ["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"].includes(typed.channelEvent || "")) {
                await controlDb.channelConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", disconnectedAt: new Date(), lastError: typed.syncError || "El negocio desconectó la API desde WhatsApp Business." } });
            }
            return { duplicate: false };
        }, tenantId);
        await controlDb.webhookEvent.update({ where: { id: webhookEventId }, data: { status: "PROCESSED", processedAt: new Date(), processingError: null } });
        return result;
    }

    const phone = text(payload.phone, 80).replace(/\D/g, "");
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const sourceId = text(payload.sourceId, 160);
    if (!phone || !sourceId) throw new Error("Inbound tenant webhook payload is invalid.");

    await controlDb.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "PROCESSING", processingError: null },
    });

    const tenantDb = await getTenantPrismaManager().getForTenant(tenantId);
    const existing = payload.providerMessageId ? await tenantDb.message.findFirst({
        where: { providerMessageId: text(payload.providerMessageId, 300), sourceType, ...(sourceType === "meta" ? { sourceId } : {}) },
        select: { type: true, mediaUrl: true, mediaType: true, mediaFileName: true },
    }) : null;
    // Replays/echoes of an already stored attachment do not download another copy.
    const media = existing?.mediaUrl ? {
        type: existing.type, mediaUrl: existing.mediaUrl,
        mediaType: existing.mediaType || undefined, mediaFileName: existing.mediaFileName || undefined,
    } : await resolveTenantInboundMedia(tenantId, webhookEventId, payload as QueuedWebhookPayload);
    const result = await runWithTenantPrisma(
        tenantDb,
        () => payload.direction === "outbound"
            ? storeWuzapiOutboundEcho({
                phoneCandidates: [phone], content: text(payload.content) || "[Mensaje de WhatsApp]",
                sourceId, providerMessageId: text(payload.providerMessageId, 300) || undefined,
                contactName: text(payload.contactName, 160) || undefined,
                occurredAt: text(payload.occurredAt, 80) ? new Date(text(payload.occurredAt, 80)) : undefined,
                media,
            })
            : processInboundMessage(
            phone,
            text(payload.content) || "[Mensaje de WhatsApp]",
            text(payload.contactName, 160) || undefined,
            media,
            text(payload.providerMessageId, 300) || undefined,
            undefined,
            {
                sourceType,
                sourceId,
                occurredAt: text(payload.occurredAt, 80)
                    ? new Date(text(payload.occurredAt, 80))
                    : undefined,
                tenantId,
            },
        ),
        tenantId,
    );

    await controlDb.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "PROCESSED", processedAt: new Date(), processingError: null },
    });
    return result;
}
