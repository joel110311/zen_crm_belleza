import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createAppointment, getCalendarSnapshot } from "@/lib/tenant-services/appointments";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    const search = new URL(request.url).searchParams;
    return withTenantApi(request, tenantSlug, { permission: "calendar.read" }, async (context) =>
        tenantData(await getCalendarSnapshot(context, search.get("from") || undefined, search.get("to") || undefined), context.requestId));
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createAppointment(context, payload), 201);
    });
}
