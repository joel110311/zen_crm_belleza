import { cancelPublicBooking, enforcePublicPortalRateLimit, publicPortalData, withPublicTenantPortalApi } from "@/lib/public-tenant-portal";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; token: string }> }) {
    const { tenantSlug, token } = await params;
    return withPublicTenantPortalApi(request, tenantSlug, async (context, requestId) => {
        await enforcePublicPortalRateLimit(request, "public-portal-booking-cancel", 12, 15 * 60 * 1000);
        return publicPortalData(await cancelPublicBooking(context, token), requestId);
    });
}
