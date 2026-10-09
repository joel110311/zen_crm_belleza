import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/billing/recurring-policy.ts";
import { paidPeriodStart } from "../src/lib/billing/paid-period.ts";
import * as changePolicy from "../src/lib/billing/plan-change-policy.ts";

// Deliberately excluded from npm test. Only an explicitly named disposable LOCAL database is allowed.
const url = process.argv.find(value => value.startsWith("--database-url="))?.slice(15);
if (!url) throw new Error("Supply --database-url pointing to disposable localhost/crm_recurring_test.");
const target = new URL(url);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/crm_recurring_test") throw new Error("Refusing a non-local or non-test database.");
const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.control.config.ts"], { env: { ...process.env, CONTROL_DATABASE_URL: url }, encoding: "utf8" });
assert.equal(migration.status, 0, migration.stderr);
const require = createRequire(import.meta.url);
const { PrismaClient } = require("../src/generated/control-plane");
const pool = new Pool({ connectionString: url });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const runtime = { environment: "production", applicationId: "fake-app", accessToken: "fake", webhookSecret: "fake" };
const debit = new Date(Date.now() - 3_600_000);
const invoice = { id: 11, preapproval_id: "fake-preapproval", external_reference: "fake-reference", debit_date: debit.toISOString(), currency_id: "MXN", transaction_amount: 200, payment: { id: 22, status: "approved" } };
type Resource = { id: string; external_reference: string; application_id: string; status: string; next_payment_date?: string; auto_recurring: { frequency: number; frequency_type: string; currency_id: string; transaction_amount: number; start_date: string } };
const resource: Resource = { id: "fake-preapproval", external_reference: "fake-reference", application_id: "fake-app", status: "authorized", auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "MXN", transaction_amount: 200, start_date: debit.toISOString() } };
let clock = Date.now(), priceUpdates = 0;
class BillingClock extends Date {
    constructor(value?: string | number | Date) { super(value ?? clock); }
    static now() { return clock; }
}
const payments = new Map<string, unknown>([["22", { id: 22, status: "approved", application_id: "fake-app", external_reference: "fake-reference", live_mode: true, transaction_amount: 200, currency_id: "MXN", date_approved: new Date().toISOString() }]]);
const api = {
    getMercadoPagoPayment: async (id: string) => { if (!payments.has(id)) throw new Error("Unexpected provider payment"); return payments.get(id); },
    getMercadoPagoAgreementRuntime: () => runtime,
    getMercadoPagoPreapproval: async () => structuredClone(resource),
    cancelMercadoPagoPreapproval: async () => ({ ...resource, status: "canceled" }),
    isMercadoPagoSubscriptionsEnabled: () => true,
    searchMercadoPagoInvoices: async () => ({ results: [] }),
    createMercadoPagoPreference: async () => ({ id: "fake-checkout", init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=fake" }),
    updateMercadoPagoSubscriptionPrice: async (_id: string, amount: number) => { priceUpdates++; resource.auto_recurring.transaction_amount = amount / 100; return structuredClone(resource); },
};
const changes = loadTsModule("src/lib/billing/mercado-pago-plan-changes.ts", {
    "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "./stripe": { getPlatformBaseUrl: () => "https://example.invalid" },
    "./recurring-policy": policy, "./plan-change-policy": changePolicy, "./mercado-pago": api,
}, { Date: BillingClock }) as { quoteRecurringPlanChange: (tenant: string, plan: string) => Promise<{ id: string; amountTodayCents: number }>;
    acceptRecurringPlanChange: (tenant: string, slug: string, user: { id: string; email: string }, change: string, consent: boolean, version: string) => Promise<unknown>;
    reconcilePlanChangePayment: (payment: unknown, runtime: unknown) => Promise<void> };
const service = loadTsModule("src/lib/billing/mercado-pago-subscriptions.ts", {
    "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "@/lib/billing/stripe": { getPlatformBaseUrl: () => "https://example.invalid" },
    "./recurring-policy": policy, "./paid-period": { paidPeriodStart }, "./mercado-pago-plan-changes": changes, "./mercado-pago": api,
}, { Date: BillingClock }) as { reconcileRecurringAgreement: (resource: Resource, runtime: unknown) => Promise<void>; reconcileRecurringInvoice: (invoice: unknown, runtime: unknown) => Promise<void>; cancelRecurringSubscription: (tenantId: string, userId: string) => Promise<void> };
try {
    await db.tenant.create({ data: { id: "recurring-test-tenant", slug: "recurring-test", displayName: "Disposable test", status: "READY", provisioningStatus: "SUCCEEDED", billingStatus: "UNPAID", accessMode: "BILLING_ONLY" } });
    await db.plan.create({ data: { id: "recurring-test-plan", slug: "recurring-test-plan", name: "Test", monthlyAmountCents: 20000 } });
    await db.plan.create({ data: { id: "recurring-test-ai", slug: "recurring-test-ai", name: "Test AI", monthlyAmountCents: 50000 } });
    await db.mercadoPagoAgreement.create({ data: { id: "recurring-test-agreement", tenantId: "recurring-test-tenant", planId: "recurring-test-plan", activeKey: "recurring-test-tenant", providerSubscriptionId: resource.id, externalReference: resource.external_reference, environment: "production", applicationId: "fake-app", amountCents: 20000, currency: "MXN", startsAt: debit, consentAt: new Date(), consentUserId: "fake-owner", consentVersion: policy.RECURRING_CONSENT_VERSION } });
    await service.reconcileRecurringAgreement(resource, runtime);
    assert.equal((await db.tenant.findUnique({ where: { id: "recurring-test-tenant" } })).accessMode, "BILLING_ONLY");
    await Promise.all(Array.from({ length: 5 }, () => service.reconcileRecurringInvoice(invoice, runtime)));
    assert.equal(await db.billingCheckoutAttempt.count(), 1);
    assert.equal(await db.subscription.count(), 1);
    assert.equal(await db.commercialEvent.count({ where: { event: "subscription_payment_approved" } }), 1);
    const before = await db.subscription.findFirst();
    resource.next_payment_date = before.currentPeriodEndsAt.toISOString();
    const quote = await changes.quoteRecurringPlanChange("recurring-test-tenant", "recurring-test-ai");
    assert.equal(await db.billingCheckoutAttempt.count(), 1); // quoting does not charge
    await changes.acceptRecurringPlanChange("recurring-test-tenant", "recurring-test", { id: "fake-owner", email: "fake@example.invalid" }, quote.id, true, changePolicy.PLAN_CHANGE_CONSENT_VERSION);
    const record = await db.mercadoPagoPlanChange.findUnique({ where: { id: quote.id } });
    const fee = { id: 99, status: "approved", application_id: "fake-app", external_reference: record.externalReference, live_mode: true, transaction_amount: quote.amountTodayCents / 100, currency_id: "MXN", date_approved: new BillingClock().toISOString() };
    // Concurrent actual PostgreSQL transactions may report "verification in progress"; retry safely.
    await Promise.allSettled(Array.from({ length: 5 }, () => changes.reconcilePlanChangePayment(fee, runtime)));
    await changes.reconcilePlanChangePayment(fee, runtime);
    let current = await db.subscription.findFirst();
    assert.equal(priceUpdates, 1); assert.equal(current.planId, "recurring-test-ai");
    assert.equal(current.currentPeriodEndsAt.getTime(), before.currentPeriodEndsAt.getTime());
    assert.equal(await db.commercialEvent.count({ where: { event: "subscription_plan_changed" } }), 1);
    await service.reconcileRecurringInvoice(invoice, runtime); // old $200 payment remains valid
    clock = before.currentPeriodEndsAt.getTime() + 1000;
    payments.set("33", { id: 33, status: "approved", application_id: "fake-app", external_reference: "fake-reference", live_mode: true, transaction_amount: 500, currency_id: "MXN", date_approved: new BillingClock().toISOString() });
    await service.reconcileRecurringInvoice({ ...invoice, id: 12, debit_date: before.currentPeriodEndsAt.toISOString(), transaction_amount: 500, payment: { id: 33, status: "approved" } }, runtime);
    current = await db.subscription.findFirst();
    assert.equal(current.planId, "recurring-test-ai"); assert.equal((await db.mercadoPagoPlanChange.findUnique({ where: { id: quote.id } })).activeKey, null);
    resource.next_payment_date = current.currentPeriodEndsAt.toISOString();
    const down = await changes.quoteRecurringPlanChange("recurring-test-tenant", "recurring-test-plan");
    await changes.acceptRecurringPlanChange("recurring-test-tenant", "recurring-test", { id: "fake-owner", email: "fake@example.invalid" }, down.id, true, changePolicy.PLAN_CHANGE_CONSENT_VERSION);
    assert.equal((await db.subscription.findFirst()).planId, "recurring-test-ai"); assert.equal(priceUpdates, 2);
    clock = current.currentPeriodEndsAt.getTime() + 1000;
    payments.set("44", { id: 44, status: "approved", application_id: "fake-app", external_reference: "fake-reference", live_mode: true, transaction_amount: 200, currency_id: "MXN", date_approved: new BillingClock().toISOString() });
    await service.reconcileRecurringInvoice({ ...invoice, id: 13, debit_date: current.currentPeriodEndsAt.toISOString(), payment: { id: 44, status: "approved" } }, runtime);
    assert.equal((await db.subscription.findFirst()).planId, "recurring-test-plan");
    const paidBeforeCancel = await db.subscription.findFirst();
    await service.cancelRecurringSubscription("recurring-test-tenant", "fake-owner");
    const after = await db.subscription.findFirst();
    assert.equal(paidBeforeCancel.currentPeriodEndsAt.getTime(), after.currentPeriodEndsAt.getTime());
    assert.equal(after.cancelAtPeriodEnd, true);
    assert.equal((await db.tenant.findUnique({ where: { id: "recurring-test-tenant" } })).accessMode, "FULL");
    // Execute the real lifecycle SQL, not a string assertion. No email/provider credentials are supplied.
    await db.mercadoPagoAgreement.update({ where: { id: "recurring-test-agreement" }, data: { status: "AUTHORIZED", activeKey: "recurring-test-tenant", cancelRequestedAt: null } });
    await db.subscription.update({ where: { id: after.id }, data: { cancelAtPeriodEnd: false, currentPeriodEndsAt: new Date(Date.now() - 3_600_000) } });
    const worker = spawnSync(process.execPath, ["scripts/billing-lifecycle-worker.mjs"], { env: { NODE_ENV: "test", CONTROL_DATABASE_URL: url, BILLING_STRIPE_ENABLED: "false", PATH: process.env.PATH,
        BILLING_RECONCILIATION_SECRET: "", APP_BASE_URL: "", AUTH_URL: "", NEXTAUTH_URL: "", RESEND_API_KEY: "", EMAIL_FROM: "" }, encoding: "utf8" });
    assert.equal(worker.status, 0, worker.stderr);
    assert.equal((await db.subscription.findFirst()).status, "PAST_DUE");
    assert.equal((await db.tenant.findUnique({ where: { id: "recurring-test-tenant" } })).accessMode, "READ_ONLY");
    console.log("PASS: migration chain, PostgreSQL concurrent cycles/upgrades, original renewal date, next $500 cycle, downgrade at next paid $200 cycle, cancellation and lifecycle SQL. No Mercado Pago requests made.");
} finally {
    await db.$disconnect(); await pool.end();
}
