import { enforcePublicPortalRateLimit, getPublicAvailability, publicPortalData, withPublicTenantPortalApi } from "@/lib/public-tenant-portal";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withPublicTenantPortalApi(request, tenantSlug, async (context, requestId) => {
        await enforcePublicPortalRateLimit(request, "public-portal-availability", 120, 60 * 1000);
        return publicPortalData(await getPublicAvailability(context, new URL(request.url).searchParams), requestId);
    });
}
