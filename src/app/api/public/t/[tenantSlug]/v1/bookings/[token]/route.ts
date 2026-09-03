import { getPublicBooking, publicPortalData, withPublicTenantPortalApi } from "@/lib/public-tenant-portal";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string; token: string }> }) {
    const { tenantSlug, token } = await params;
    return withPublicTenantPortalApi(request, tenantSlug, async (context, requestId) =>
        publicPortalData(await getPublicBooking(context, token), requestId));
}
