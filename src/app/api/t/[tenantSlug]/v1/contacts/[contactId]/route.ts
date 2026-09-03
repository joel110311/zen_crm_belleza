import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { deleteContact, getContact, updateContact } from "@/lib/tenant-services/contacts";

type RouteContext = { params: Promise<{ tenantSlug: string; contactId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug, contactId } = await params;
    return withTenantApi(request, tenantSlug, { permission: "contacts.read" }, async (context) =>
        tenantData(await getContact(context, contactId), context.requestId));
}

export async function PATCH(request: Request, { params }: RouteContext) {
    const { tenantSlug, contactId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "contacts.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => updateContact(context, contactId, payload));
    });
}

export async function DELETE(request: Request, { params }: RouteContext) {
    const { tenantSlug, contactId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "contacts.write" }, (context) =>
        runTenantMutation(context, request, { contactId }, () => deleteContact(context, contactId)));
}
