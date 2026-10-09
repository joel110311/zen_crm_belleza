import "server-only";
import { randomUUID } from "node:crypto";
import type { MercadoPagoAgreement, MercadoPagoPlanChange, Prisma } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { getPlatformBaseUrl } from "./stripe";
import { agreementIdentityError, agreementValidationError, providerAmountCents, providerDate, RecurringBillingError } from "./recurring-policy";
import { PLAN_CHANGE_CONSENT_VERSION, proratedUpgradeCents } from "./plan-change-policy";
import {
    createMercadoPagoPreference, getMercadoPagoAgreementRuntime, getMercadoPagoPreapproval,
    getMercadoPagoPayment, searchMercadoPagoPayments, searchMercadoPagoInvoices, updateMercadoPagoSubscriptionPrice, refundMercadoPagoPayment, isMercadoPagoSubscriptionsEnabled,
    type MercadoPagoPayment, type MercadoPagoRuntimeConfiguration,
} from "./mercado-pago";

const RENEWAL_GUARD_MS = 60 * 60_000;
async function lock(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
}

async function assertProviderWindow(agreement: MercadoPagoAgreement, effectiveAt: Date, amount: number) {
    if (!agreement.providerSubscriptionId || agreement.status !== "AUTHORIZED" || agreement.cancelRequestedAt) throw new RecurringBillingError("La renovación debe estar activa y sin una cancelación pendiente.");
    const runtime = getMercadoPagoAgreementRuntime(agreement.environment, agreement.applicationId);
    const resource = await getMercadoPagoPreapproval(agreement.providerSubscriptionId, runtime);
    const error = agreementValidationError(agreement, resource);
    if (error || resource.status !== "authorized") throw new RecurringBillingError(error || "Mercado Pago no tiene activa esta suscripción.");
    const next = providerDate(resource.next_payment_date);
    if (!next || Math.abs(next.getTime() - effectiveAt.getTime()) > 60_000 || effectiveAt.getTime() - Date.now() < RENEWAL_GUARD_MS) throw new RecurringBillingError("La renovación está próxima o en revisión. Actualiza el estado y espera a que termine ese cobro antes de cambiar de plan.");
    const invoices = await searchMercadoPagoInvoices({ preapproval_id: resource.id, limit: 20 }, runtime);
    if ((invoices.results || []).some(invoice => invoice.preapproval_id === resource.id && (providerDate(invoice.debit_date)?.getTime() ?? 0) >= effectiveAt.getTime() - 1000 && providerAmountCents(invoice.transaction_amount) !== amount)) {
        throw new RecurringBillingError("Mercado Pago ya preparó el siguiente cobro. Espera su confirmación para cambiar de plan sin duplicar importes.");
    }
    return { runtime, resource };
}

