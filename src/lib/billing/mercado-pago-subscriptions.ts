import "server-only";
import { randomUUID } from "node:crypto";
import { addMonths } from "date-fns";
import type { Prisma, MercadoPagoAgreement } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { getPlatformBaseUrl } from "@/lib/billing/stripe";
import {
    cancelMercadoPagoPreapproval, createMercadoPagoPreapproval, getMercadoPagoAgreementRuntime,
    getMercadoPagoInvoice, getMercadoPagoPayment, getMercadoPagoPreapproval, getMercadoPagoRuntimeConfiguration,
    isMercadoPagoSubscriptionsEnabled, searchMercadoPagoInvoices, searchMercadoPagoPreapprovals,
    MercadoPagoApiError,
    type MercadoPagoInvoice, type MercadoPagoPayment, type MercadoPagoPreapproval, type MercadoPagoRuntimeConfiguration,
} from "./mercado-pago";
import { agreementIdentityError, agreementValidationError, hostedSubscriptionUrl, providerAmountCents, providerDate, RECURRING_CONSENT_VERSION, RecurringBillingError } from "./recurring-policy";
import { recurringCyclePrice, recoverRecurringPlanChanges } from "./mercado-pago-plan-changes";
import { paidPeriodStart } from "./paid-period";

export { RecurringBillingError } from "./recurring-policy";

async function lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
}

/** Recalculate from paid periods, not authorization or a browser redirect. Never unsuspend a tenant. */
async function refreshAccess(tx: Prisma.TransactionClient, tenantId: string) {
    const now = new Date();
    const [paid, trial, grace] = await Promise.all([
        tx.subscription.findFirst({ where: { tenantId, status: { in: ["ACTIVE", "PAST_DUE", "CANCELED", "PAUSED"] }, currentPeriodEndsAt: { gt: now } } }),
        tx.trial.findFirst({ where: { tenantId, status: { in: ["ACTIVE", "ENDING"] }, endsAt: { gt: now } } }),
        tx.subscription.findFirst({ where: { tenantId, status: "PAST_DUE", graceEndsAt: { gt: now } } }),
    ]);
    await tx.tenant.updateMany({ where: { id: tenantId, status: { notIn: ["SUSPENDED", "ARCHIVED"] }, accessMode: { not: "SUSPENDED" } }, data: paid
        ? { billingStatus: "ACTIVE", accessMode: "FULL" }
        : trial ? { billingStatus: "TRIALING", accessMode: "FULL" }
        : grace ? { billingStatus: "PAST_DUE", accessMode: "READ_ONLY" }
        : { billingStatus: "UNPAID", accessMode: "BILLING_ONLY" } });
}

