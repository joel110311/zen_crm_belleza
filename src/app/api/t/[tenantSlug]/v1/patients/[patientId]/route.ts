import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { deletePatient, getPatient, updatePatient } from "@/lib/tenant-services/patients";

type RouteContext = { params: Promise<{ tenantSlug: string; patientId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, patientId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "patients.read" }, async (context) =>
        tenantData(await getPatient(context, patientId), context.requestId));
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, patientId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "patients.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updatePatient(context, patientId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, patientId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "patients.write" }, (context) =>
        runTenantMutation(context, request, { patientId }, () => deletePatient(context, patientId)));
}
