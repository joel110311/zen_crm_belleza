import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { deleteService, getService, updateService } from "@/lib/tenant-services/services";

type RouteContext = { params: Promise<{ tenantSlug: string; serviceId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, serviceId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "services.read" }, async (context) =>
        tenantData(await getService(context, serviceId), context.requestId));
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, serviceId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateService(context, serviceId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, serviceId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "services.write" }, (context) =>
        runTenantMutation(context, request, { serviceId }, () => deleteService(context, serviceId)));
}
