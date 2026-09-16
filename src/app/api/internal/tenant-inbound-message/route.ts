import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { processTenantInboundWebhookEvent } from "@/lib/tenant-inbound-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const result = await processTenantInboundWebhookEvent(tenantId, webhookEventId);

    return NextResponse.json({ success: true, duplicate: Boolean(result?.duplicate) });
}