export async function startRecurringSubscription(input: {
    tenantId: string; tenantSlug: string; userId: string; email: string; planSlug: string; consent: unknown; consentVersion: unknown; amountCents: unknown; currency: unknown;
}) {
    if (!isMercadoPagoSubscriptionsEnabled()) throw new RecurringBillingError("Las suscripciones automáticas aún no están habilitadas.", 503);
    if ((process.env.BILLING_RECONCILIATION_SECRET || "").length < 32) throw new RecurringBillingError("Falta configurar la recuperación segura de suscripciones.", 503);
    if (input.consent !== true || input.consentVersion !== RECURRING_CONSENT_VERSION) throw new RecurringBillingError("Debes aceptar expresamente la renovación mensual automática.", 400);
    const runtime = await getMercadoPagoRuntimeConfiguration();
    const db = getControlDb();
    const reservation = await db.$transaction(async (tx) => {
        await lockTenant(tx, input.tenantId);
        const existing = await tx.mercadoPagoAgreement.findUnique({ where: { activeKey: input.tenantId } });
        if (existing) {
            if (existing.environment !== runtime.environment) throw new RecurringBillingError("Ya hay una suscripción en otro entorno. Revísala antes de continuar.");
            const plan = await tx.plan.findUnique({ where: { id: existing.planId } });
            if (plan?.slug !== input.planSlug) throw new RecurringBillingError("Cancela la renovación actual antes de contratar otro plan.");
            if (existing.status === "PENDING" && existing.checkoutUrl && !existing.cancelRequestedAt) {
                if (input.amountCents !== existing.amountCents || input.currency !== existing.currency) throw new RecurringBillingError("La autorización pendiente tiene otro importe. Revísala o cancélala antes de continuar.");
                return { agreement: existing, title: plan.name, reused: true };
            }
            throw new RecurringBillingError("Ya existe una suscripción o una autorización en revisión. Actualiza su estado desde Administrar suscripción.");
        }
        const plan = await tx.plan.findFirst({ where: { slug: input.planSlug, isActive: true, monthlyAmountCents: { gt: 0 } } });
        if (!plan?.monthlyAmountCents || plan.currency !== "MXN") throw new RecurringBillingError("Este plan no está disponible para suscripción mensual.");
        if (input.amountCents !== plan.monthlyAmountCents || input.currency !== plan.currency) throw new RecurringBillingError("El precio cambió. Actualiza la página y acepta el importe vigente antes de continuar.");
        const [trial, paid, pendingCheckout] = await Promise.all([
            tx.trial.findUnique({ where: { tenantId: input.tenantId } }),
            tx.subscription.findFirst({ where: { tenantId: input.tenantId, status: "ACTIVE", currentPeriodEndsAt: { gt: new Date() } }, orderBy: { currentPeriodEndsAt: "desc" } }),
            tx.billingCheckoutAttempt.findFirst({ where: { tenantId: input.tenantId, recurringAgreementId: null, status: { in: ["CREATED", "PENDING"] }, createdAt: { gt: new Date(Date.now() - 48 * 3_600_000) } } }),
        ]);
        if (pendingCheckout) throw new RecurringBillingError("Hay un pago individual pendiente. Confírmalo o espera a que expire antes de activar la renovación.");
        const startsAt = paidPeriodStart(new Date(Date.now() + 5 * 60_000), [trial && ["ACTIVE", "ENDING"].includes(trial.status) ? trial.endsAt : null, paid?.currentPeriodEndsAt]);
        const id = randomUUID();
        const agreement = await tx.mercadoPagoAgreement.create({ data: {
            id, tenantId: input.tenantId, planId: plan.id, activeKey: input.tenantId, externalReference: `sl_sub_${id.replaceAll("-", "")}`,
            environment: runtime.environment, applicationId: runtime.applicationId, amountCents: plan.monthlyAmountCents, currency: plan.currency,
            initialPlanId: plan.id, initialAmountCents: plan.monthlyAmountCents,
            startsAt, consentAt: new Date(), consentUserId: input.userId, consentVersion: RECURRING_CONSENT_VERSION,
        } });
        return { agreement, title: plan.name, reused: false };
    });
    if (reservation.reused) return reservation.agreement.checkoutUrl!;
    const { agreement } = reservation;
    try {
        const resource = await createMercadoPagoPreapproval(runtime, {
            externalReference: agreement.externalReference, title: `SynapseLogik ${reservation.title} · suscripción mensual`, payerEmail: input.email,
            amountCents: agreement.amountCents, currency: agreement.currency, startsAt: agreement.startsAt,
            backUrl: `${getPlatformBaseUrl()}/billing/${encodeURIComponent(input.tenantSlug)}?checkout=subscription`,
        });
        await reconcileRecurringAgreement(resource, runtime);
        const url = hostedSubscriptionUrl(resource.init_point, resource.id);
        if (!url) throw new Error("Mercado Pago no devolvió una URL mexicana de autorización válida.");
        return url;
    } catch (error) {
        // A timeout can happen AFTER Mercado Pago creates the agreement. Never issue another POST blindly.
        await db.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { lastError: "No se confirmó la creación. Actualiza el estado; no iniciaremos una segunda suscripción." } });
        if (error instanceof MercadoPagoApiError && [400, 401, 403, 422].includes(error.status)) {
            await db.mercadoPagoAgreement.updateMany({ where: { id: agreement.id, status: "CREATING", providerSubscriptionId: null }, data: { activeKey: null, status: "FAILED", lastError: "Mercado Pago rechazó la solicitud sin crear una suscripción. Soporte debe revisar la configuración." } });
        }
        throw error;
    }
}

