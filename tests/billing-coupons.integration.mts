import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { NextRequest, NextResponse } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/billing/coupon-policy.ts";
import { paidPeriodStart } from "../src/lib/billing/paid-period.ts";
import { resolveMercadoPagoWebhookPayment } from "../src/lib/billing/mercado-pago-runtime-helpers.ts";

// This test mutates ONLY a named disposable local database, never production or UI fixtures.
const url = process.argv.find(value => value.startsWith("--database-url="))?.slice(15);
if (!url) throw new Error("Pass --database-url for localhost/crm_coupons_test.");
const target = new URL(url);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/crm_coupons_test") throw new Error("Refusing non-local or non-test database.");
const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.control.config.ts"], { env: { ...process.env, CONTROL_DATABASE_URL: url }, encoding: "utf8" });
assert.equal(migration.status, 0, migration.stderr);
const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/control-plane");
const pool = new Pool({ connectionString: url });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const runtime = { environment: "test", applicationId: "coupon-test-app", accessToken: "fake", webhookSecret: "fake" };
const calls: Array<Record<string, unknown>> = [];
let providerFailure: unknown = null;
let configurationReads = 0, baseUrlReads = 0;
class ApiError extends Error { status = 400; }
const mp = {
    getMercadoPagoRuntimeConfiguration: async () => { configurationReads++; return runtime; },
    MercadoPagoApiError: ApiError,
    createMercadoPagoPreference: async (input: Record<string, unknown>) => {
        calls.push(input);
        if (providerFailure) throw providerFailure;
        return { id: `pref-${input.idempotencyKey}`, environment: "test", sandbox_init_point: "https://www.mercadopago.com.mx/checkout/test-coupon" };
    },
};
const module = loadTsModule("src/lib/billing/coupons.ts", {
    "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "./coupon-policy": policy,
    "./mercado-pago": mp, "./stripe": { getPlatformBaseUrl: () => { baseUrlReads++; return "https://crm.test"; } }, "./paid-period": { paidPeriodStart },
}, { Error });
type Input = { tenantId: string; tenantSlug: string; user: { id: string; email: string }; planSlug: string; code: unknown; amountCents: number; consent: boolean };
const redeem = module.redeemBillingCoupon as (input: Input) => Promise<{ url: string; free: boolean }>;
const preview = module.previewBillingCoupon as (tenant: string, code: string, plan: string) => Promise<{ amountCents: number; resume: boolean }>;
const create = module.createBillingCoupon as (input: unknown, user: string) => Promise<{ id: string; code: string }>;
const pause = module.setBillingCouponActive as (id: string, active: boolean, user: string) => Promise<void>;
const payments = new Map<string, Record<string, unknown>>();
const webhook = loadTsModule("src/app/api/webhooks/mercado-pago/route.ts", {
    "next/server": { NextRequest, NextResponse }, "@/generated/control-plane": {}, "@/lib/control-db": { getControlDb: () => db },
    "@/lib/billing/mercado-pago": { ...mp, MercadoPagoBillingConfigurationError: class extends Error {},
        getMercadoPagoWebhookRuntimeConfigurations: () => [runtime], verifyMercadoPagoWebhookSignature: () => true,
        getMercadoPagoPayment: async (id: string) => { if (!payments.has(id)) throw new Error("Unexpected payment"); return payments.get(id); } },
    "@/lib/billing/mercado-pago-runtime-helpers": { resolveMercadoPagoWebhookPayment },
    "@/lib/billing/paid-period": { paidPeriodStart },
    "@/lib/billing/mercado-pago-subscriptions": { reconcileRecurringPayment: async () => false },
    "@/lib/billing/mercado-pago-plan-changes": { reconcilePlanChangePayment: async () => false },
});
const post = webhook.POST as (request: NextRequest) => Promise<Response>;
const user = { id: "coupon-test-owner", email: "coupon-owner@example.invalid" };
const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
const input = (tenant: string, code: string, amountCents = 0): Input => ({ tenantId: tenant, tenantSlug: tenant, user, code, planSlug: "esencial", amountCents, consent: true });
async function tenant(id: string, days = 0) {
    await db.tenant.create({ data: { id, slug: id, displayName: "Disposable coupon test", status: "READY", provisioningStatus: "SUCCEEDED", billingStatus: days ? "TRIALING" : "UNPAID", accessMode: days ? "FULL" : "BILLING_ONLY" } });
    if (days) await db.trial.create({ data: { tenantId: id, startsAt: new Date(), endsAt: new Date(Date.now() + days * 86_400_000), durationDays: days } });
}
async function coupon(percent = 100, uses = 1, plans = ["esencial"]) {
    return create({ discountPercent: percent, maxUses: uses, expiresAt: expiry, allowedPlanSlugs: plans }, user.id);
}
async function notify(paymentId: string, id: string) {
    return post(new NextRequest(`https://crm.test/api/webhooks/mercado-pago?data.id=${paymentId}&type=payment`, {
        method: "POST", headers: { "x-signature": "test-only-mocked-signature", "x-request-id": id }, body: JSON.stringify({ id, type: "payment", data: { id: paymentId } }),
    }));
}

