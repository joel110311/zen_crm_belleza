import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { addMonths } from "date-fns";
import type { Prisma } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { assertCouponAvailable, couponCode, CouponError, discountedCents, validateCouponInput } from "./coupon-policy";
import { createMercadoPagoPreference, getMercadoPagoRuntimeConfiguration, MercadoPagoApiError } from "./mercado-pago";
import { getPlatformBaseUrl } from "./stripe";
import { paidPeriodStart } from "./paid-period";

export { CouponError } from "./coupon-policy";

export async function listBillingCoupons() {
    const db = getControlDb();
    const rows = await db.billingCoupon.findMany({ orderBy: { createdAt: "desc" }, take: 200,
        include: { _count: { select: { redemptions: { where: { status: { not: "FAILED" } } } } } } });
    const applied = rows.length ? await db.billingCouponRedemption.groupBy({ by: ["couponId"], where: { couponId: { in: rows.map(row => row.id) }, status: "APPLIED" }, _count: { _all: true } }) : [];
    const counts = new Map(applied.map(row => [row.couponId, row._count._all]));
    return rows.map(({ _count, ...coupon }) => ({ ...coupon, reservedUses: _count.redemptions, appliedUses: counts.get(coupon.id) || 0 }));
}

export async function createBillingCoupon(body: Record<string, unknown>, userId: string) {
    const db = getControlDb();
    const plans = await db.plan.findMany({ where: { isActive: true, monthlyAmountCents: { gt: 0 }, currency: "MXN" }, select: { slug: true } });
    const input = validateCouponInput(body, plans.map(p => p.slug));
    // Generated codes are deliberately unguessable; admin never chooses a short public code.
    const code = `ZEN-${input.discountPercent}-${randomBytes(6).toString("hex").toUpperCase()}`;
    return db.$transaction(async tx => {
        const coupon = await tx.billingCoupon.create({ data: { ...input, code, createdByUserId: userId } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "billing_coupon.created", resourceType: "BillingCoupon", resourceId: coupon.id,
            metadata: { discountPercent: input.discountPercent, maxUses: input.maxUses, allowedPlanSlugs: input.allowedPlanSlugs, expiresAt: input.expiresAt.toISOString() } } });
        return coupon;
    });
}

