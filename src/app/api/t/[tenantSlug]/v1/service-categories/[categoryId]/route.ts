import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { deleteServiceCategory, updateServiceCategory } from "@/lib/tenant-services/services";

type RouteContext = { params: Promise<{ tenantSlug: string; categoryId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, categoryId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateServiceCategory(context, categoryId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, categoryId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, (context) =>
        runTenantMutation(context, request, { categoryId }, () => deleteServiceCategory(context, categoryId)));
}
