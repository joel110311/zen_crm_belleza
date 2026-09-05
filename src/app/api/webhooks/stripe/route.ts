import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@/generated/control-plane";
import { accessModeForSubscription, toBillingStatus, toSubscriptionStatus } from "@/lib/billing/subscription-state";
import { getStripeClient, getStripeWebhookSecret, StripeBillingConfigurationError } from "@/lib/billing/stripe";
import { getControlDb } from "@/lib/control-db";

export const runtime = "nodejs";

const STALE_PROCESSING_MS = 5 * 60 * 1000;

function customerIdFromSubscription(subscription: Stripe.Subscription): string | null {
    return typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
}

function dateFromUnixSeconds(value: number | null | undefined): Date | null {
    return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1_000) : null;
}

function currentPeriod(subscription: Stripe.Subscription) {
    const items = subscription.items.data;
    const starts = items.map((item) => item.current_period_start).filter(Number.isFinite);
    const ends = items.map((item) => item.current_period_end).filter(Number.isFinite);
    return {
        startsAt: starts.length ? dateFromUnixSeconds(Math.min(...starts)) : null,
        endsAt: ends.length ? dateFromUnixSeconds(Math.max(...ends)) : null,
    };
}

function subscriptionIdFromObject(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const object = value as Record<string, unknown>;
    const direct = object.subscription;
    if (typeof direct === "string") return direct;
    if (direct && typeof direct === "object" && typeof (direct as { id?: unknown }).id === "string") {
        return (direct as { id: string }).id;
    }
    const parent = object.parent;
    if (parent && typeof parent === "object") {
        const details = (parent as Record<string, unknown>).subscription_details;
        if (details && typeof details === "object") {
            const nested = (details as Record<string, unknown>).subscription;
            if (typeof nested === "string") return nested;
            if (nested && typeof nested === "object" && typeof (nested as { id?: unknown }).id === "string") {
                return (nested as { id: string }).id;
            }
        }
    }
    return null;
}

async function syncStripeSubscription(subscription: Stripe.Subscription) {
    const tenantId = subscription.metadata.tenantId?.trim();
    if (!tenantId) {
        return;
    }

    const db = getControlDb();
    const [tenant, plan, existingSubscription, defaultPolicy] = await Promise.all([
        db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                trial: {
                    select: {
                        id: true,
                        status: true,
                        endsAt: true,
                        policy: { select: { graceDays: true } },
                    },
                },
            },
        }),
        subscription.metadata.planId
            ? db.plan.findUnique({ where: { id: subscription.metadata.planId }, select: { id: true } })
            : null,
        db.subscription.findUnique({
            where: { providerSubscriptionId: subscription.id },
            select: { pastDueAt: true, graceEndsAt: true, status: true },
        }),
        db.trialPolicy.findFirst({
            where: { isActive: true, isDefault: true },
            select: { graceDays: true },
        }),
    ]);
    if (!tenant) {
        return;
    }

    const status = toSubscriptionStatus(subscription.status);
    const period = currentPeriod(subscription);
    const providerCustomerId = customerIdFromSubscription(subscription);
    const now = new Date();
    const graceDays = tenant.trial?.policy?.graceDays ?? defaultPolicy?.graceDays ?? 3;
    const pastDueAt = status === "PAST_DUE" ? existingSubscription?.pastDueAt || now : null;
    const graceEndsAt = status === "PAST_DUE"
        ? existingSubscription?.graceEndsAt || new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1_000)
        : null;
    const internalTrialActive = Boolean(
        tenant.trial
        && ["ACTIVE", "ENDING"].includes(tenant.trial.status)
        && tenant.trial.endsAt > now,
    );
    const subscriptionGrantsAccess = status === "ACTIVE" || status === "TRIALING";
    const accessMode = subscriptionGrantsAccess
        ? "FULL"
        : internalTrialActive
            ? "FULL"
            : accessModeForSubscription(status, graceEndsAt, now);
    const billingStatus = !subscriptionGrantsAccess && internalTrialActive
        ? "TRIALING"
        : toBillingStatus(status);

    await db.$transaction(async (tx) => {
        await tx.subscription.upsert({
            where: { providerSubscriptionId: subscription.id },
            create: {
                tenantId,
                planId: plan?.id || null,
                provider: "STRIPE",
                providerCustomerId,
                providerSubscriptionId: subscription.id,
                status,
                currentPeriodStartsAt: period.startsAt,
                currentPeriodEndsAt: period.endsAt,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                canceledAt: dateFromUnixSeconds(subscription.canceled_at),
                pastDueAt,
                graceEndsAt,
            },
            update: {
                planId: plan?.id || null,
                providerCustomerId,
                status,
                currentPeriodStartsAt: period.startsAt,
                currentPeriodEndsAt: period.endsAt,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                canceledAt: dateFromUnixSeconds(subscription.canceled_at),
                pastDueAt,
                graceEndsAt,
            },
        });
        if (status === "ACTIVE" && tenant.trial && tenant.trial.status !== "CONVERTED") {
            await tx.trial.update({
                where: { id: tenant.trial.id },
                data: { status: "CONVERTED", convertedAt: now },
            });
        }
        await tx.tenant.update({
            where: { id: tenantId },
            data: {
                billingStatus,
                accessMode,
            },
        });
    });
}

