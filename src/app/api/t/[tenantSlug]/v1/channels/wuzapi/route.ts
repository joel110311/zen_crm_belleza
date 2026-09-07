import { NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { beginTenantQrConnection, disconnectTenantQrConnection, getTenantQrConnection } from "@/lib/tenant-channels";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { permission: "channels.read" }, async (tenant) => {
        const includeQr = new URL(request.url).searchParams.get("includeQr") === "1";
        return tenantData(await getTenantQrConnection(tenant.tenantId, includeQr), tenant.requestId);
    });
}

/** Starts and manages the platform-provisioned QR ceremony; no technical credential reaches the browser. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "channels.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        const action = typeof body.action === "string" ? body.action : "connect";
        if (action === "connect" && body.riskAccepted !== true) {
            return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Debes aceptar el aviso de conexión no oficial antes de continuar." } }, { status: 400 });
        }
        const result = action === "connect"
            ? await beginTenantQrConnection(tenant.tenantId, tenant.actor.controlUserId)
            : action === "disconnect"
                ? await disconnectTenantQrConnection(tenant.tenantId)
                : null;
        if (!result) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Acción no permitida." } }, { status: 400 });
        return tenantData(result, tenant.requestId, 201);
    });
}
