import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { withTenantApi } from "@/lib/tenant-api";

const gone = () => NextResponse.json({ error: { code: "GONE", message: "Pipeline fue retirado de este CRM." } }, { status: 410 });

export async function retiredLegacyPipeline() {
    const denied = ensurePermissionResponse(await auth(), "contacts.manage");
    return denied || gone();
}
export async function retiredTenantPipeline(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "contacts.read" }, async () => gone());
}
