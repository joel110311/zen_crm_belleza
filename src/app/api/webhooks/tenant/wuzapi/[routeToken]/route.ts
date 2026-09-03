import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { getChannelForRoute, touchChannelWebhook } from "@/lib/tenant-channels";
import { safeSecretEqual } from "@/lib/security";
import { ingestTenantWebhook } from "@/lib/tenant-work-queue";
import { normalizeWuzapiWebhook, webhookBodyHash } from "@/lib/tenant-webhook-payload";

export const runtime = "nodejs";
const maxWebhookBytes = 1_048_576;

function hasValidWuzapiSignature(rawBody: string, request: Request) {
    const key = process.env.MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY?.trim() || "";
    const received = (request.headers.get("x-hmac-signature") || "").trim().replace(/^sha256=/i, "").toLowerCase();
    if (!key || !/^[a-f0-9]{64}$/.test(received)) return false;
    return safeSecretEqual(received, crypto.createHmac("sha256", key).update(rawBody).digest("hex"));
}

function parseBody(rawBody: string, contentType: string | null) {
    if (contentType?.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(rawBody));
    return JSON.parse(rawBody) as unknown;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ routeToken: string }> }) {
    if (!isMultitenantChannelsEnabled()) return new NextResponse(null, { status: 404 });
    const { routeToken } = await params;
    const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
    if (Number.isFinite(contentLength) && contentLength > maxWebhookBytes) return new NextResponse(null, { status: 413 });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > maxWebhookBytes) return new NextResponse(null, { status: 413 });
    if (!hasValidWuzapiSignature(rawBody, request)) return new NextResponse(null, { status: 401 });

    let payload: unknown;
    try {
        payload = parseBody(rawBody, request.headers.get("content-type"));
    } catch {
        return new NextResponse(null, { status: 400 });
    }
    const connection = await getChannelForRoute("WUZAPI", routeToken);
    const normalized = normalizeWuzapiWebhook(payload, connection?.externalAccountId || "unknown", webhookBodyHash(rawBody));
    await ingestTenantWebhook({
        tenantId: connection?.tenantId || null,
        provider: "WUZAPI",
        providerEventId: normalized.providerEventId,
        payload: normalized.payload,
        ignored: !connection || normalized.payload.kind === "ignored",
    });
    if (connection) await touchChannelWebhook(connection.id);
    return NextResponse.json({ ok: true });
}
