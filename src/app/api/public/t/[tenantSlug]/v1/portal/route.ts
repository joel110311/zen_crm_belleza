import { getPublicPortalData, publicPortalData, withPublicTenantPortalApi } from "@/lib/public-tenant-portal";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withPublicTenantPortalApi(request, tenantSlug, async (context, requestId) =>
        publicPortalData(await getPublicPortalData(context), requestId));
}