export async function reconcileRecurringAgreement(resource: MercadoPagoPreapproval, runtime: MercadoPagoRuntimeConfiguration) {
    const db = getControlDb();
    let agreement = await db.mercadoPagoAgreement.findUnique({ where: { externalReference: String(resource.external_reference) } });
    if (!agreement || agreement.environment !== runtime.environment) return;
    if (agreement.applicationId !== runtime.applicationId) throw new Error("Las credenciales no pertenecen a la aplicación original.");
    if (resource.status === "authorized" && providerAmountCents(resource.auto_recurring?.transaction_amount) !== agreement.amountCents) {
        await recoverRecurringPlanChanges(agreement.id);
        agreement = await db.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    }
    // Always allow a verified cancellation, even if somebody changed the price in Mercado Pago.
    const validation = resource.status === "canceled" ? agreementIdentityError(agreement, resource) : agreementValidationError(agreement, resource);
    if (validation) throw new Error(validation);
    const mapped = ({ pending: "PENDING", authorized: "AUTHORIZED", paused: "PAUSED", canceled: "CANCELED" } as Record<string, string>)[resource.status || ""];
    if (!mapped) throw new Error("Estado de suscripción no reconocido.");
    await db.$transaction(async (tx) => {
        await lockTenant(tx, agreement.tenantId);
        const current = await tx.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
        const modifiedAt = providerDate(resource.last_modified);
        if (current.status === "CANCELED" || (modifiedAt && current.providerModifiedAt && modifiedAt < current.providerModifiedAt)) return;
        await tx.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: {
            providerSubscriptionId: resource.id, status: mapped, checkoutUrl: hostedSubscriptionUrl(resource.init_point, resource.id),
            nextPaymentAt: providerDate(resource.next_payment_date), providerModifiedAt: modifiedAt,
            reconciledAt: new Date(), lastError: null,
            ...(mapped === "CANCELED" ? { activeKey: null, canceledAt: new Date() } : {}),
        } });
        if (mapped === "CANCELED" || mapped === "PAUSED") {
            // Stopping future debits does not revoke already paid access.
            await tx.subscription.updateMany({ where: { tenantId: agreement.tenantId, provider: "MERCADO_PAGO", providerSubscriptionId: resource.id }, data: { cancelAtPeriodEnd: true, canceledAt: mapped === "CANCELED" ? new Date() : null } });
        }
    });
}