async function scheduleCheckoutSelection(checkout: Stripe.Checkout.Session) {
    if (checkout.mode !== "setup") return;
    const selectionId = checkout.metadata?.billingSelectionId?.trim();
    const tenantId = checkout.metadata?.tenantId?.trim();
    const setupIntentId = typeof checkout.setup_intent === "string" ? checkout.setup_intent : checkout.setup_intent?.id;
    const customerId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id;
    if (!selectionId || !tenantId || !setupIntentId || !customerId) throw new Error("Stripe Checkout no devolvió la configuración programada completa.");

    const stripe = getStripeClient();
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
    if (setupIntent.status !== "succeeded" || !paymentMethodId) throw new Error("El método de pago todavía no está confirmado.");

    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
    const updated = await getControlDb().billingSelection.updateMany({
        where: { id: selectionId, tenantId, status: "PENDING_SETUP" },
        data: {
            providerSetupIntentId: setupIntentId,
            providerPaymentMethod: paymentMethodId,
            providerCustomerId: customerId,
            status: "SCHEDULED",
            lastError: null,
        },
    });
    if (updated.count !== 1) throw new Error("La selección de plan ya no está disponible.");
}

async function processStripeEvent(event: Stripe.Event, rawPayload: Prisma.InputJsonValue) {
    const db = getControlDb();
    const stored = await db.billingEvent.upsert({
        where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } },
        create: {
            provider: "STRIPE",
            providerEventId: event.id,
            eventType: event.type,
            apiVersion: event.api_version,
            payload: rawPayload,
        },
        update: {},
        select: { id: true, processedAt: true, processingStartedAt: true },
    });
    if (stored.processedAt) {
        return;
    }

    const now = new Date();
    const claim = await db.billingEvent.updateMany({
        where: {
            id: stored.id,
            processedAt: null,
            OR: [
                { processingStartedAt: null },
                { processingStartedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
            ],
        },
        data: { processingStartedAt: now, processingError: null },
    });
    if (claim.count === 0) {
        return;
    }

    try {
        if (
            event.type === "customer.subscription.created"
            || event.type === "customer.subscription.updated"
            || event.type === "customer.subscription.deleted"
        ) {
            await syncStripeSubscription(event.data.object as Stripe.Subscription);
        } else if (
            event.type === "checkout.session.completed"
            || event.type === "invoice.paid"
            || event.type === "invoice.payment_succeeded"
            || event.type === "invoice.payment_failed"
        ) {
            const checkout = event.type === "checkout.session.completed"
                ? event.data.object as Stripe.Checkout.Session
                : null;
            if (checkout) await scheduleCheckoutSelection(checkout);
            const subscriptionId = subscriptionIdFromObject(event.data.object);
            if (subscriptionId) {
                await syncStripeSubscription(await getStripeClient().subscriptions.retrieve(subscriptionId));
            }
            if (event.type === "checkout.session.completed") {
                const tenantId = checkout?.metadata?.tenantId?.trim();
                if (tenantId) {
                    await db.commercialEvent.create({
                        data: {
                            tenantId,
                            userId: checkout?.metadata?.userId || null,
                            event: "checkout_completed",
                            source: "stripe",
                            metadata: { providerEventId: event.id },
                        },
                    });
                }
            }
        }
        await db.billingEvent.update({
            where: { id: stored.id },
            data: { processedAt: new Date(), processingStartedAt: null, processingError: null },
        });
    } catch (error) {
        const processingError = error instanceof Error ? error.message.slice(0, 2_000) : "Error desconocido";
        await db.billingEvent.update({
            where: { id: stored.id },
            data: { processingStartedAt: null, processingError },
        });
        throw error;
    }
}

export async function POST(request: NextRequest) {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
        return NextResponse.json({ error: "Falta la firma de Stripe." }, { status: 400 });
    }

    try {
        const rawPayload = await request.text();
        const event = getStripeClient().webhooks.constructEvent(rawPayload, signature, getStripeWebhookSecret());
        await processStripeEvent(event, JSON.parse(rawPayload) as Prisma.InputJsonValue);
        return NextResponse.json({ received: true });
    } catch (error) {
        if (error instanceof StripeBillingConfigurationError) {
            console.error("[webhooks.stripe] Billing configuration error", error.message);
            return NextResponse.json({ error: "Facturación no configurada." }, { status: 503 });
        }
        if (error instanceof Error && error.name === "StripeSignatureVerificationError") {
            return NextResponse.json({ error: "Firma de Stripe inválida." }, { status: 400 });
        }
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
        }
        console.error("[webhooks.stripe] Failed to process webhook", error);
        return NextResponse.json({ error: "No fue posible procesar el webhook." }, { status: 500 });
    }
}
