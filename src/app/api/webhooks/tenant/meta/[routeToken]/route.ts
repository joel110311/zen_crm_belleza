import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { getChannelForRoute, touchChannelWebhook } from "@/lib/tenant-channels";
import { safeSecretEqual } from "@/lib/security";
import { ingestTenantWebhook } from "@/lib/tenant-work-queue";
import { normalizeMetaWebhook, webhookBodyHash } from "@/lib/tenant-webhook-payload";

export const runtime = "nodejs";
const maxWebhookBytes = 1_048_576;

function verifyMetaSignature(rawBody: string, signature: string | null) {
    const secret = process.env.META_APP_SECRET?.trim() || "";
    if (!secret || !signature) return false;
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    return safeSecretEqual(signature, expected);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ routeToken: string }> }) {
    if (!isMultitenantChannelsEnabled()) return new NextResponse(null, { status: 404 });
    const { routeToken } = await params;
    const connection = await getChannelForRoute("META_CLOUD", routeToken);
    const mode = request.nextUrl.searchParams.get("hub.mode");
    const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
    const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
    if (connection && mode === "subscribe" && safeSecretEqual(token, routeToken)) return new NextResponse(challenge, { status: 200 });
    return new NextResponse(null, { status: 403 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ routeToken: string }> }) {
    if (!isMultitenantChannelsEnabled()) return new NextResponse(null, { status: 404 });
    const { routeToken } = await params;
    const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
    if (Number.isFinite(contentLength) && contentLength > maxWebhookBytes) return new NextResponse(null, { status: 413 });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > maxWebhookBytes) return new NextResponse(null, { status: 413 });
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) return new NextResponse(null, { status: 401 });

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    const connection = await getChannelForRoute("META_CLOUD", routeToken);
    const events = normalizeMetaWebhook(payload, webhookBodyHash(rawBody));
    for (const event of events) {
        const belongsToConnection = Boolean(connection && event.sourceId === connection.externalAccountId);
        await ingestTenantWebhook({
            tenantId: belongsToConnection ? connection?.tenantId || null : null,
            provider: "META",
            providerEventId: event.providerEventId,
            payload: event.payload,
            ignored: !belongsToConnection || event.payload.kind === "ignored",
        });
    }
    if (connection) await touchChannelWebhook(connection.id);
    return NextResponse.json({ ok: true });
}
