import { NextRequest, NextResponse } from "next/server";
import { BillingAccessError, requireBillingOwner } from "@/lib/billing/context";
import { getPlatformBaseUrl, getStripeClient, StripeBillingConfigurationError } from "@/lib/billing/stripe";
import { getControlDb } from "@/lib/control-db";

export const runtime = "nodejs";

function isSameOriginRequest(request: NextRequest): boolean {
    const origin = request.headers.get("origin");
    return !origin || origin === new URL(request.url).origin;
}

function errorResponse(error: unknown) {
    if (error instanceof BillingAccessError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof StripeBillingConfigurationError) {
        return NextResponse.json({ error: "La facturación no está disponible en este momento." }, { status: 503 });
    }

    console.error("[billing.checkout] Failed to create Checkout session", error);
    return NextResponse.json({ error: "No fue posible iniciar el pago. Inténtalo de nuevo." }, { status: 500 });
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) {
        return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
    }

    const tenantSlug = typeof body.tenantSlug === "string" ? body.tenantSlug : "";
    const planSlug = typeof body.planSlug === "string" ? body.planSlug : "";
    const interval = body.interval === "annual" ? "ANNUAL" : body.interval === "monthly" ? "MONTHLY" : null;
    if (!tenantSlug || !planSlug || !interval) {
        return NextResponse.json({ error: "Selecciona un plan y periodicidad válidos." }, { status: 400 });
    }

    try {
        const { tenant, user } = await requireBillingOwner(tenantSlug);
        const db = getControlDb();
        const price = await db.billingPrice.findFirst({
            where: {
                provider: "STRIPE",
                interval,
                countryCode: null,
                isActive: true,
                plan: { slug: planSlug, isActive: true },
            },
            select: { externalPriceId: true, planId: true },
        });
        if (!price) {
            return NextResponse.json({ error: "Este plan no está disponible para pago en línea." }, { status: 409 });
        }

        const existingSubscriptions = await db.subscription.findMany({
            where: { tenantId: tenant.tenantId, provider: "STRIPE", providerCustomerId: { not: null } },
            orderBy: { updatedAt: "desc" },
            select: { providerCustomerId: true, status: true },
            take: 5,
        });
        const activeSubscription = existingSubscriptions.find((subscription) =>
            ["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID", "INCOMPLETE"].includes(subscription.status),
        );
        if (activeSubscription?.providerCustomerId) {
            return NextResponse.json(
                { error: "Ya existe una suscripción para este negocio. Adminístrala desde el portal de facturación.", portalAvailable: true },
                { status: 409 },
            );
        }

        const customerId = existingSubscriptions[0]?.providerCustomerId || undefined;
        const baseUrl = getPlatformBaseUrl();
        const stripe = getStripeClient();
        const checkout = await stripe.checkout.sessions.create({
            mode: "subscription",
            line_items: [{ price: price.externalPriceId, quantity: 1 }],
            ...(customerId ? { customer: customerId } : { customer_email: user.email }),
            client_reference_id: tenant.tenantId,
            success_url: `${baseUrl}/billing/${tenant.slug}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/billing/${tenant.slug}?checkout=cancelled`,
            metadata: {
                tenantId: tenant.tenantId,
                tenantSlug: tenant.slug,
                planId: price.planId,
                userId: user.id,
            },
            subscription_data: {
                metadata: {
                    tenantId: tenant.tenantId,
                    tenantSlug: tenant.slug,
                    planId: price.planId,
                },
            },
        });

        if (!checkout.url) {
            throw new Error("Stripe no devolvió una URL de Checkout.");
        }
        return NextResponse.json({ url: checkout.url });
    } catch (error) {
        return errorResponse(error);
    }
}