export async function quoteRecurringPlanChange(tenantId: string, targetPlanSlug: string) {
    if (!isMercadoPagoSubscriptionsEnabled()) throw new RecurringBillingError("Los cambios de suscripción aún no están habilitados.", 503);
    const db = getControlDb();
    const agreement = await db.mercadoPagoAgreement.findUnique({ where: { activeKey: tenantId } });
    if (!agreement) throw new RecurringBillingError("Primero necesitas una suscripción mensual automática activa para utilizar este cambio de plan.");
    const subscription = agreement.providerSubscriptionId ? await db.subscription.findUnique({ where: { providerSubscriptionId: agreement.providerSubscriptionId } }) : null;
    const target = await db.plan.findFirst({ where: { slug: targetPlanSlug, isActive: true, monthlyAmountCents: { gt: 0 }, currency: agreement.currency } });
    if (!target?.monthlyAmountCents || target.id === agreement.planId || target.monthlyAmountCents === agreement.amountCents) throw new RecurringBillingError("Selecciona otro plan con un precio válido.");
    if (!subscription || subscription.status !== "ACTIVE" || subscription.planId !== agreement.planId || !subscription.currentPeriodStartsAt || !subscription.currentPeriodEndsAt || subscription.currentPeriodStartsAt > new Date() || subscription.currentPeriodEndsAt <= new Date()) throw new RecurringBillingError("Este cambio requiere un periodo mensual ya pagado y vigente. No se cobra una mejora durante la prueba.");
    await assertProviderWindow(agreement, subscription.currentPeriodEndsAt, target.monthlyAmountCents);
    return db.$transaction(async tx => {
        await lock(tx, tenantId);
        const current = await tx.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
        const paid = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
        if (current.amountCents !== agreement.amountCents || current.planId !== agreement.planId || current.status !== "AUTHORIZED" || current.cancelRequestedAt || paid.status !== "ACTIVE" || paid.currentPeriodEndsAt?.getTime() !== subscription.currentPeriodEndsAt!.getTime()) throw new RecurringBillingError("El estado cambió. Actualiza la página antes de continuar.");
        const previous = await tx.mercadoPagoPlanChange.findUnique({ where: { activeKey: current.id } });
        if (previous) {
            if (previous.status === "QUOTED") await tx.mercadoPagoPlanChange.update({ where: { id: previous.id }, data: { status: "EXPIRED", activeKey: null } });
            else throw new RecurringBillingError("Ya hay un cambio en curso para este periodo. Confírmalo o espera a la siguiente renovación antes de solicitar otro.");
        }
        const now = new Date();
        const upgrade = target.monthlyAmountCents! > current.amountCents;
        const amountTodayCents = upgrade ? proratedUpgradeCents(current.amountCents, target.monthlyAmountCents!, paid.currentPeriodStartsAt!, paid.currentPeriodEndsAt!, now) : 0;
        if (upgrade && amountTodayCents < 100) throw new RecurringBillingError("El proporcional es demasiado pequeño para un cobro seguro. Espera la siguiente renovación.");
        const id = randomUUID();
        const change = await tx.mercadoPagoPlanChange.create({ data: {
            id, agreementId: current.id, activeKey: current.id, sourcePlanId: current.planId, targetPlanId: target.id,
            fromAmountCents: current.amountCents, toAmountCents: target.monthlyAmountCents!, amountTodayCents, currency: current.currency,
            direction: upgrade ? "UPGRADE" : "DOWNGRADE", periodStartsAt: paid.currentPeriodStartsAt!, effectiveAt: paid.currentPeriodEndsAt!,
            quotedAt: now, expiresAt: new Date(now.getTime() + 10 * 60_000), externalReference: `sl_change_${id.replaceAll("-", "")}`,
        } });
        return { id: change.id, direction: change.direction, amountTodayCents, monthlyAmountCents: change.toAmountCents, currency: change.currency,
            planName: target.name, effectiveAt: change.effectiveAt.toISOString(), expiresAt: change.expiresAt.toISOString(), consentVersion: PLAN_CHANGE_CONSENT_VERSION };
    });
}