try {
    assert.equal(await db.tenant.count(), 0, "Use an empty disposable database.");
    await db.user.create({ data: { ...user, emailVerifiedAt: new Date() } });
    await db.plan.upsert({ where: { slug: "esencial" }, update: { isActive: true, monthlyAmountCents: 29900 }, create: { id: "coupon-plan", slug: "esencial", name: "Esencial", monthlyAmountCents: 29900, limits: { chatbotMessagesPerMonth: 1000 }, features: { chatbot: true } } });
    await db.plan.upsert({ where: { slug: "pro" }, update: { isActive: true, monthlyAmountCents: 79900 }, create: { id: "coupon-plan-pro", slug: "pro", name: "Elite", monthlyAmountCents: 79900 } });
    for (const days of [7, 14]) {
        const id = `trial-${days}`; await tenant(id, days);
        const before = await db.trial.findUnique({ where: { tenantId: id } });
        const c = await coupon();
        const body = input(id, c.code);
        await assert.rejects(redeem({ ...body, consent: false }), /Confirma/);
        const results = await Promise.all(Array.from({ length: 4 }, () => redeem(body)));
        assert.equal(results.every(result => result.free), true);
        const after = await db.trial.findUnique({ where: { tenantId: id } });
        assert.equal(after.endsAt.getTime(), before.endsAt.getTime()); assert.equal(after.durationDays, days); assert.equal(after.status, before.status);
        const sub = await db.subscription.findFirst({ where: { tenantId: id } });
        assert.equal(await db.subscription.count({ where: { tenantId: id } }), 1);
        assert.equal(sub.currentPeriodStartsAt.getTime(), before.endsAt.getTime());
        assert.ok(sub.currentPeriodEndsAt > sub.currentPeriodStartsAt);
        assert.equal(sub.cancelAtPeriodEnd, true);
        assert.equal((await db.tenant.findUnique({ where: { id } })).accessMode, "FULL");
        assert.equal(await db.billingCheckoutAttempt.count({ where: { tenantId: id } }), 0);
    }
    assert.equal(calls.length, 0, "Free coupons must not contact Mercado Pago.");
    assert.equal(configurationReads, 0); assert.equal(baseUrlReads, 0, "A free coupon uses an internal return path, not external checkout configuration.");
    console.log("PASS: 7/14-day trials preserved; free activation concurrent/idempotent; no provider/card/payment event.");

    const limited = await coupon();
    const competitors = ["last-a", "last-b", "last-c"];
    for (const id of competitors) await tenant(id);
    const race = await Promise.allSettled(competitors.map(id => redeem(input(id, limited.code))));
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await db.billingCouponRedemption.count({ where: { couponId: limited.id } }), 1);
    const winner = await db.billingCouponRedemption.findFirst({ where: { couponId: limited.id } });
    // Account erasure cannot replenish an already used coupon.
    await db.tenant.delete({ where: { id: winner.tenantId } });
    assert.equal(await db.billingCouponRedemption.count({ where: { couponId: limited.id } }), 1);
    console.log("PASS: actual PostgreSQL last-use race and retained anonymous use after tenant deletion.");

    await tenant("invalid"); const paused = await coupon();
    await pause(paused.id, false, user.id);
    await assert.rejects(redeem(input("invalid", paused.code)), /no aplica/);
    await pause(paused.id, true, user.id);
    await assert.rejects(redeem({ ...input("invalid", paused.code), planSlug: "pro" }), /no aplica/);
    await assert.rejects(redeem({ ...input("invalid", paused.code), amountCents: 1 }), /precio cambió/);
    await db.billingCoupon.update({ where: { id: paused.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(redeem(input("invalid", paused.code)), /no aplica/);
    await db.tenant.update({ where: { id: "invalid" }, data: { status: "SUSPENDED" } });
    const good = await coupon();
    await assert.rejects(redeem(input("invalid", good.code)), /estado actual/);
    assert.equal(await db.billingCouponRedemption.count({ where: { tenantId: "invalid" } }), 0);
    console.log("PASS: pause/expiry/plan/price tampering and administrative suspension fail without consuming a use.");

    await tenant("half-price", 14); const half = await coupon(50);
    assert.equal((await preview("half-price", half.code, "esencial")).amountCents, 14950);
    assert.equal(await db.billingCouponRedemption.count({ where: { couponId: half.id } }), 0, "Preview cannot reserve a slot.");
    const halfInput = input("half-price", half.code, 14950);
    const checkouts = await Promise.allSettled([redeem(halfInput), redeem(halfInput), redeem(halfInput)]);
    assert.ok(checkouts.some(result => result.status === "fulfilled"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].amountCents, 14950);
    assert.equal(await db.subscription.count({ where: { tenantId: "half-price" } }), 0, "Checkout URL does not grant access.");
    const reservation = await db.billingCouponRedemption.findUnique({ where: { activeKey: "half-price" }, include: { checkoutAttempt: true } });
    assert.equal((await redeem(halfInput)).url, "https://www.mercadopago.com.mx/checkout/test-coupon");
    assert.equal(calls.length, 1, "Resume must reuse the existing payment.");
    await db.plan.update({ where: { slug: "esencial" }, data: { monthlyAmountCents: 39900 } });
    payments.set("coupon-pay-1", { id: "coupon-pay-1", status: "approved", application_id: runtime.applicationId, external_reference: reservation.checkoutAttempt.externalReference,
        currency_id: "MXN", live_mode: false, transaction_amount: 149.5, date_approved: new Date().toISOString() });
    const results = await Promise.all([notify("coupon-pay-1", "event-a"), notify("coupon-pay-1", "event-b"), notify("coupon-pay-1", "event-c")]);
    assert.ok(results.every(response => response.ok));
    assert.equal(await db.subscription.count({ where: { tenantId: "half-price" } }), 1);
    const applied = await db.billingCouponRedemption.findUnique({ where: { id: reservation.id } });
    assert.equal(applied.status, "APPLIED"); assert.ok(applied.periodEndsAt);
    assert.equal(await db.commercialEvent.count({ where: { tenantId: "half-price", event: "checkout_completed" } }), 1);
    const trial = await db.trial.findUnique({ where: { tenantId: "half-price" } });
    assert.equal(applied.periodStartsAt.getTime(), trial.endsAt.getTime());
    assert.equal(trial.status, "ACTIVE");
    assert.equal(applied.originalCents, 29900, "A catalog update cannot alter the accepted promotional price.");
    assert.equal((await redeem(halfInput)).free, false, "A paid promotion must never become a free activation on replay.");
    await db.plan.update({ where: { slug: "esencial" }, data: { monthlyAmountCents: 29900 } });
    payments.get("coupon-pay-1")!.status = "refunded";
    assert.equal((await notify("coupon-pay-1", "event-refund")).status, 200);
    assert.equal((await db.subscription.findFirst({ where: { tenantId: "half-price" } })).status, "UNPAID");
    assert.equal((await db.tenant.findUnique({ where: { id: "half-price" } })).billingStatus, "TRIALING", "A refund cannot remove the remaining ordinary trial.");
    assert.equal((await db.billingCouponRedemption.findUnique({ where: { id: reservation.id } })).status, "APPLIED", "A refund does not replenish a promotion.");
    console.log("PASS: 50% uses $149.50; one checkout; no premature access; three real webhook transactions grant one month once.");

    await tenant("wrong-amount"); const wrong = await coupon(50);
    await redeem(input("wrong-amount", wrong.code, 14950));
    const badAttempt = await db.billingCheckoutAttempt.findFirst({ where: { tenantId: "wrong-amount" } });
    payments.set("wrong-payment", { id: "wrong-payment", status: "approved", application_id: runtime.applicationId, external_reference: badAttempt.externalReference,
        currency_id: "MXN", live_mode: false, transaction_amount: 1, date_approved: new Date().toISOString() });
    assert.equal((await notify("wrong-payment", "wrong-event")).status, 200);
    assert.equal(await db.subscription.count({ where: { tenantId: "wrong-amount" } }), 0);
    assert.equal((await db.billingCouponRedemption.findUnique({ where: { activeKey: "wrong-amount" } })).status, "RESERVED");
    console.log("PASS: accepted-price snapshot survives catalog changes; refund preserves trial; wrong-amount webhook cannot activate coupon.");

    await tenant("timeout"); const uncertain = await coupon(50);
    providerFailure = new Error("simulated timeout after possible provider creation");
    await assert.rejects(redeem(input("timeout", uncertain.code, 14950)), /No se confirmó/);
    const beforeCalls = calls.length;
    providerFailure = null;
    await assert.rejects(redeem(input("timeout", uncertain.code, 14950)), /revisión/);
    assert.equal(calls.length, beforeCalls);
    assert.equal(await db.billingCouponRedemption.count({ where: { couponId: uncertain.id, status: "RESERVED" } }), 1);
    await tenant("rejected"); const rejected = await coupon(50);
    providerFailure = new ApiError("invalid request");
    await assert.rejects(redeem(input("rejected", rejected.code, 14950)), /No se confirmó/);
    assert.equal(await db.billingCouponRedemption.count({ where: { couponId: rejected.id, status: "FAILED", activeKey: null } }), 1);
    assert.equal(await db.subscription.count({ where: { tenantId: "rejected" } }), 0);
    console.log("PASS: uncertain provider response retains a slot and forbids duplicate POST; definitive rejection releases slot without access.");
    console.log("Billing coupon integration: all scenarios passed. Provider I/O mocked; no real payment was made.");
} finally {
    // Empty only this explicitly named disposable database, preserving migration metadata.
    await db.billingCouponRedemption.deleteMany(); await db.billingCoupon.deleteMany();
    await db.billingCheckoutAttempt.deleteMany(); await db.commercialEvent.deleteMany(); await db.billingEvent.deleteMany();
    await db.auditLog.deleteMany(); await db.subscription.deleteMany(); await db.trial.deleteMany();
    await db.tenant.deleteMany(); await db.plan.deleteMany(); await db.user.deleteMany();
    await db.$disconnect(); await pool.end();
}
