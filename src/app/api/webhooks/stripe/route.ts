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

async function syncStripeSubscription(subscription: Stripe.Subscription) {
    const tenantId = subscription.metadata.tenantId?.trim();
    if (!tenantId) {
        return;
    }

    const db = getControlDb();
    const [tenant, plan] = await Promise.all([
        db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
        subscription.metadata.planId
            ? db.plan.findUnique({ where: { id: subscription.metadata.planId }, select: { id: true } })
            : null,
    ]);
    if (!tenant) {
        return;
    }

    const status = toSubscriptionStatus(subscription.status);
    const period = currentPeriod(subscription);
    const providerCustomerId = customerIdFromSubscription(subscription);

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
            },
            update: {
                planId: plan?.id || null,
                providerCustomerId,
                status,
                currentPeriodStartsAt: period.startsAt,
                currentPeriodEndsAt: period.endsAt,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                canceledAt: dateFromUnixSeconds(subscription.canceled_at),
            },
        });
        await tx.tenant.update({
            where: { id: tenantId },
            data: {
                billingStatus: toBillingStatus(status),
                accessMode: accessModeForSubscription(status),
            },
        });
    });
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