export async function acceptRecurringPlanChange(tenantId: string, tenantSlug: string, user: { id: string; email: string }, changeId: string, consent: unknown, version: unknown) {
    if (consent !== true || version !== PLAN_CHANGE_CONSENT_VERSION) throw new RecurringBillingError("Acepta el cargo proporcional y el nuevo importe de renovación.", 400);
    const db = getControlDb();
    const prepared = await db.$transaction(async tx => {
        await lock(tx, tenantId);
        const change = await tx.mercadoPagoPlanChange.findUnique({ where: { id: changeId }, include: { agreement: true, payment: true } });
        if (!change || change.agreement.tenantId !== tenantId) throw new RecurringBillingError("Cambio no disponible.", 404);
        if (change.status === "PAYMENT_PENDING" && change.checkoutUrl && change.expiresAt > new Date()) return { change, reused: true };
        if (change.status !== "QUOTED" || change.expiresAt <= new Date() || change.activeKey !== change.agreementId) throw new RecurringBillingError("Esta confirmación venció o ya está en proceso. Actualiza el estado antes de reintentar.");
        const target = await tx.plan.findUnique({ where: { id: change.targetPlanId } });
        if (!target?.isActive || target.monthlyAmountCents !== change.toAmountCents || target.currency !== change.currency) throw new RecurringBillingError("El precio cambió. Solicita una nueva confirmación antes de pagar.");
        if (change.agreement.planId !== change.sourcePlanId || change.agreement.amountCents !== change.fromAmountCents || change.agreement.cancelRequestedAt || change.agreement.status !== "AUTHORIZED") throw new RecurringBillingError("La suscripción cambió. Actualiza el estado antes de continuar.");
        await tx.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { consentAt: new Date(), consentUserId: user.id, consentVersion: PLAN_CHANGE_CONSENT_VERSION, status: change.direction === "UPGRADE" ? "CHECKOUT_CREATING" : "ACCEPTED" } });
        if (change.direction === "UPGRADE") await tx.billingCheckoutAttempt.create({ data: {
            id: randomUUID(), tenantId, planId: change.targetPlanId, provider: "MERCADO_PAGO", externalReference: change.externalReference,
            recurringAgreementId: change.agreementId, planChangeId: change.id, amountCents: change.amountTodayCents, currency: change.currency,
        } });
        return { change, reused: false };
    });
    if (prepared.reused) return { url: prepared.change.checkoutUrl! };
    const { change } = prepared;
    if (change.direction === "DOWNGRADE") { await applyRecurringPlanChange(change.id); return { ok: true }; }
    const runtime = getMercadoPagoAgreementRuntime(change.agreement.environment, change.agreement.applicationId);
    const base = getPlatformBaseUrl();
    const billing = `${base}/billing/${encodeURIComponent(tenantSlug)}?checkout=plan-change`;
    try {
        const preference = await createMercadoPagoPreference({ runtime, expiresAt: change.expiresAt, idempotencyKey: change.id,
            externalReference: change.externalReference, title: "Mejora de plan · diferencia proporcional", description: "Sólo la diferencia del periodo vigente; no agrega otro mes de acceso.",
            amountCents: change.amountTodayCents, currency: change.currency, payerEmail: user.email,
            successUrl: billing, pendingUrl: billing, failureUrl: billing, notificationUrl: `${base}/api/webhooks/mercado-pago`, tenantId, planId: change.targetPlanId,
        });
        const url = runtime.environment === "production" ? preference.init_point : preference.sandbox_init_point || preference.init_point;
        if (!url) throw new Error("Falta la URL de pago proporcional.");
        await db.$transaction([
            db.billingCheckoutAttempt.update({ where: { planChangeId: change.id }, data: { providerCheckoutId: preference.id } }),
            db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "PAYMENT_PENDING", checkoutUrl: url } }),
        ]);
        return { url };
    } catch (error) {
        await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { lastError: "No se confirmó la apertura del pago. No se creará un segundo Checkout automáticamente." } });
        throw error;
    }
}

async function requestUpgradeRefund(change: MercadoPagoPlanChange, paymentId: string, runtime: MercadoPagoRuntimeConfiguration) {
    const db = getControlDb();
    const claim = await db.mercadoPagoPlanChange.updateMany({ where: { id: change.id, refundedAt: null }, data: { status: "REFUND_PENDING", processingAt: null, lastError: "El cambio no pudo aplicarse a su periodo. Se está verificando la devolución del proporcional." } });
    if (!claim.count) return;
    const result = await refundMercadoPagoPayment(paymentId, `plan-change-${change.id}-${paymentId}`, runtime);
    if (!result.id) throw new Error("Mercado Pago no confirmó la solicitud de devolución.");
}

async function refundDuplicate(paymentId: string, changeId: string, runtime: MercadoPagoRuntimeConfiguration) {
    const result = await refundMercadoPagoPayment(paymentId, `duplicate-plan-change-${changeId}-${paymentId}`, runtime);
    if (!result.id) throw new Error("No se confirmó la devolución del pago duplicado; se reintentará.");
}