export async function setBillingCouponActive(id: string, active: boolean, userId: string) {
    return getControlDb().$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "BillingCoupon" WHERE id = ${id} FOR UPDATE`;
        if (!await tx.billingCoupon.findUnique({ where: { id } })) throw new CouponError("No se encontró ese cupón.", 404);
        await tx.billingCoupon.update({ where: { id }, data: { active } });
        await tx.auditLog.create({ data: { actorUserId: userId, action: "billing_coupon.updated", resourceType: "BillingCoupon", resourceId: id, metadata: { active } } });
    });
}

async function eligibleTenant(tx: Prisma.TransactionClient, tenantId: string) {
    const now = new Date();
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, accessMode: true } });
    if (!tenant || tenant.status !== "READY" || tenant.accessMode === "SUSPENDED") throw new CouponError("Este negocio no puede activar una promoción en su estado actual.");
    if (await tx.mercadoPagoAgreement.findUnique({ where: { activeKey: tenantId } })) throw new CouponError("Administra o cancela la autorización automática existente antes de usar un cupón.");
    if (await tx.subscription.findFirst({ where: { tenantId, status: { in: ["ACTIVE", "TRIALING", "CANCELED", "PAUSED", "PAST_DUE"] }, OR: [{ currentPeriodEndsAt: { gt: now } }, { currentPeriodEndsAt: null }] } })) {
        throw new CouponError("Ya tienes un periodo de plan vigente. Espera a que termine antes de aplicar una promoción.");
    }
    if (await tx.billingCheckoutAttempt.findFirst({ where: { tenantId, status: { in: ["CREATED", "PENDING"] }, createdAt: { gt: new Date(Date.now() - 48 * 3_600_000) } } })) {
        throw new CouponError("Hay un pago pendiente. Revisa su estado antes de aplicar una promoción.");
    }
}

async function quote(tx: Prisma.TransactionClient, code: string, planSlug: string) {
    const [coupon, plan] = await Promise.all([
        tx.billingCoupon.findUnique({ where: { code } }),
        tx.plan.findFirst({ where: { slug: planSlug, isActive: true, currency: "MXN", monthlyAmountCents: { gt: 0 } } }),
    ]);
    if (!plan?.monthlyAmountCents) throw new CouponError("Selecciona un plan mensual disponible.");
    const reservedUses = coupon ? await tx.billingCouponRedemption.count({ where: { couponId: coupon.id, status: { not: "FAILED" } } }) : 0;
    assertCouponAvailable(coupon, planSlug, reservedUses);
    return { coupon: coupon!, plan, amountCents: discountedCents(plan.monthlyAmountCents, coupon!.discountPercent) };
}

export async function previewBillingCoupon(tenantId: string, rawCode: unknown, planSlug: string) {
    const db = getControlDb();
    const code = couponCode(rawCode);
    const previous = await db.billingCouponRedemption.findUnique({ where: { activeKey: tenantId }, include: { coupon: true } });
    if (previous) {
        if (previous.status === "RESERVED" && previous.coupon.code === code && previous.planId && previous.checkoutUrl) {
            const plan = await db.plan.findUnique({ where: { id: previous.planId } });
            if (plan?.slug === planSlug) return { code, discountPercent: previous.discountPercent, originalCents: previous.originalCents, amountCents: previous.amountCents, currency: previous.currency, resume: true };
        }
        throw new CouponError(previous.status === "APPLIED" || previous.checkoutAttemptId ? "Este negocio ya utilizó una promoción o tiene un pago promocional en revisión." : "Hay una promoción en revisión. Actualiza su estado antes de continuar.");
    }
    await eligibleTenant(db, tenantId);
    const value = await quote(db, code, planSlug);
    return { code, discountPercent: value.coupon.discountPercent, originalCents: value.plan.monthlyAmountCents!, amountCents: value.amountCents, currency: value.plan.currency, resume: false };
}

/** One tenant lock followed by one coupon lock protects the last use and double clicks. */
export async function redeemBillingCoupon(input: { tenantId: string; tenantSlug: string; user: { id: string; email: string }; planSlug: string; code: unknown; amountCents: unknown; consent: unknown }) {
    if (input.consent !== true) throw new CouponError("Confirma el importe y la duración de la promoción.", 400);
    const code = couponCode(input.code);
    const db = getControlDb();
    const billingUrl = `/billing/${encodeURIComponent(input.tenantSlug)}`;
    const configuredCoupon = await db.billingCoupon.findUnique({ where: { code } });
    const providerRuntime = configuredCoupon?.discountPercent === 50 ? await getMercadoPagoRuntimeConfiguration() : null;
    const providerBaseUrl = providerRuntime ? getPlatformBaseUrl() : null;
    const reservation = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${input.tenantId} FOR UPDATE`;
        const previous = await tx.billingCouponRedemption.findUnique({ where: { activeKey: input.tenantId }, include: { coupon: true } });
        if (previous) {
            if (previous.coupon.code !== code || previous.amountCents !== input.amountCents || (await tx.plan.findUnique({ where: { id: previous.planId } }))?.slug !== input.planSlug) throw new CouponError("Ya hay otra promoción aplicada o en revisión para este negocio.");
            if (previous.status === "APPLIED") return { url: `${billingUrl}?checkout=${previous.amountCents === 0 ? "coupon" : "success"}`, free: previous.amountCents === 0 };
            if (previous.checkoutUrl) return { url: previous.checkoutUrl, free: false };
            throw new CouponError("La creación del pago está en revisión. No generaremos un segundo cobro; soporte puede revisar el intento.");
        }
        await eligibleTenant(tx, input.tenantId);
        await tx.$queryRaw`SELECT id FROM "BillingCoupon" WHERE code = ${code} FOR UPDATE`;
        const value = await quote(tx, code, input.planSlug);
        if (input.amountCents !== value.amountCents) throw new CouponError("El precio cambió. Vuelve a aplicar el cupón para revisar el importe vigente.");
        // Resolve provider configuration before consuming a paid slot. A 100% coupon needs no card/provider.
        const runtime = value.amountCents > 0 ? providerRuntime : null;
        if (value.amountCents > 0 && !runtime) throw new CouponError("La facturación no está disponible.", 503);
        const id = randomUUID();
        const attemptId = value.amountCents > 0 ? randomUUID() : null;
        if (attemptId) await tx.billingCheckoutAttempt.create({ data: { id: attemptId, tenantId: input.tenantId, planId: value.plan.id,
            provider: "MERCADO_PAGO", externalReference: `sl_${attemptId.replaceAll("-", "")}`, amountCents: value.amountCents, currency: value.plan.currency } });
        const trial = await tx.trial.findUnique({ where: { tenantId: input.tenantId } });
        const startsAt = paidPeriodStart(new Date(), [trial && ["ACTIVE", "ENDING"].includes(trial.status) ? trial.endsAt : null]);
        const endsAt = addMonths(startsAt, 1);
        const redemption = await tx.billingCouponRedemption.create({ data: { id, couponId: value.coupon.id, tenantId: input.tenantId, activeKey: input.tenantId,
            planId: value.plan.id, originalCents: value.plan.monthlyAmountCents!, amountCents: value.amountCents, discountPercent: value.coupon.discountPercent,
            currency: value.plan.currency, checkoutAttemptId: attemptId, ...(attemptId ? {} : { status: "APPLIED", periodStartsAt: startsAt, periodEndsAt: endsAt }) } });
        if (!attemptId) {
            await tx.subscription.create({ data: { tenantId: input.tenantId, planId: value.plan.id, provider: "MERCADO_PAGO", providerSubscriptionId: `sl_coupon_${id}`,
                status: "ACTIVE", currentPeriodStartsAt: startsAt, currentPeriodEndsAt: endsAt, cancelAtPeriodEnd: true } });
            // Do not shorten or convert the ordinary trial; both dates remain visible and unchanged.
            await tx.tenant.updateMany({ where: { id: input.tenantId, status: "READY", accessMode: { not: "SUSPENDED" } }, data: { billingStatus: "ACTIVE", accessMode: "FULL" } });
        }
        await tx.auditLog.create({ data: { tenantId: input.tenantId, actorUserId: input.user.id, action: attemptId ? "billing_coupon.reserved" : "billing_coupon.applied", resourceType: "BillingCouponRedemption", resourceId: id,
            metadata: { couponId: value.coupon.id, planId: value.plan.id, amountCents: value.amountCents, discountPercent: value.coupon.discountPercent, months: 1, consentVersion: "coupon-month-v1" } } });
        return { redemption, plan: value.plan, runtime, url: attemptId ? null : `${billingUrl}?checkout=coupon`, free: !attemptId };
    });
    if (reservation.url) return { url: reservation.url, free: reservation.free };
    if (!reservation.redemption?.checkoutAttemptId || !reservation.runtime) throw new CouponError("No se pudo preparar el pago.");
    const { redemption, plan, runtime } = reservation;
    const attemptId = redemption.checkoutAttemptId!;
    try {
        const preference = await createMercadoPagoPreference({ idempotencyKey: attemptId, externalReference: `sl_${attemptId.replaceAll("-", "")}`,
            title: `SynapseLogik ${plan.name} · primer mes con ${redemption.discountPercent}%`, description: "Un mes promocional, sin renovación automática. Después se contrata al precio normal.",
            amountCents: redemption.amountCents, currency: redemption.currency, payerEmail: input.user.email,
            successUrl: `${providerBaseUrl}${billingUrl}?checkout=success`, pendingUrl: `${providerBaseUrl}${billingUrl}?checkout=pending`, failureUrl: `${providerBaseUrl}${billingUrl}?checkout=failure`,
            notificationUrl: `${providerBaseUrl}/api/webhooks/mercado-pago`, tenantId: input.tenantId, planId: plan.id, runtime });
        const url = preference.environment === "production" ? preference.init_point : preference.sandbox_init_point || preference.init_point;
        if (!url) throw new Error("Missing checkout URL");
        await db.$transaction([
            db.billingCheckoutAttempt.update({ where: { id: attemptId }, data: { providerCheckoutId: preference.id } }),
            db.billingCouponRedemption.update({ where: { id: redemption.id }, data: { checkoutUrl: url, lastError: null } }),
        ]);
        return { url, free: false };
    } catch (error) {
        const rejected = error instanceof MercadoPagoApiError && [400, 401, 403, 422].includes(error.status);
        await db.$transaction([
            db.billingCouponRedemption.update({ where: { id: redemption.id }, data: { lastError: "No se confirmó la creación del pago. Requiere revisión antes de reintentar.", ...(rejected ? { status: "FAILED", activeKey: null } : {}) } }),
            db.billingCheckoutAttempt.update({ where: { id: attemptId }, data: { lastError: "No se confirmó la creación del pago promocional.", ...(rejected ? { status: "REJECTED" } : {}) } }),
        ]);
        throw new CouponError("No se confirmó el pago promocional. No se activó el plan; revisa el estado o contacta a soporte.", 503);
    }
}
