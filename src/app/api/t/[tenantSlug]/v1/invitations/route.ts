import { NextResponse } from "next/server";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createTenantInvitation, listTenantTeam } from "@/lib/tenant-invitations";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";

export const runtime = "nodejs";

function disabled() {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró el recurso solicitado." } }, { status: 404 });
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    if (!isMultitenantInvitationsEnabled()) return disabled();
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "team.read" }, async (context) =>
        tenantData(await listTenantTeam(context), context.requestId));
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    if (!isMultitenantInvitationsEnabled()) return disabled();
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "team.write" }, async (context) => {
        const input = await readTenantJson(request) as { email?: unknown; role?: unknown; professionalProfile?: unknown };
        const result = await createTenantInvitation(context, input, request.headers.get("idempotency-key"));
        return tenantData(result, context.requestId, 201);
    });
}
