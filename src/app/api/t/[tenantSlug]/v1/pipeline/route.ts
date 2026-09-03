import { tenantData, withTenantApi } from "@/lib/tenant-api";
import { getPipelineSnapshot } from "@/lib/tenant-services/pipeline";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "pipeline.read" }, async (context) =>
        tenantData(await getPipelineSnapshot(context), context.requestId));
}
