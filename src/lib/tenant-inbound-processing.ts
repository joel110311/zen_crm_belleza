import "server-only";
import { processInboundMessage } from "@/app/actions/chat";
import { getControlDb } from "@/lib/control-db";
import { runWithTenantPrisma } from "@/lib/routed-prisma";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";

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
 * Stores one inbound tenant message before Redis is involved. Redis is deliberately used only by
 * processInboundMessage for chatbot batching, never as a prerequisite for inbox persistence.
 */
export async function processTenantInboundWebhookEvent(tenantId: string, webhookEventId: string) {
    const controlDb = getControlDb();
    const event = await controlDb.webhookEvent.findFirst({
        where: { id: webhookEventId, tenantId },
        select: { payload: true },
    });
    const payload = record(event?.payload);
    if (!event || payload.kind !== "message" || payload.direction === "outbound") {
        throw new Error("Inbound tenant webhook event was not found.");
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
    const result = await runWithTenantPrisma(
        tenantDb,
        () => processInboundMessage(
            phone,
            text(payload.content) || "[Mensaje de WhatsApp]",
            text(payload.contactName, 160) || undefined,
            {
                type: text(payload.messageType, 40) || "text",
                mediaType: text(payload.mediaMimeType, 160) || undefined,
                mediaFileName: text(payload.mediaFileName, 255) || undefined,
            },
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
