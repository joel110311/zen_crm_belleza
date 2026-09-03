import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createServiceCategory, listServiceCatalog } from "@/lib/tenant-services/services";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "services.read" }, async (context) => {
        const catalog = await listServiceCatalog(context);
        return tenantData(catalog.categories, context.requestId);
    });
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createServiceCategory(context, payload), 201);
    });
}