/** Durable, retryable update of the SAME subscription. A lost PUT response never creates another one. */
export async function applyRecurringPlanChange(changeId: string) {
    const db = getControlDb();
    const change = await db.mercadoPagoPlanChange.findUniqueOrThrow({ where: { id: changeId }, include: { agreement: true, payment: true } });
    if (change.appliedAt || !["PAID", "ACCEPTED", "PROVIDER_UPDATING"].includes(change.status)) return;
    if (change.direction === "UPGRADE" && (!change.payment?.paidAt || change.payment.status !== "APPROVED")) return;
    const claim = await db.mercadoPagoPlanChange.updateMany({ where: { id: change.id, status: { in: ["PAID", "ACCEPTED", "PROVIDER_UPDATING"] }, OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - 2 * 60_000) } }] }, data: { status: "PROVIDER_UPDATING", processingAt: new Date() } });
    if (!claim.count) throw new RecurringBillingError("El cambio se está verificando. Actualiza su estado en unos minutos.");
    const agreement = change.agreement;
    const runtime = getMercadoPagoAgreementRuntime(agreement.environment, agreement.applicationId);
    try {
        const sub = await db.subscription.findUnique({ where: { providerSubscriptionId: agreement.providerSubscriptionId! } });
        let resource = await getMercadoPagoPreapproval(agreement.providerSubscriptionId!, runtime);
        if (agreementIdentityError(agreement, resource)) throw new Error("La identidad de la suscripción no coincide.");
        const validPeriod = !agreement.cancelRequestedAt && agreement.status === "AUTHORIZED" && sub?.status === "ACTIVE" && sub.currentPeriodEndsAt?.getTime() === change.effectiveAt.getTime() && change.effectiveAt > new Date();
        if (!validPeriod && providerAmountCents(resource.auto_recurring?.transaction_amount) !== change.toAmountCents) {
            if (change.direction === "UPGRADE" && change.payment?.providerPaymentId) await requestUpgradeRefund(change, change.payment.providerPaymentId, runtime);
            else await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "CANCELED", activeKey: null, processingAt: null } });
            return;
        }
        const price = providerAmountCents(resource.auto_recurring?.transaction_amount);
        if (price !== change.toAmountCents) {
            // Re-read window immediately before PUT; never accept a prepared/processing old-price bill.
            try { await assertProviderWindow(agreement, change.effectiveAt, change.toAmountCents); }
            catch (error) {
                if (!(error instanceof RecurringBillingError)) throw error;
                if (change.direction === "UPGRADE" && change.payment?.providerPaymentId) await requestUpgradeRefund(change, change.payment.providerPaymentId, runtime);
                else await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "CANCELED", activeKey: null, processingAt: null, lastError: error.message } });
                return;
            }
            await updateMercadoPagoSubscriptionPrice(agreement.providerSubscriptionId!, change.toAmountCents, change.currency, runtime);
            resource = await getMercadoPagoPreapproval(agreement.providerSubscriptionId!, runtime);
        }
        const validation = agreementValidationError({ ...agreement, amountCents: change.toAmountCents }, resource);
        const next = providerDate(resource.next_payment_date);
        if (validation) throw new Error(validation);
        const applied = await db.$transaction(async tx => {
            await lock(tx, agreement.tenantId);
            const current = await tx.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
            const lockedChange = await tx.mercadoPagoPlanChange.findUniqueOrThrow({ where: { id: change.id } });
            if (lockedChange.appliedAt) return true;
            // Persist price history even when cancellation/period rollover wins the race after PUT.
            await tx.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { initialPlanId: current.initialPlanId || change.sourcePlanId, initialAmountCents: current.initialAmountCents || change.fromAmountCents,
                planId: change.targetPlanId, amountCents: change.toAmountCents, nextPaymentAt: next, providerModifiedAt: providerDate(resource.last_modified) } });
            await tx.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { providerAppliedAt: lockedChange.providerAppliedAt || new Date() } });
            const paid = await tx.subscription.findUnique({ where: { providerSubscriptionId: agreement.providerSubscriptionId! } });
            if (current.cancelRequestedAt || current.status !== "AUTHORIZED" || resource.status !== "authorized" || !next || Math.abs(next.getTime() - change.effectiveAt.getTime()) > 60_000
                || paid?.status !== "ACTIVE" || paid.currentPeriodEndsAt?.getTime() !== change.effectiveAt.getTime() || change.effectiveAt <= new Date()
                || lockedChange.refundedAt || (change.direction === "UPGRADE" && (await tx.billingCheckoutAttempt.findUnique({ where: { planChangeId: change.id } }))?.status !== "APPROVED")) return false;
            if (change.direction === "UPGRADE") await tx.subscription.update({ where: { id: paid.id }, data: { planId: change.targetPlanId } });
            await tx.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "APPLIED", providerAppliedAt: new Date(), appliedAt: new Date(), processingAt: null, lastError: null } });
            await tx.commercialEvent.create({ data: { tenantId: agreement.tenantId, userId: change.consentUserId, event: "subscription_plan_changed", source: "mercado_pago", metadata: { changeId: change.id, direction: change.direction, amountTodayCents: change.amountTodayCents, monthlyAmountCents: change.toAmountCents, effectiveAt: change.effectiveAt.toISOString() } } });
            return true;
        });
        if (!applied) {
            // Never leave a future higher debit after a proportional payment cannot grant its upgrade.
            await db.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { cancelRequestedAt: new Date() } });
            if (change.direction === "UPGRADE" && change.payment?.providerPaymentId) await requestUpgradeRefund(change, change.payment.providerPaymentId, runtime);
            else await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "CANCELED", processingAt: null, activeKey: null, lastError: "El cambio no pudo confirmar el periodo; se solicitó detener la renovación." } });
        }
    } catch (error) {
        await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { processingAt: null, lastError: "El cambio sigue en verificación. No se iniciará otro cobro; conserva tu plan actual hasta confirmar." } });
        throw error;
    }
}

