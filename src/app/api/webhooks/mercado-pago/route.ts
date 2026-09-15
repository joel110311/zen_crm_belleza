import { createHash } from "node:crypto";
import { addMonths } from "date-fns";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/control-plane";
import {
    getMercadoPagoPayment,
    getMercadoPagoWebhookSecret,
    isMercadoPagoProduction,
    MercadoPagoBillingConfigurationError,
    verifyMercadoPagoWebhookSignature,
    type MercadoPagoPayment,
} from "@/lib/billing/mercado-pago";
import { getControlDb } from "@/lib/control-db";

export const runtime = "nodejs";

const STALE_PROCESSING_MS = 5 * 60 * 1_000;

function text(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function date(value: unknown) {
    if (typeof value !== "string" || !value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function amountCents(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function paymentStatus(value: string) {
    switch (value) {
        case "approved": return "APPROVED" as const;
        case "pending":
        case "in_process":
        case "authorized": return "PENDING" as const;
        case "cancelled": return "CANCELLED" as const;
        case "refunded": return "REFUNDED" as const;
        case "charged_back": return "CHARGED_BACK" as const;
        case "rejected":
        default: return "REJECTED" as const;
    }
}

async function reconcilePayment(payment: MercadoPagoPayment) {
    const paymentId = text(payment.id);
    const externalReference = text(payment.external_reference);
    if (!paymentId || !externalReference) return;

    const db = getControlDb();
    const attempt = await db.billingCheckoutAttempt.findUnique({
        where: { externalReference },
        include: {
            tenant: { select: { id: true, trial: { select: { id: true, status: true, endsAt: true } } } },
            plan: { select: { id: true } },
        },
    });
    if (!attempt || attempt.provider !== "MERCADO_PAGO") return;

    const configuredApplicationId = process.env.MERCADO_PAGO_APPLICATION_ID?.trim();
    const receivedApplicationId = text(payment.application_id);
    const receivedAmount = amountCents(payment.transaction_amount);
    const status = text(payment.status).toLowerCase();
    const validationError = [
        configuredApplicationId && configuredApplicationId !== receivedApplicationId
            ? "La aplicación de Mercado Pago no coincide." : null,
        payment.currency_id !== attempt.currency ? "La moneda del pago no coincide." : null,
        receivedAmount !== attempt.amountCents ? "El importe del pago no coincide." : null,
        isMercadoPagoProduction() !== Boolean(payment.live_mode) ? "El entorno del pago no coincide." : null,
        attempt.providerPaymentId && attempt.providerPaymentId !== paymentId ? "El intento ya pertenece a otro pago." : null,
    ].find(Boolean);
    if (validationError) {
        await db.billingCheckoutAttempt.update({
            where: { id: attempt.id },
            data: { status: "REJECTED", providerPaymentId: attempt.providerPaymentId || paymentId, lastProviderStatus: status, lastError: validationError },
        });
        return;
    }

    const mappedStatus = paymentStatus(status);
    if (mappedStatus === "APPROVED") {
        if (attempt.status === "APPROVED" && attempt.providerPaymentId === paymentId) return;
        const paidAt = date(payment.date_approved) || new Date();
        await db.$transaction(async (tx) => {
            const existing = await tx.subscription.findFirst({
                where: { tenantId: attempt.tenantId, provider: "MERCADO_PAGO" },
                orderBy: { updatedAt: "desc" },
            });
            const periodStartsAt = [
                paidAt,
                attempt.tenant.trial && ["ACTIVE", "ENDING"].includes(attempt.tenant.trial.status)
                    ? attempt.tenant.trial.endsAt : null,
                existing?.status === "ACTIVE" ? existing.currentPeriodEndsAt : null,
            ].filter((value): value is Date => Boolean(value)).reduce((latest, value) => value > latest ? value : latest, paidAt);
            const periodEndsAt = addMonths(periodStartsAt, 1);
            const providerCustomerId = text(payment.payer?.id) || payment.payer?.email || null;
            const providerSubscriptionId = `mp_payment_${paymentId}`;

            if (existing) {
                await tx.subscription.update({
                    where: { id: existing.id },
                    data: {
                        planId: attempt.planId,
                        providerCustomerId,
                        providerSubscriptionId,
                        status: "ACTIVE",
                        currentPeriodStartsAt: periodStartsAt,
                        currentPeriodEndsAt: periodEndsAt,
                        cancelAtPeriodEnd: true,
                        canceledAt: null,
                        pastDueAt: null,
                        graceEndsAt: null,
                    },
                });
            } else {
                await tx.subscription.create({
                    data: {
                        tenantId: attempt.tenantId,
                        planId: attempt.planId,
                        provider: "MERCADO_PAGO",
                        providerCustomerId,
                        providerSubscriptionId,
                        status: "ACTIVE",
                        currentPeriodStartsAt: periodStartsAt,
                        currentPeriodEndsAt: periodEndsAt,
                        cancelAtPeriodEnd: true,
                    },
                });
            }
            await tx.billingCheckoutAttempt.update({
                where: { id: attempt.id },
                data: {
                    providerPaymentId: paymentId,
                    status: "APPROVED",
                    paidAt,
                    periodStartsAt,
                    periodEndsAt,
                    lastProviderStatus: status,
                    lastError: null,
                },
            });
            if (attempt.tenant.trial && attempt.tenant.trial.status !== "CONVERTED") {
                await tx.trial.update({
                    where: { id: attempt.tenant.trial.id },
                    data: { status: "CONVERTED", convertedAt: paidAt },
                });
            }
            await tx.tenant.update({
                where: { id: attempt.tenantId },
                data: { billingStatus: "ACTIVE", accessMode: "FULL" },
            });
            await tx.commercialEvent.create({
                data: {
                    tenantId: attempt.tenantId,
                    event: "checkout_completed",
                    source: "mercado_pago",
                    metadata: { planId: attempt.planId, checkoutAttemptId: attempt.id, paymentId },
                },
            });
        });
        return;
    }

    await db.$transaction(async (tx) => {
        await tx.billingCheckoutAttempt.update({
            where: { id: attempt.id },
            data: {
                providerPaymentId: attempt.providerPaymentId || paymentId,
                status: mappedStatus,
                lastProviderStatus: status,
                lastError: payment.status_detail || null,
            },
        });
        if (mappedStatus === "REFUNDED" || mappedStatus === "CHARGED_BACK") {
            const current = await tx.subscription.findFirst({
                where: { tenantId: attempt.tenantId, provider: "MERCADO_PAGO", providerSubscriptionId: `mp_payment_${paymentId}` },
                select: { id: true },
            });
            if (current) {
                const trialStillActive = Boolean(
                    attempt.tenant.trial
                    && ["ACTIVE", "ENDING"].includes(attempt.tenant.trial.status)
                    && attempt.tenant.trial.endsAt > new Date(),
                );
                await tx.subscription.update({
                    where: { id: current.id },
                    data: { status: "UNPAID", canceledAt: new Date() },
                });
                await tx.tenant.update({
                    where: { id: attempt.tenantId },
                    data: trialStillActive
                        ? { billingStatus: "TRIALING", accessMode: "FULL" }
                        : { billingStatus: "UNPAID", accessMode: "BILLING_ONLY" },
                });
            }
        }
    });
}

async function processEvent(providerEventId: string, eventType: string, apiVersion: string | null, payload: Prisma.InputJsonValue, paymentId: string) {
    const db = getControlDb();
    const stored = await db.billingEvent.upsert({
        where: { provider_providerEventId: { provider: "MERCADO_PAGO", providerEventId } },
        create: { provider: "MERCADO_PAGO", providerEventId, eventType, apiVersion, payload },
        update: {},
        select: { id: true, processedAt: true },
    });
    if (stored.processedAt) return;
    const claimed = await db.billingEvent.updateMany({
        where: {
            id: stored.id,
            processedAt: null,
            OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } }],
        },
        data: { processingStartedAt: new Date(), processingError: null },
    });
    if (claimed.count === 0) return;
    try {
        if (eventType === "payment") await reconcilePayment(await getMercadoPagoPayment(paymentId));
        await db.billingEvent.update({
            where: { id: stored.id },
            data: { processedAt: new Date(), processingStartedAt: null, processingError: null },
        });
    } catch (error) {
        await db.billingEvent.update({
            where: { id: stored.id },
            data: {
                processingStartedAt: null,
                processingError: error instanceof Error ? error.message.slice(0, 2_000) : "Error desconocido",
            },
        });
        throw error;
    }
}

export async function POST(request: NextRequest) {
    try {
        const rawPayload = await request.text();
        const payload = JSON.parse(rawPayload) as Record<string, unknown>;
        const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
        const dataId = request.nextUrl.searchParams.get("data.id") || text(data.id) || null;
        const eventType = request.nextUrl.searchParams.get("type")
            || request.nextUrl.searchParams.get("topic")
            || text(payload.type);
        const xSignature = request.headers.get("x-signature");
        const xRequestId = request.headers.get("x-request-id");
        if (!xSignature || !dataId || !eventType) {
            return NextResponse.json({ error: "Notificación incompleta." }, { status: 400 });
        }
        if (!verifyMercadoPagoWebhookSignature({
            xSignature,
            xRequestId,
            dataId,
            secret: getMercadoPagoWebhookSecret(),
        })) {
            return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
        }

        const notificationId = text(payload.id);
        const providerEventId = notificationId || createHash("sha256")
            .update(`${eventType}:${dataId}:${xSignature}:${rawPayload}`)
            .digest("hex");
        await processEvent(
            providerEventId,
            eventType,
            text(payload.api_version) || null,
            payload as Prisma.InputJsonValue,
            dataId,
        );
        return NextResponse.json({ received: true });
    } catch (error) {
        if (error instanceof MercadoPagoBillingConfigurationError) {
            console.error("[webhooks.mercado-pago] Billing configuration error", error.message);
            return NextResponse.json({ error: "Facturación no configurada." }, { status: 503 });
        }
        if (error instanceof SyntaxError) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
        console.error("[webhooks.mercado-pago] Failed to process webhook", error);
        return NextResponse.json({ error: "No fue posible procesar el webhook." }, { status: 500 });
    }
}
