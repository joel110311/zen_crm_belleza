import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { deleteAvailabilityBlock, updateAvailabilityBlock } from "@/lib/tenant-services/specialists";

type RouteContext = { params: Promise<{ tenantSlug: string; blockId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, blockId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateAvailabilityBlock(context, blockId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, blockId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, (context) =>
        runTenantMutation(context, request, { blockId }, () => deleteAvailabilityBlock(context, blockId)));
}
