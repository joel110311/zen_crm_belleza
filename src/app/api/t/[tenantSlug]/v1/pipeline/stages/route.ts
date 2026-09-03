import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { createPipelineStage } from "@/lib/tenant-services/pipeline";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "pipeline.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createPipelineStage(context, payload), 201);
    });
}
