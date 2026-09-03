import { NextResponse } from "next/server";
import { acceptTenantInvitation, TenantInvitationError } from "@/lib/tenant-invitations";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";
import { consumeSharedRateLimit, getRequestIp } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
    if (!isMultitenantInvitationsEnabled()) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró el recurso solicitado." } }, { status: 404 });
    }
    const rateLimit = await consumeSharedRateLimit({
        scope: "tenant-invitation-accept",
        identifiers: [getRequestIp(request.headers)],
        limit: 20,
        windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Intenta de nuevo en unos minutos." } }, { status: 429 });
    }
    try {
        const input = await request.json() as { token?: unknown; name?: unknown; password?: unknown };
        const accepted = await acceptTenantInvitation(input);
        return NextResponse.json({
            data: {
                tenantSlug: accepted.slug,
                displayName: accepted.displayName,
                signInPath: `/login?redirectTo=${encodeURIComponent(`/t/${accepted.slug}`)}`,
                alreadyAccepted: accepted.alreadyAccepted,
            },
        });
    } catch (error) {
        if (error instanceof TenantInvitationError) {
            const message = error.code === "NOT_FOUND" ? "La invitación no es válida, ya se usó o venció." : error.message;
            return NextResponse.json({ error: { code: error.code, message } }, { status: error.code === "NOT_FOUND" ? 404 : 400 });
        }
        return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "No fue posible aceptar la invitación." } }, { status: 500 });
    }
}
