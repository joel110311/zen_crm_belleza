import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createAvailabilityBlock, listAvailabilityBlocks } from "@/lib/tenant-services/specialists";

type RouteContext = { params: Promise<{ tenantSlug: string; specialistId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, specialistId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "calendar.read" }, async (context) =>
        tenantData(await listAvailabilityBlocks(context, specialistId), context.requestId));
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug, specialistId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createAvailabilityBlock(context, specialistId, payload), 201);
    });
}
