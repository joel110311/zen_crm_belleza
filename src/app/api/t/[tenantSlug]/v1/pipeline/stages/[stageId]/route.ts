import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { deletePipelineStage, updatePipelineStage } from "@/lib/tenant-services/pipeline";

type RouteContext = { params: Promise<{ tenantSlug: string; stageId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, stageId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "pipeline.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updatePipelineStage(context, stageId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, stageId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "pipeline.write" }, (context) =>
        runTenantMutation(context, request, { stageId }, () => deletePipelineStage(context, stageId)));
}
