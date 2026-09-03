import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { cancelAppointment, getAppointment, updateAppointment } from "@/lib/tenant-services/appointments";

type RouteContext = { params: Promise<{ tenantSlug: string; appointmentId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, appointmentId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "calendar.read" }, async (context) =>
        tenantData(await getAppointment(context, appointmentId), context.requestId));
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, appointmentId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateAppointment(context, appointmentId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, appointmentId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "calendar.write" }, (context) =>
        runTenantMutation(context, request, { appointmentId }, () => cancelAppointment(context, appointmentId)));
}
