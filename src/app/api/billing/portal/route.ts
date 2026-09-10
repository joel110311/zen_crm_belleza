import { NextRequest, NextResponse } from "next/server";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getPlatformBaseUrl, getStripeClient, StripeBillingConfigurationError } from "@/lib/billing/stripe";
import { getControlDb } from "@/lib/control-db";
import { isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) {
        return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
    }
    const tenantSlug = typeof body.tenantSlug === "string" ? body.tenantSlug : "";
    if (!tenantSlug) {
        return NextResponse.json({ error: "Selecciona un negocio válido." }, { status: 400 });
    }

    try {
        const { tenant } = await requireBillingOwner(tenantSlug);
        const db = getControlDb();
        const [subscription, selection] = await Promise.all([
            db.subscription.findFirst({
                where: { tenantId: tenant.tenantId, provider: "STRIPE", providerCustomerId: { not: null } },
                orderBy: { updatedAt: "desc" },
                select: { providerCustomerId: true },
            }),
            db.billingSelection.findUnique({
                where: { tenantId: tenant.tenantId },
                select: { providerCustomerId: true },
            }),
        ]);
        const customerId = subscription?.providerCustomerId || selection?.providerCustomerId;
        if (!customerId) {
            return NextResponse.json({ error: "Aún no existe una suscripción para administrar." }, { status: 409 });
        }

        const portal = await getStripeClient().billingPortal.sessions.create({
            customer: customerId,
            return_url: `${getPlatformBaseUrl()}/billing/${tenant.slug}`,
        });
        return NextResponse.json({ url: portal.url });
    } catch (error) {
        if (error instanceof BillingAccessError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof StripeBillingConfigurationError) {
            return NextResponse.json({ error: "La facturación no está disponible en este momento." }, { status: 503 });
        }
        console.error("[billing.portal] Failed to create Customer Portal session", error);
        return NextResponse.json({ error: "No fue posible abrir el portal de facturación." }, { status: 500 });
    }
}
