import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createService, listServiceCatalog } from "@/lib/tenant-services/services";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "services.read" }, async (context) =>
        tenantData(await listServiceCatalog(context), context.requestId));
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createService(context, payload), 201);
    });
}