export async function reconcilePlanChangePayment(payment: MercadoPagoPayment, runtime: MercadoPagoRuntimeConfiguration) {
    if (!payment.external_reference) return false;
    const db = getControlDb();
    const change = await db.mercadoPagoPlanChange.findUnique({ where: { externalReference: payment.external_reference }, include: { agreement: true, payment: true } });
    if (!change) return false;
    if (!change.consentAt || change.direction !== "UPGRADE" || change.agreement.environment !== runtime.environment || change.agreement.applicationId !== runtime.applicationId
        || String(payment.application_id) !== runtime.applicationId || payment.live_mode !== (runtime.environment === "production")
        || payment.currency_id !== change.currency || providerAmountCents(payment.transaction_amount) !== change.amountTodayCents) throw new Error("El pago proporcional no coincide con la aceptación del cambio.");
    if (!change.payment) throw new Error("Falta el registro del cargo proporcional.");
    const paymentId = String(payment.id);
    if (change.payment.providerPaymentId && change.payment.providerPaymentId !== paymentId && change.payment.status !== "REJECTED") {
        if (payment.status === "approved") await refundDuplicate(paymentId, change.id, runtime);
        return true;
    }
    if (payment.status === "approved") {
        if (change.status === "REFUND_PENDING") { await requestUpgradeRefund(change, paymentId, runtime); return true; }
        if (change.refundedAt) return true;
        const paidAt = providerDate(payment.date_approved);
        if (!paidAt) throw new Error("Falta confirmar la aprobación del proporcional.");
        const duplicate = await db.$transaction(async tx => {
            await lock(tx, change.agreement.tenantId);
            const attempt = await tx.billingCheckoutAttempt.findUniqueOrThrow({ where: { id: change.payment!.id } });
            const current = await tx.mercadoPagoPlanChange.findUniqueOrThrow({ where: { id: change.id } });
            if (current.refundedAt) return false;
            if (attempt.providerPaymentId && attempt.providerPaymentId !== paymentId && attempt.status !== "REJECTED") return true;
            if (attempt.paidAt) return false;
            await tx.billingCheckoutAttempt.update({ where: { id: attempt.id }, data: { providerPaymentId: paymentId, status: "APPROVED", paidAt, lastProviderStatus: "approved", lastError: null } });
            await tx.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "PAID" } });
            return false;
        });
        if (duplicate) { await refundDuplicate(paymentId, change.id, runtime); return true; }
        if (paidAt < change.quotedAt || paidAt > change.expiresAt || ["EXPIRED", "CANCELED"].includes(change.status)) { await requestUpgradeRefund(change, paymentId, runtime); return true; }
        await applyRecurringPlanChange(change.id);
    } else if (payment.status === "refunded" || payment.status === "charged_back") {
        await db.$transaction(async tx => {
            await lock(tx, change.agreement.tenantId);
            await tx.billingCheckoutAttempt.update({ where: { id: change.payment!.id }, data: { status: payment.status === "refunded" ? "REFUNDED" : "CHARGED_BACK", lastProviderStatus: payment.status } });
            await tx.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "REFUNDED", refundedAt: new Date(), activeKey: null, lastError: null } });
            // Only undo the upgraded entitlement in its original period, never a later paid month.
            if (change.appliedAt) await tx.subscription.updateMany({ where: { tenantId: change.agreement.tenantId, providerSubscriptionId: change.agreement.providerSubscriptionId, planId: change.targetPlanId, currentPeriodEndsAt: change.effectiveAt }, data: { planId: change.sourcePlanId } });
            if (change.providerAppliedAt) await tx.mercadoPagoAgreement.update({ where: { id: change.agreementId }, data: { cancelRequestedAt: new Date() } });
        });
    } else if (!change.payment.paidAt) {
        await db.billingCheckoutAttempt.updateMany({ where: { id: change.payment.id, paidAt: null, status: { notIn: ["REFUNDED", "CHARGED_BACK"] } }, data: { providerPaymentId: paymentId, status: payment.status === "rejected" || payment.status === "cancelled" ? "REJECTED" : "PENDING", lastProviderStatus: payment.status, lastError: payment.status_detail || null } });
    }
    return true;
}

