import { asRecord } from "@/lib/tenant-services/validation";
import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { completeTenantOnboarding, serializeOnboardingState } from "../../../onboarding/route";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        return runTenantMutation(tenant, request, body, async () => ({
            state: serializeOnboardingState(await completeTenantOnboarding(tenant, body.publish === true)),
        }));
    });
}
