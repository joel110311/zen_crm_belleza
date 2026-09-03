import { NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { tenantData, withTenantApi } from "@/lib/tenant-api";
import { listTenantChannels } from "@/lib/tenant-channels";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { permission: "channels.read" }, async (tenant) => {
        return tenantData({ channels: await listTenantChannels(tenant.tenantId) }, tenant.requestId);
    });
}
