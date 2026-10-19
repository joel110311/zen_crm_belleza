import { NextRequest, NextResponse } from "next/server";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getActiveBillingProvider } from "@/lib/billing/provider";
import { CouponError, previewBillingCoupon, redeemBillingCoupon } from "@/lib/billing/coupons";
import { consumeSharedRateLimit, isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || typeof body.tenantSlug !== "string" || body.tenantSlug.length > 100 || typeof body.planSlug !== "string" || body.planSlug.length > 100 || !["preview", "redeem"].includes(body.action)) throw new CouponError("Selecciona un plan y un cupón válido.", 400);
        const { tenant, user } = await requireBillingOwner(body.tenantSlug);
        const rate = await consumeSharedRateLimit({ scope: "billing-coupon", identifiers: [user.id, tenant.tenantId], limit: 20, windowMs: 60_000 });
        if (!rate.allowed) return NextResponse.json({ error: "Has hecho varias consultas. Espera un minuto antes de intentar de nuevo." }, { status: 429, headers: { "Retry-After": "60" } });
        if (getActiveBillingProvider() !== "MERCADO_PAGO") throw new CouponError("Los cupones están disponibles para contratación con Mercado Pago.");
        if (body.action === "preview") return NextResponse.json({ quote: await previewBillingCoupon(tenant.tenantId, body.code, body.planSlug) });
        return NextResponse.json(await redeemBillingCoupon({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, user, planSlug: body.planSlug, code: body.code, amountCents: body.amountCents, consent: body.consent }));
    } catch (error) {
        if (error instanceof CouponError || error instanceof BillingAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[billing.coupon] Request failed", { name: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "No fue posible consultar la promoción. Inténtalo nuevamente." }, { status: 503 });
    }
}
