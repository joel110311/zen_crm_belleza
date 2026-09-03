import { NextResponse } from "next/server";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { readTenantJson, runTenantMutation, withTenantApi } from "@/lib/tenant-api";
import { beginMetaEmbeddedSignup } from "@/lib/tenant-channels";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

/** Starts Meta Embedded Signup. State is single-use and is bound to the current control-plane user. */
export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantChannelsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "channels.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        return runTenantMutation(tenant, request, { action: "begin-meta-embedded-signup", ...body }, async () => {
            return beginMetaEmbeddedSignup({ tenantId: tenant.tenantId, userId: tenant.actor.controlUserId || "" });
        });
    });
}
