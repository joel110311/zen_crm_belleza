import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { deleteSpecialist, getSpecialist, updateSpecialist } from "@/lib/tenant-services/specialists";

type RouteContext = { params: Promise<{ tenantSlug: string; specialistId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, specialistId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "specialists.read" }, async (context) =>
        tenantData(await getSpecialist(context, specialistId), context.requestId));
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, specialistId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "specialists.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateSpecialist(context, specialistId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, specialistId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "specialists.write" }, (context) =>
        runTenantMutation(context, request, { specialistId }, () => deleteSpecialist(context, specialistId)));
}
