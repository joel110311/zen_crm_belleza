import { createPublicBooking, enforcePublicPortalRateLimit, publicPortalData, withPublicTenantPortalApi } from "@/lib/public-tenant-portal";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withPublicTenantPortalApi(request, tenantSlug, async (context, requestId) => {
        await enforcePublicPortalRateLimit(request, "public-portal-booking", 8, 10 * 60 * 1000);
        const input = await request.json() as Record<string, unknown>;
        return publicPortalData(await createPublicBooking(context, request, input), requestId, 201);
    });
}