/** Select the accepted price for the invoice's debit date, preserving old-cycle/refund validation. */
export async function recurringCyclePrice(agreement: MercadoPagoAgreement, debitAt: Date) {
    const changes = await getControlDb().mercadoPagoPlanChange.findMany({ where: { agreementId: agreement.id, providerAppliedAt: { not: null }, effectiveAt: { lte: new Date(debitAt.getTime() + 1000) } }, orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }] });
    const latest = changes.at(-1);
    return { amountCents: latest?.toAmountCents ?? agreement.initialAmountCents ?? agreement.amountCents, planId: latest?.targetPlanId ?? agreement.initialPlanId ?? agreement.planId };
}

export async function recoverRecurringPlanChanges(agreementId: string) {
    const db = getControlDb();
    const change = await db.mercadoPagoPlanChange.findUnique({ where: { activeKey: agreementId }, include: { agreement: true, payment: true } });
    if (!change) return;
    if (change.status === "QUOTED" && change.expiresAt < new Date()) { await db.mercadoPagoPlanChange.update({ where: { id: change.id }, data: { status: "EXPIRED", activeKey: null } }); return; }
    if (["PAID", "ACCEPTED", "PROVIDER_UPDATING"].includes(change.status)) { await applyRecurringPlanChange(change.id); return; }
    if (change.payment && ["CHECKOUT_CREATING", "PAYMENT_PENDING", "REFUND_PENDING", "EXPIRED"].includes(change.status)) {
        const runtime = getMercadoPagoAgreementRuntime(change.agreement.environment, change.agreement.applicationId);
        const results = change.payment.providerPaymentId ? [await getMercadoPagoPayment(change.payment.providerPaymentId, runtime)] : (await searchMercadoPagoPayments(change.externalReference, runtime)).results;
        if (!results) throw new Error("No se pudo verificar si hay un pago proporcional pendiente.");
        for (const payment of results) {
            if (payment.external_reference !== change.externalReference || (change.payment.providerPaymentId && String(payment.id) !== change.payment.providerPaymentId)) throw new Error("La búsqueda del proporcional no coincide.");
            await reconcilePlanChangePayment(payment, runtime);
        }
        if (change.expiresAt < new Date() && (results.length === 0 || results.every(payment => ["rejected", "cancelled", "refunded"].includes(payment.status || "")))) {
            await db.mercadoPagoPlanChange.updateMany({ where: { id: change.id, status: { in: ["CHECKOUT_CREATING", "PAYMENT_PENDING", "EXPIRED"] } }, data: { status: "EXPIRED", activeKey: null } });
        }
    }
}
