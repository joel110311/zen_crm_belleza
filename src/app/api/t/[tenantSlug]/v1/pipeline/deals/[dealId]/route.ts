import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { deleteDeal, updateDeal } from "@/lib/tenant-services/pipeline";

type RouteContext = { params: Promise<{ tenantSlug: string; dealId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, dealId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "pipeline.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateDeal(context, dealId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, dealId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "pipeline.write" }, (context) =>
        runTenantMutation(context, request, { dealId }, () => deleteDeal(context, dealId)));
}
