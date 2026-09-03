import { NextResponse } from "next/server";
import { tenantData, withTenantApi } from "@/lib/tenant-api";
import { revokeTenantInvitation } from "@/lib/tenant-invitations";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ tenantSlug: string; invitationId: string }> }) {
    if (!isMultitenantInvitationsEnabled()) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró el recurso solicitado." } }, { status: 404 });
    }
    const { tenantSlug, invitationId } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "team.write" }, async (context) =>
        tenantData(await revokeTenantInvitation(context, invitationId), context.requestId));
}
