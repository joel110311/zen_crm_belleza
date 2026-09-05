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
        const [price, trial, pendingSelection] = await Promise.all([
            db.billingPrice.findFirst({
                where: {
                    provider: "STRIPE",
                    interval,
                    countryCode: null,
                    isActive: true,
                    plan: { slug: planSlug, isActive: true },
                },
                select: { id: true, externalPriceId: true, planId: true },
            }),
            db.trial.findUnique({
                where: { tenantId: tenant.tenantId },
                select: { endsAt: true, status: true },
            }),
            db.billingSelection.findUnique({
                where: { tenantId: tenant.tenantId },
                select: { id: true, status: true, providerCustomerId: true, providerPaymentMethod: true },
            }),
        ]);
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

        const customerId = existingSubscriptions[0]?.providerCustomerId || pendingSelection?.providerCustomerId || undefined;
        const baseUrl = getPlatformBaseUrl();
        const stripe = getStripeClient();
        const now = new Date();
        const trialActive = Boolean(trial && ["ACTIVE", "ENDING"].includes(trial.status) && trial.endsAt > now);
        const canUseCheckoutTrial = Boolean(trialActive && trial!.endsAt.getTime() - now.getTime() >= (48 * 60 + 5) * 60 * 1_000);
        if (trialActive && pendingSelection?.status === "SCHEDULED" && pendingSelection.providerPaymentMethod) {
            await db.$transaction([
                db.billingSelection.update({
                    where: { id: pendingSelection.id },
                    data: { planId: price.planId, billingPriceId: price.id, scheduledFor: trial!.endsAt, lastError: null },
                }),
                db.commercialEvent.create({
                    data: {
                        tenantId: tenant.tenantId,
                        userId: user.id,
                        event: "scheduled_plan_changed",
                        source: "billing_page",
                        metadata: { planId: price.planId, interval },
                    },
                }),
            ]);
            return NextResponse.json({ url: `${baseUrl}/billing/${tenant.slug}?checkout=scheduled` });
        }
        let checkout;
        if (trialActive && !canUseCheckoutTrial) {
            const resolvedCustomerId = customerId || (await stripe.customers.create({
                email: user.email,
                metadata: { tenantId: tenant.tenantId, tenantSlug: tenant.slug },
            })).id;
            const selection = await db.billingSelection.upsert({
                where: { tenantId: tenant.tenantId },
                create: {
                    tenantId: tenant.tenantId,
                    planId: price.planId,
                    billingPriceId: price.id,
                    providerCustomerId: resolvedCustomerId,
                    scheduledFor: trial!.endsAt,
                },
                update: {
                    planId: price.planId,
                    billingPriceId: price.id,
                    providerCustomerId: resolvedCustomerId,
                    providerSetupIntentId: null,
                    providerPaymentMethod: null,
                    status: "PENDING_SETUP",
                    scheduledFor: trial!.endsAt,
                    lastError: null,
                },
                select: { id: true },
            });
            checkout = await stripe.checkout.sessions.create({
                mode: "setup",
                customer: resolvedCustomerId,
                client_reference_id: tenant.tenantId,
                success_url: `${baseUrl}/billing/${tenant.slug}?checkout=scheduled&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${baseUrl}/billing/${tenant.slug}?checkout=cancelled`,
                metadata: {
                    tenantId: tenant.tenantId,
                    tenantSlug: tenant.slug,
                    planId: price.planId,
                    userId: user.id,
                    billingSelectionId: selection.id,
                },
                setup_intent_data: {
                    metadata: {
                        tenantId: tenant.tenantId,
                        planId: price.planId,
                        billingSelectionId: selection.id,
                    },
                },
            });
        } else {
            checkout = await stripe.checkout.sessions.create({
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
                    ...(canUseCheckoutTrial ? { trial_end: Math.floor(trial!.endsAt.getTime() / 1_000) } : {}),
                    metadata: {
                        tenantId: tenant.tenantId,
                        tenantSlug: tenant.slug,
                        planId: price.planId,
                    },
                },
            });
        }

        await db.commercialEvent.create({
            data: {
                tenantId: tenant.tenantId,
                userId: user.id,
                event: "checkout_started",
                source: "billing_page",
                metadata: { planId: price.planId, interval, deferredSetup: trialActive && !canUseCheckoutTrial },
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
