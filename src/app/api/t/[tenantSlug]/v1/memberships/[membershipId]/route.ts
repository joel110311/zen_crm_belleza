import { NextResponse } from "next/server";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { setTenantMembershipActive, TenantInvitationError } from "@/lib/tenant-invitations";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; membershipId: string }> }) {
    if (!isMultitenantInvitationsEnabled()) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró el recurso solicitado." } }, { status: 404 });
    }
    const { tenantSlug, membershipId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "team.write" }, async (context) => {
        const input = await readTenantJson(request) as { isActive?: unknown };
        if (typeof input.isActive !== "boolean") throw new TenantInvitationError("Indica si la membresía estará activa.");
        return tenantData(await setTenantMembershipActive(context, membershipId, input.isActive), context.requestId);
    });
}
