import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createSpecialist, listSpecialists } from "@/lib/tenant-services/specialists";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    return withTenantApi(request, tenantSlug, { permission: "specialists.read" }, async (context) =>
        tenantData(await listSpecialists(context, includeInactive), context.requestId));
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "specialists.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createSpecialist(context, payload), 201);
    });
}
