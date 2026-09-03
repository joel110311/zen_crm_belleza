import { tenantData, withTenantApi } from "@/lib/tenant-api";
import { getOnboardingPayload } from "../../onboarding/route";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "services.write" }, async (tenant) => {
        const payload = await getOnboardingPayload(tenant);
        return tenantData({ state: payload.state, readiness: payload.readiness }, tenant.requestId);
    });
}
