import { readTenantJson, runTenantMutation, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createContact, listContacts } from "@/lib/tenant-services/contacts";

type RouteContext = { params: Promise<{ tenantSlug: string }> };

export async function GET(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    const search = new URL(request.url).searchParams;
    return withTenantApi(request, tenantSlug, { permission: "contacts.read" }, async (context) =>
        tenantData(await listContacts(context, search.get("q") || undefined, search.get("page") || undefined, search.get("pageSize") || undefined), context.requestId));
}

export async function POST(request: Request, { params }: RouteContext) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "contacts.write" }, async (context) => {
        const payload = await readTenantJson(request);
        return runTenantMutation(context, request, payload, () => createContact(context, payload), 201);
    });
}