export async function reconcileRecurringInvoice(invoice: MercadoPagoInvoice, runtime: MercadoPagoRuntimeConfiguration) {
    const db = getControlDb();
    if (!invoice.preapproval_id) return;
    const agreement = await db.mercadoPagoAgreement.findUnique({ where: { providerSubscriptionId: invoice.preapproval_id } });
    if (!agreement || agreement.environment !== runtime.environment || agreement.applicationId !== runtime.applicationId) return;
    if (invoice.external_reference != null && String(invoice.external_reference) !== agreement.externalReference) throw new Error("La referencia del ciclo no coincide.");
    if (!invoice.payment?.id) return; // scheduled, without an actual debit, never grants access
    const debitAt = providerDate(invoice.debit_date);
    if (!debitAt || debitAt < new Date(agreement.startsAt.getTime() - 60_000) || debitAt > new Date(Date.now() + 60_000)) throw new Error("Fecha de cobro recurrente no válida.");
    const cycle = await recurringCyclePrice(agreement, debitAt);
    if (invoice.currency_id !== agreement.currency || providerAmountCents(invoice.transaction_amount) !== cycle.amountCents) throw new Error("El importe del ciclo no coincide.");
    const recorded = await db.billingCheckoutAttempt.findUnique({ where: { providerInvoiceId: String(invoice.id) } });
    if (recorded?.status === "APPROVED" && invoice.payment.status === "approved" && recorded.providerPaymentId === String(invoice.payment.id)) return;
    const payment = await getMercadoPagoPayment(String(invoice.payment.id), runtime);
    if (String(payment.id) !== String(invoice.payment.id) || payment.live_mode !== (runtime.environment === "production")
        || String(payment.application_id) !== agreement.applicationId || payment.currency_id !== agreement.currency
        || providerAmountCents(payment.transaction_amount) !== cycle.amountCents
        || (payment.external_reference && payment.external_reference !== agreement.externalReference)) throw new Error("El pago recurrente no coincide con la autorización.");
    const periodEndsAt = addMonths(debitAt, 1);
    await db.$transaction(async (tx) => {
        await lockTenant(tx, agreement.tenantId);
        const current = await tx.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
        const attempt = await tx.billingCheckoutAttempt.upsert({ where: { providerInvoiceId: String(invoice.id) }, create: {
            tenantId: agreement.tenantId, planId: cycle.planId, provider: "MERCADO_PAGO", externalReference: `sl_cycle_${invoice.id}`,
            recurringAgreementId: agreement.id, providerInvoiceId: String(invoice.id), amountCents: cycle.amountCents, currency: agreement.currency,
        }, update: {} });
        if (attempt.recurringAgreementId !== agreement.id) throw new Error("El ciclo pertenece a otra suscripción.");
        const subWhere = { providerSubscriptionId: invoice.preapproval_id! };
        const existing = await tx.subscription.findUnique({ where: subWhere });
        if (payment.status === "approved") {
            if (attempt.paidAt) return; // invoice, not webhook ID, is the idempotency key
            const paidAt = providerDate(payment.date_approved);
            if (!paidAt) throw new Error("Falta la fecha de aprobación del pago.");
            await tx.billingCheckoutAttempt.update({ where: { id: attempt.id }, data: { status: "APPROVED", providerPaymentId: String(payment.id), paidAt, periodStartsAt: debitAt, periodEndsAt, lastProviderStatus: payment.status, lastError: null } });
            if (!existing || !existing.currentPeriodEndsAt || periodEndsAt > existing.currentPeriodEndsAt) {
                const data = { planId: cycle.planId, status: "ACTIVE" as const, currentPeriodStartsAt: debitAt, currentPeriodEndsAt: periodEndsAt,
                    cancelAtPeriodEnd: current.status === "CANCELED" || current.status === "PAUSED" || Boolean(current.cancelRequestedAt), pastDueAt: null, graceEndsAt: null };
                await tx.subscription.upsert({ where: subWhere, create: { ...data, tenantId: agreement.tenantId, provider: "MERCADO_PAGO", providerSubscriptionId: invoice.preapproval_id }, update: data });
            }
            await tx.trial.updateMany({ where: { tenantId: agreement.tenantId, status: { in: ["ACTIVE", "ENDING", "EXPIRED"] } }, data: { status: "CONVERTED", convertedAt: paidAt } });
            await tx.commercialEvent.create({ data: { tenantId: agreement.tenantId, event: "subscription_payment_approved", source: "mercado_pago", metadata: { agreementId: agreement.id, invoiceId: String(invoice.id), paymentId: String(payment.id) } } });
            await tx.mercadoPagoPlanChange.updateMany({ where: { agreementId: agreement.id, status: "APPLIED", effectiveAt: { lte: new Date(debitAt.getTime() + 1000) } }, data: { activeKey: null } });
        } else if (payment.status === "refunded" || payment.status === "charged_back") {
            await tx.billingCheckoutAttempt.update({ where: { id: attempt.id }, data: { status: payment.status === "refunded" ? "REFUNDED" : "CHARGED_BACK", lastProviderStatus: payment.status } });
            const remaining = await tx.billingCheckoutAttempt.findFirst({ where: { recurringAgreementId: agreement.id, providerInvoiceId: { not: null }, status: "APPROVED" }, orderBy: { periodEndsAt: "desc" } });
            if (existing) await tx.subscription.update({ where: subWhere, data: { currentPeriodStartsAt: remaining?.periodStartsAt || null, currentPeriodEndsAt: remaining?.periodEndsAt || null, status: remaining?.periodEndsAt && remaining.periodEndsAt > new Date() ? "ACTIVE" : "UNPAID", graceEndsAt: null } });
        } else {
            // Late failed retries cannot downgrade an already approved cycle or a newer paid period.
            if (attempt.paidAt) return;
            await tx.billingCheckoutAttempt.update({ where: { id: attempt.id }, data: { status: payment.status === "rejected" ? "REJECTED" : "PENDING", lastProviderStatus: payment.status, lastError: payment.status_detail || null } });
            if (payment.status === "rejected" && (!existing?.currentPeriodEndsAt || existing.currentPeriodEndsAt <= debitAt)) {
                const policy = await tx.trialPolicy.findFirst({ where: { isDefault: true, isActive: true }, select: { graceDays: true } });
                const graceEndsAt = existing?.graceEndsAt || new Date(debitAt.getTime() + (policy?.graceDays ?? 3) * 86_400_000);
                const data = { status: "PAST_DUE" as const, pastDueAt: existing?.pastDueAt || debitAt, graceEndsAt };
                await tx.subscription.upsert({ where: subWhere, create: { ...data, tenantId: agreement.tenantId, planId: cycle.planId, provider: "MERCADO_PAGO", providerSubscriptionId: invoice.preapproval_id }, update: data });
            }
        }
        await refreshAccess(tx, agreement.tenantId);
    });
}

