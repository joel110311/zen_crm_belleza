import { NextRequest, NextResponse } from "next/server";
import { verifySignupCaptcha } from "@/lib/captcha";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";
import { PUBLIC_AUTH_RESPONSE, requestPasswordReset } from "@/lib/public-auth";
import { consumeSharedRateLimit, getRequestIp, isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isPublicTenantSignupEnabled()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    let body: { email?: unknown; captchaToken?: unknown; fingerprint?: unknown };
    try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 }); }
    const ip = getRequestIp(request.headers);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.slice(0, 500) : "";
    const limits = await Promise.all([
        consumeSharedRateLimit({ limit: 4, windowMs: 15 * 60 * 1000, scope: "reset-ip", identifiers: [ip] }),
        consumeSharedRateLimit({ limit: 4, windowMs: 15 * 60 * 1000, scope: "reset-email", identifiers: [email] }),
        consumeSharedRateLimit({ limit: 4, windowMs: 15 * 60 * 1000, scope: "reset-fingerprint", identifiers: [fingerprint || `missing:${ip}`] }),
    ]);
    if (limits.some((limit) => !limit.allowed)) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." }, { status: 429 });
    if (!await verifySignupCaptcha(body.captchaToken, ip, "password_reset")) return NextResponse.json({ error: "No fue posible verificar que eres una persona. Inténtalo de nuevo." }, { status: 400 });
    try {
        await requestPasswordReset(email, ip);
    } catch {
        // Never reveal account or provider state from an unauthenticated recovery request.
    }
    return NextResponse.json({ message: PUBLIC_AUTH_RESPONSE }, { status: 202 });
}
