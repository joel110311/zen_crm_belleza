import { NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { connectWuzapiChannel } from "@/lib/tenant-channels";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

/**
 * The WuzAPI token is accepted once, encrypted in the control plane and never returned. The
 * callback includes an opaque credential; show it only once if the gateway is configured manually.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "channels.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        const result = await connectWuzapiChannel({
            tenantId: tenant.tenantId,
            externalAccountId: body.externalAccountId,
            userToken: body.userToken,
        });
        return tenantData(result, tenant.requestId, 201);
    });
}