/** Resolve a payment topic to its invoice; never treat repeated monthly payments as one checkout. */
export async function reconcileRecurringPayment(payment: MercadoPagoPayment, runtime: MercadoPagoRuntimeConfiguration) {
    if (!payment.external_reference) return false;
    const agreement = await getControlDb().mercadoPagoAgreement.findUnique({ where: { externalReference: payment.external_reference } });
    if (!agreement) return false;
    if (agreement.environment !== runtime.environment) throw new Error("El entorno de la suscripción no coincide.");
    const { results = [] } = await searchMercadoPagoInvoices({ payment_id: String(payment.id) }, runtime);
    const matching = results.find((item) => item.preapproval_id === agreement.providerSubscriptionId && String(item.payment?.id) === String(payment.id));
    if (!matching) throw new Error("El pago aún no está vinculado a un ciclo verificable; se reintentará.");
    await reconcileRecurringInvoice(await getMercadoPagoInvoice(String(matching.id), runtime), runtime);
    return true;
}

/** Bounded reconciliation also recovers uncertain creations and missing webhook deliveries. */
export async function synchronizeRecurringAgreement(agreement: MercadoPagoAgreement) {
    await recoverRecurringPlanChanges(agreement.id);
    agreement = await getControlDb().mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    const runtime = getMercadoPagoAgreementRuntime(agreement.environment, agreement.applicationId);
    let resource: MercadoPagoPreapproval | undefined;
    if (agreement.providerSubscriptionId) resource = await getMercadoPagoPreapproval(agreement.providerSubscriptionId, runtime);
    else {
        const search = await searchMercadoPagoPreapprovals(agreement.externalReference, runtime);
        const matches = (search.results || []).filter((item) => String(item.external_reference) === agreement.externalReference);
        if (matches.length !== 1) throw new RecurringBillingError("La creación sigue pendiente de verificación. Soporte debe revisarla; no generaremos otro cobro.");
        resource = matches[0];
    }
    if (agreement.cancelRequestedAt && resource.status !== "canceled") resource = await cancelMercadoPagoPreapproval(resource.id, runtime);
    await reconcileRecurringAgreement(resource, runtime);
    const offset = agreement.reconciliationOffset;
    const { results = [], paging } = await searchMercadoPagoInvoices({ preapproval_id: resource.id, offset, limit: 3 }, runtime);
    for (const invoice of results) await reconcileRecurringInvoice(await getMercadoPagoInvoice(String(invoice.id), runtime), runtime);
    const nextOffset = results.length < 3 || (paging?.total != null && offset + results.length >= paging.total) ? 0 : offset + results.length;
    await getControlDb().mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { reconciledAt: new Date(), lastError: null, reconciliationOffset: nextOffset } });
}

export async function cancelRecurringSubscription(tenantId: string, userId: string) {
    const db = getControlDb();
    let agreement = await db.mercadoPagoAgreement.findUnique({ where: { activeKey: tenantId } });
    if (!agreement) return; // already canceled
    if (!agreement.providerSubscriptionId) {
        await synchronizeRecurringAgreement(agreement);
        agreement = await db.mercadoPagoAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    }
    if (!agreement.providerSubscriptionId) throw new RecurringBillingError("No se puede confirmar la cancelación todavía.");
    await db.mercadoPagoAgreement.update({ where: { id: agreement.id }, data: { cancelRequestedAt: new Date() } });
    const runtime = getMercadoPagoAgreementRuntime(agreement.environment, agreement.applicationId);
    // Keep the reservation on network failure. Never report a cancellation that wasn't confirmed.
    const resource = await cancelMercadoPagoPreapproval(agreement.providerSubscriptionId, runtime);
    if (resource.status !== "canceled") throw new RecurringBillingError("Mercado Pago aún no confirmó la cancelación.");
    await reconcileRecurringAgreement(resource, runtime);
    await db.commercialEvent.create({ data: { tenantId, userId, event: "subscription_renewal_canceled", source: "billing_page", metadata: { agreementId: agreement.id } } });
}
