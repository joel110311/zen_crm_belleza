import { NextRequest, NextResponse } from "next/server";
import { verifySignupCaptcha } from "@/lib/captcha";
import { createSignupIntent, PUBLIC_AUTH_RESPONSE } from "@/lib/public-auth";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";
import { consumeSharedRateLimit, getRequestIp, isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

const RATE_LIMIT = { limit: 4, windowMs: 15 * 60 * 1000 };

async function canAttemptSignup(ip: string, email: string, fingerprint: string) {
    const results = await Promise.all([
        consumeSharedRateLimit({ ...RATE_LIMIT, scope: "signup-ip", identifiers: [ip] }),
        consumeSharedRateLimit({ ...RATE_LIMIT, scope: "signup-email", identifiers: [email] }),
        consumeSharedRateLimit({ ...RATE_LIMIT, scope: "signup-fingerprint", identifiers: [fingerprint || `missing:${ip}`] }),
    ]);
    return results.find((result) => !result.allowed) || null;
}

export async function POST(request: NextRequest) {
    if (!isPublicTenantSignupEnabled()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });

    let body: Record<string, unknown>;
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
    }
    if (body.legalAccepted !== true) {
        return NextResponse.json({ error: "Debes aceptar los términos y el aviso de privacidad para continuar." }, { status: 400 });
    }

    const ip = getRequestIp(request.headers);
    const email = String(body.email || "").trim().toLowerCase();
    const fingerprint = String(body.fingerprint || request.headers.get("x-signup-fingerprint") || "").trim().slice(0, 500);
    const limit = await canAttemptSignup(ip, email, fingerprint);
    if (limit) {
        return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." }, {
            status: 429,
            headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) },
        });
    }
    if (!await verifySignupCaptcha(body.captchaToken, ip, "signup")) {
        return NextResponse.json({ error: "No fue posible verificar que eres una persona. Inténtalo de nuevo." }, { status: 400 });
    }

    try {
        await createSignupIntent({
            name: String(body.name || ""),
            email,
            password: String(body.password || ""),
            displayName: String(body.displayName || ""),
            slug: String(body.slug || ""),
            timeZone: String(body.timeZone || "America/Mexico_City"),
            idempotencyKey: String(body.idempotencyKey || ""),
            fingerprint,
            utm: body.utm && typeof body.utm === "object" && !Array.isArray(body.utm) ? body.utm as Record<string, string> : undefined,
            ip,
        });
        return NextResponse.json({ message: PUBLIC_AUTH_RESPONSE }, { status: 202 });
    } catch (error) {
        const message = error instanceof Error ? error.message : "No fue posible iniciar el registro.";
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
