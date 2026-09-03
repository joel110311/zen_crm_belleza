import { NextRequest, NextResponse } from "next/server";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";
import { confirmPasswordReset } from "@/lib/public-auth";
import { consumeSharedRateLimit, getRequestIp, isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isPublicTenantSignupEnabled()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    let body: { token?: unknown; password?: unknown };
    try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 }); }
    const ip = getRequestIp(request.headers);
    const limit = await consumeSharedRateLimit({ limit: 6, windowMs: 15 * 60 * 1000, scope: "reset-confirm-ip", identifiers: [ip] });
    if (!limit.allowed) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." }, { status: 429 });
    try {
        const updated = await confirmPasswordReset(typeof body.token === "string" ? body.token : "", typeof body.password === "string" ? body.password : "");
        return NextResponse.json({ updated });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible restablecer la contraseña." }, { status: 400 });
    }
}
