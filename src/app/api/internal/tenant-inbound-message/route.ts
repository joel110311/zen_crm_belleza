import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage } from "@/app/actions/chat";
import { getControlDb } from "@/lib/control-db";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { runWithTenantPrisma } from "@/lib/routed-prisma";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function text(value: unknown, maximum = 4_000) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function POST(request: NextRequest) {
    if (!isMultitenantRuntimeEnabled()) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const expectedSecret = process.env.SECURITY_HASH_SALT?.trim() || "";
    const suppliedSecret = request.headers.get("x-tenant-worker-secret")?.trim() || "";
    if (!expectedSecret || !suppliedSecret || !safeEqual(expectedSecret, suppliedSecret)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null) as {
        tenantId?: unknown;
        webhookEventId?: unknown;
    } | null;
    const tenantId = text(body?.tenantId, 160);
    const webhookEventId = text(body?.webhookEventId, 160);
    if (!tenantId || !webhookEventId) {
        return NextResponse.json({ error: "tenantId and webhookEventId are required" }, { status: 400 });
    }

    const event = await getControlDb().webhookEvent.findFirst({
        where: { id: webhookEventId, tenantId },
        select: { payload: true },
    });
    const payload = record(event?.payload);
    if (!event || payload.kind !== "message" || payload.direction === "outbound") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const phone = text(payload.phone, 80).replace(/\D/g, "");
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const sourceId = text(payload.sourceId, 160);
    if (!phone || !sourceId) {
        return NextResponse.json({ error: "Invalid inbound message" }, { status: 400 });
    }

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

    return NextResponse.json({ success: true, duplicate: Boolean(result?.duplicate) });
}
