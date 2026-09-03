import { NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { completeMetaEmbeddedSignup } from "@/lib/tenant-channels";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "channels.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        return runTenantMutation(tenant, request, {
            action: "complete-meta-embedded-signup",
            state: typeof body.state === "string" ? body.state : "",
            phoneNumberId: typeof body.phoneNumberId === "string" ? body.phoneNumberId : "",
            wabaId: typeof body.wabaId === "string" ? body.wabaId : "",
        }, async () => completeMetaEmbeddedSignup({
            tenantId: tenant.tenantId,
            userId: tenant.actor.controlUserId || "",
            state: typeof body.state === "string" ? body.state : "",
            code: body.code,
            wabaId: body.wabaId,
            phoneNumberId: body.phoneNumberId,
            businessId: body.businessId,
            registrationPin: body.registrationPin,
        }));
    });
}
