import "server-only";
import { Prisma, type PrismaClient, type WebhookProvider } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";

export type QueuedWebhookPayload = {
    kind: "message" | "status" | "reaction" | "ignored";
    sourceType: "meta" | "wuzapi";
    sourceId: string;
    providerMessageId?: string;
    targetProviderMessageId?: string;
    phone?: string;
    contactName?: string;
    content?: string;
    messageType?: "text" | "image" | "video" | "audio" | "document";
    messageStatus?: "sent" | "delivered" | "read" | "failed";
    reaction?: string | null;
    direction?: "inbound" | "outbound";
    occurredAt?: string;
    providerMediaId?: string;
    mediaMimeType?: string;
    mediaFileName?: string;
};

export type WebhookIngestResult = {
    duplicate: boolean;
    ignored: boolean;
    eventId: string | null;
};

function isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Persist an external event and its work atomically. A provider retry can therefore never create
 * a second queue item, including when two web replicas receive it at the same time.
 */
export async function ingestTenantWebhook(input: {
    tenantId: string | null;
    provider: WebhookProvider;
    providerEventId: string;
    payload: QueuedWebhookPayload;
    ignored?: boolean;
    enqueue?: boolean;
    controlDb?: PrismaClient;
}): Promise<WebhookIngestResult> {
    const db = input.controlDb || getControlDb();
    const idempotencyKey = `webhook:${input.provider}:${input.providerEventId}`;

    try {
        return await db.$transaction(async (tx) => {
            const event = await tx.webhookEvent.create({
                data: {
                    tenantId: input.tenantId,
                    provider: input.provider,
                    providerEventId: input.providerEventId,
                    payload: input.payload,
                    status: input.ignored || !input.tenantId ? "IGNORED" : "RECEIVED",
                    ...(input.ignored || !input.tenantId ? { processedAt: new Date() } : {}),
                },
                select: { id: true },
            });

            if (!input.ignored && input.tenantId && input.enqueue !== false) {
                await tx.tenantWorkItem.create({
                    data: {
                        tenantId: input.tenantId,
                        kind: "WEBHOOK_EVENT",
                        recordId: event.id,
                        idempotencyKey,
                        payload: { webhookEventId: event.id },
                    },
                });
            }

            return { duplicate: false, ignored: Boolean(input.ignored || !input.tenantId), eventId: event.id };
        });
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return { duplicate: true, ignored: !input.tenantId || Boolean(input.ignored), eventId: null };
    }
}

/**
 * Enqueues a persisted webhook only when synchronous delivery could not finish.
 * Keeping this separate lets the HTTP webhook write the tenant message immediately while the
 * durable worker remains the retry path for transient database or application failures.
 */
export async function enqueueTenantWebhookRetry(input: {
    tenantId: string;
    eventId: string;
    controlDb?: PrismaClient;
}) {
    const db = input.controlDb || getControlDb();
    return db.tenantWorkItem.upsert({
        where: { idempotencyKey: `webhook:retry:${input.eventId}` },
        create: {
            tenantId: input.tenantId,
            kind: "WEBHOOK_EVENT",
            recordId: input.eventId,
            idempotencyKey: `webhook:retry:${input.eventId}`,
            payload: { webhookEventId: input.eventId },
        },
        update: {},
        select: { id: true, status: true },
    });
}

/** Future producers use this instead of an in-memory timer. */
export async function enqueueTenantWork(input: {
    tenantId: string;
    kind: "OUTBOUND_MESSAGE" | "APPOINTMENT_REMINDER" | "CAMPAIGN_DISPATCH" | "AI_TASK" | "MAINTENANCE";
    idempotencyKey: string;
    recordId?: string;
    payload?: Prisma.InputJsonValue;
    availableAt?: Date;
}) {
    return getControlDb().tenantWorkItem.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        create: {
            tenantId: input.tenantId,
            kind: input.kind,
            recordId: input.recordId || null,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload || {},
            availableAt: input.availableAt,
        },
        update: {},
        select: { id: true, status: true },
    });
}
