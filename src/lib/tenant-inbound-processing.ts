import "server-only";
import { processInboundMessage } from "@/app/actions/chat";
import { getControlDb } from "@/lib/control-db";
import { runWithTenantPrisma } from "@/lib/routed-prisma";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";
import { storeWuzapiOutboundEcho } from "@/lib/wuzapi-outbound-echo-runtime";
import { resolveTenantInboundMedia } from "@/lib/tenant-inbound-media";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";

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
    if (!event || payload.kind !== "message") {
        throw new Error("Inbound tenant webhook event was not found.");
    }

    const phone = text(payload.phone, 80).replace(/\D/g, "");
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const sourceId = text(payload.sourceId, 160);
    if (!phone || !sourceId) throw new Error("Inbound tenant webhook payload is invalid.");
    if (payload.direction === "outbound" && sourceType !== "wuzapi") {
        throw new Error("Only linked-device WuzAPI outbound echoes are supported.");
    }

    await controlDb.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "PROCESSING", processingError: null },
    });

    const tenantDb = await getTenantPrismaManager().getForTenant(tenantId);
    const existing = payload.providerMessageId ? await tenantDb.message.findFirst({
        where: { providerMessageId: text(payload.providerMessageId, 300), sourceType },
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
