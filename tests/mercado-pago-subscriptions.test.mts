/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Prisma delegate fixtures model arbitrary query shapes. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/billing/recurring-policy.ts";
import { paidPeriodStart } from "../src/lib/billing/paid-period.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";
import * as runtimeHelpers from "../src/lib/billing/mercado-pago-runtime-helpers.ts";

type Row = Record<string, any>;
const now = new Date();
const debit = new Date(now.getTime() - 3_600_000);
const environment = { environment: "production", applicationId: "app", accessToken: "not-real", webhookSecret: "not-real" };

function fixture() {
    const agreement: Row = { id: "agreement-a", tenantId: "tenant-a", activeKey: "tenant-a", planId: "plan-a", providerSubscriptionId: "pre-a", externalReference: "ref-a", applicationId: "app", environment: "production", amountCents: 20000, currency: "MXN", status: "AUTHORIZED", startsAt: debit, cancelRequestedAt: null, reconciliationOffset: 0 };
    const tables: Record<string, Row[]> = { mercadoPagoPlanChange: [], mercadoPagoAgreement: [agreement], subscription: [], billingCheckoutAttempt: [], commercialEvent: [], trial: [], tenant: [{ id: "tenant-a", status: "READY", accessMode: "BILLING_ONLY", billingStatus: "UNPAID" }], plan: [{ id: "plan-a", slug: "esencial", name: "Esencial", isActive: true, monthlyAmountCents: 20000, currency: "MXN" }], trialPolicy: [{ isDefault: true, isActive: true, graceDays: 3 }] };
    const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, condition]) => {
        if (key === "OR") return condition.some((part: Row) => matches(row, part));
        if (condition && typeof condition === "object" && !(condition instanceof Date)) {
            if (condition.in && !condition.in.includes(row[key])) return false;
            if (condition.notIn?.includes(row[key])) return false;
            if (condition.gt != null && !(row[key] > condition.gt)) return false;
            if (condition.not !== undefined && row[key] === condition.not) return false;
            return true;
        }
        return condition instanceof Date ? row[key]?.getTime() === condition.getTime() : row[key] === condition || (condition === null && row[key] == null);
    });
    const db: Row = {};
    for (const [name, rows] of Object.entries(tables)) db[name] = {
        findUnique: async ({ where }: Row) => rows.find(row => matches(row, where)) || null,
        findUniqueOrThrow: async ({ where }: Row) => { const row = rows.find(row => matches(row, where)); if (!row) throw new Error("not_found"); return { ...row }; },
        findFirst: async ({ where, orderBy }: Row = {}) => { const found = rows.filter(row => matches(row, where)); if (orderBy) { const key = Object.keys(orderBy)[0]; found.sort((a, b) => Number(b[key]) - Number(a[key])); } return found[0] || null; },
        create: async ({ data }: Row) => { const row = { id: `${name}-${rows.length}`, ...data }; rows.push(row); return row; },
        update: async ({ where, data }: Row) => { const row = rows.find(row => matches(row, where)); if (!row) throw new Error("not_found"); Object.assign(row, data); return row; },
        updateMany: async ({ where, data }: Row) => { const found = rows.filter(row => matches(row, where)); found.forEach(row => Object.assign(row, data)); return { count: found.length }; },
        upsert: async ({ where, create, update }: Row) => { const existing = rows.find(row => matches(row, where)); if (existing) { Object.assign(existing, update); return { ...existing }; } const row = { id: `${name}-${rows.length}`, ...create }; rows.push(row); return { ...row }; },
    };
    // A serial queue represents the tenant row lock. Snapshot rollback matches a DB transaction.
    let queue = Promise.resolve();
    db.$transaction = (action: (tx: Row) => Promise<unknown>) => {
        const pending = queue.then(async () => {
            const snapshot = structuredClone(tables);
            try { return await action(db); } catch (error) { for (const key of Object.keys(tables)) tables[key].splice(0, tables[key].length, ...snapshot[key]); throw error; }
        });
        queue = pending.then(() => {}, () => {}); return pending;
    };
    let locks = 0;
    db.$queryRaw = async () => { locks++; return []; };
    const resource: Row = { id: "pre-a", external_reference: "ref-a", application_id: "app", status: "authorized", init_point: "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=pre-a", auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "MXN", transaction_amount: 200, start_date: debit.toISOString() }, next_payment_date: new Date(now.getTime() + 86_400_000).toISOString(), last_modified: now.toISOString() };
    let payment: Row = { id: 1, status: "approved", external_reference: "ref-a", application_id: "app", transaction_amount: 200, currency_id: "MXN", live_mode: true, date_approved: now.toISOString() };
    let creates = 0;
    let cancelFail = false;
    const api: Row = { getMercadoPagoRuntimeConfiguration: async () => environment, getMercadoPagoAgreementRuntime: () => environment, isMercadoPagoSubscriptionsEnabled: () => true,
        MercadoPagoApiError: class extends Error {},
        createMercadoPagoPreapproval: async (_runtime: unknown, input: Row) => { creates++; Object.assign(resource, { external_reference: input.externalReference }); resource.auto_recurring.start_date = input.startsAt.toISOString(); return resource; },
        getMercadoPagoPreapproval: async () => resource,
        cancelMercadoPagoPreapproval: async () => { if (cancelFail) throw new Error("timeout"); return { ...resource, status: "canceled" }; },
        getMercadoPagoPayment: async () => payment,
        searchMercadoPagoPreapprovals: async () => ({ results: [resource] }),
        searchMercadoPagoInvoices: async () => ({ results: [] }), getMercadoPagoInvoice: async () => { throw new Error("unexpected"); },
    };
    const service = loadTsModule("src/lib/billing/mercado-pago-subscriptions.ts", {
        "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "./mercado-pago": api,
        "./recurring-policy": policy, "./paid-period": { paidPeriodStart }, "@/lib/billing/stripe": { getPlatformBaseUrl: () => "https://app.test" },
        "./mercado-pago-plan-changes": { recurringCyclePrice: async (agreement: Row) => ({ planId: agreement.planId, amountCents: agreement.amountCents }), recoverRecurringPlanChanges: async () => {} },
    }, { process: { ...process, env: { ...process.env, BILLING_RECONCILIATION_SECRET: "x".repeat(32) } } }) as Row;
    const invoice: Row = { id: "cycle-1", preapproval_id: "pre-a", external_reference: "ref-a", debit_date: debit.toISOString(), currency_id: "MXN", transaction_amount: "200.00", payment: { id: 1, status: "approved" } };
    return { tables, db, agreement, resource, invoice, api, service, locks: () => locks, creates: () => creates, setPayment: (data: Row) => { payment = { ...payment, ...data }; }, failCancel: (value: boolean) => { cancelFail = value; } };
}

test("authorization alone never activates or extends a tenant", async () => {
    const f = fixture(); await f.service.reconcileRecurringAgreement(f.resource, environment);
    assert.equal(f.tables.subscription.length, 0); assert.equal(f.tables.tenant[0].accessMode, "BILLING_ONLY");
});

test("repeated and concurrent invoice deliveries grant exactly one calendar month", async () => {
    const f = fixture(); await Promise.all([1, 2, 3].map(() => f.service.reconcileRecurringInvoice(f.invoice, environment)));
    assert.equal(f.tables.billingCheckoutAttempt.length, 1); assert.equal(f.tables.subscription.length, 1); assert.equal(f.tables.commercialEvent.length, 1);
    assert.equal(f.tables.tenant[0].accessMode, "FULL"); assert.ok(f.locks() > 0);
    const expected = new Date(debit); expected.setMonth(expected.getMonth() + 1);
    assert.equal(f.tables.subscription[0].currentPeriodEndsAt.getTime(), expected.getTime());
});

test("late older cycles and declined retries cannot downgrade or extend a newer paid period", async () => {
    const f = fixture(); await f.service.reconcileRecurringInvoice(f.invoice, environment);
    const end = f.tables.subscription[0].currentPeriodEndsAt.getTime();
    f.setPayment({ status: "rejected" }); await f.service.reconcileRecurringInvoice({ ...f.invoice, payment: { id: 1, status: "rejected" } }, environment);
    assert.equal(f.tables.subscription[0].status, "ACTIVE"); assert.equal(f.tables.subscription[0].currentPeriodEndsAt.getTime(), end);
});

test("wrong amount, app, currency, environment, payment ID and cycle reference fail closed", async () => {
    for (const mismatch of [{ transaction_amount: 500 }, { application_id: "other" }, { currency_id: "USD" }, { live_mode: false }, { id: 999 }, { external_reference: "another-tenant" }]) {
        const f = fixture(); f.setPayment(mismatch); await assert.rejects(f.service.reconcileRecurringInvoice(f.invoice, environment)); assert.equal(f.tables.subscription.length, 0);
    }
});

test("cancellation preserves paid access and stale authorization cannot resurrect renewal", async () => {
    const f = fixture(); await f.service.reconcileRecurringInvoice(f.invoice, environment);
    const end = f.tables.subscription[0].currentPeriodEndsAt;
    await f.service.cancelRecurringSubscription("tenant-a", "owner-a");
    assert.equal(f.agreement.status, "CANCELED"); assert.equal(f.agreement.activeKey, null); assert.equal(f.tables.subscription[0].cancelAtPeriodEnd, true);
    assert.equal(f.tables.tenant[0].accessMode, "FULL"); assert.equal(f.tables.subscription[0].currentPeriodEndsAt, end);
    await f.service.reconcileRecurringAgreement(f.resource, environment); assert.equal(f.agreement.status, "CANCELED");
});

test("a failed cancellation remains reserved and background synchronization retries it", async () => {
    const f = fixture(); f.failCancel(true); await assert.rejects(f.service.cancelRecurringSubscription("tenant-a", "owner-a"));
    assert.equal(f.agreement.activeKey, "tenant-a"); assert.ok(f.agreement.cancelRequestedAt);
    f.failCancel(false); await f.service.synchronizeRecurringAgreement(f.agreement); assert.equal(f.agreement.status, "CANCELED");
});

test("an externally altered price never blocks canceling the verified agreement", async () => {
    const f = fixture(); f.resource.auto_recurring.transaction_amount = 999;
    await assert.rejects(f.service.reconcileRecurringAgreement(f.resource, environment));
    await f.service.cancelRecurringSubscription("tenant-a", "owner-a");
    assert.equal(f.tables.mercadoPagoAgreement[0].status, "CANCELED");
});

test("scheduled invoices without an actual payment grant nothing", async () => {
    const f = fixture(); await f.service.reconcileRecurringInvoice({ ...f.invoice, payment: undefined }, environment); assert.equal(f.tables.subscription.length, 0);
});

test("refunds revoke only their cycle and do not grant again on an old approved notification", async () => {
    const f = fixture(); await f.service.reconcileRecurringInvoice(f.invoice, environment);
    f.setPayment({ status: "refunded" }); await f.service.reconcileRecurringInvoice({ ...f.invoice, payment: { id: 1, status: "refunded" } }, environment);
    assert.equal(f.tables.tenant[0].accessMode, "BILLING_ONLY");
    f.setPayment({ status: "approved" }); await f.service.reconcileRecurringInvoice(f.invoice, environment); assert.equal(f.tables.tenant[0].accessMode, "BILLING_ONLY");
});

test("a rejected first debit has bounded recovery and does not restart grace on retries", async () => {
    const f = fixture(); f.setPayment({ status: "rejected" }); const invoice = { ...f.invoice, payment: { id: 1, status: "rejected" } };
    await f.service.reconcileRecurringInvoice(invoice, environment); const grace = f.tables.subscription[0].graceEndsAt.getTime();
    assert.equal(f.tables.tenant[0].accessMode, "READ_ONLY");
    await f.service.reconcileRecurringInvoice(invoice, environment); assert.equal(f.tables.subscription[0].graceEndsAt.getTime(), grace);
});

test("no subscription starts without explicit consent and matching displayed price", async () => {
    for (const input of [{ consent: false }, { consentVersion: "old" }, { amountCents: 10000 }]) {
        const f = fixture(); f.tables.mercadoPagoAgreement.length = 0;
        await assert.rejects(f.service.startRecurringSubscription({ tenantId: "tenant-a", tenantSlug: "salon", userId: "owner-a", email: "owner@example.com", planSlug: "esencial", consent: true, consentVersion: policy.RECURRING_CONSENT_VERSION, amountCents: 20000, currency: "MXN", ...input }));
        assert.equal(f.creates(), 0);
    }
});

test("pending agreement is reused, while authorized agreements block duplicate creation", async () => {
    const f = fixture(); const input = { tenantId: "tenant-a", tenantSlug: "salon", userId: "owner-a", email: "owner@example.com", planSlug: "esencial", consent: true, consentVersion: policy.RECURRING_CONSENT_VERSION, amountCents: 20000, currency: "MXN" };
    await assert.rejects(f.service.startRecurringSubscription(input));
    f.tables.mercadoPagoAgreement[0].status = "PENDING"; f.tables.mercadoPagoAgreement[0].checkoutUrl = f.resource.init_point;
    assert.equal(await f.service.startRecurringSubscription(input), f.resource.init_point); assert.equal(f.creates(), 0);
});

test("creation preserves the full trial/paid period and uncertain responses never trigger a second POST", async () => {
    const f = fixture(); f.tables.mercadoPagoAgreement.length = 0;
    const trialEnd = new Date(Date.now() + 7 * 86_400_000);
    const paidEnd = new Date(Date.now() + 12 * 86_400_000);
    f.tables.trial.push({ tenantId: "tenant-a", status: "ACTIVE", endsAt: trialEnd });
    f.tables.subscription.push({ tenantId: "tenant-a", status: "ACTIVE", currentPeriodEndsAt: paidEnd });
    let creationCount = 0;
    f.api.createMercadoPagoPreapproval = async (_runtime: unknown, input: Row) => {
        creationCount++; assert.equal(input.startsAt.getTime(), paidEnd.getTime()); throw new Error("response lost after remote creation");
    };
    const input = { tenantId: "tenant-a", tenantSlug: "salon", userId: "owner-a", email: "owner@example.com", planSlug: "esencial", consent: true, consentVersion: policy.RECURRING_CONSENT_VERSION, amountCents: 20000, currency: "MXN" };
    await assert.rejects(f.service.startRecurringSubscription(input));
    await assert.rejects(f.service.startRecurringSubscription(input));
    assert.equal(creationCount, 1); assert.equal(f.tables.mercadoPagoAgreement[0].activeKey, "tenant-a");
});

test("out-of-order monthly cycles use their debit date, not delivery time, without adding extra months", async () => {
    const f = fixture(); const olderDebit = new Date(debit); olderDebit.setMonth(olderDebit.getMonth() - 1);
    f.agreement.startsAt = olderDebit;
    await f.service.reconcileRecurringInvoice(f.invoice, environment); const latestEnd = f.tables.subscription[0].currentPeriodEndsAt.getTime();
    f.setPayment({ id: 2 });
    await f.service.reconcileRecurringInvoice({ ...f.invoice, id: "older-cycle", debit_date: olderDebit.toISOString(), payment: { id: 2, status: "approved" } }, environment);
    assert.equal(f.tables.subscription[0].currentPeriodEndsAt.getTime(), latestEnd);
    assert.equal(f.tables.billingCheckoutAttempt.length, 2);
});

test("hosted authorization URLs cannot redirect to another host or subscription", () => {
    assert.ok(policy.hostedSubscriptionUrl("https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=a", "a"));
    for (const url of ["https://evil.test/subscriptions/checkout?preapproval_id=a", "https://www.mercadopago.com.mx.evil.test/subscriptions/checkout?preapproval_id=a", "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=b", "javascript:alert(1)"]) assert.equal(policy.hostedSubscriptionUrl(url, "a"), null);
});

test("customer subscription route requires same origin, OWNER context and explicit cancel confirmation", async () => {
    let permitted = false; let calls = 0;
    class AccessError extends Error { status = 403; }
    const routeModule = loadTsModule("src/app/api/billing/subscription/route.ts", {
        "next/server": { NextRequest, NextResponse }, "@/lib/security": { isSameApplicationOrigin: (req: NextRequest) => req.headers.get("origin") === "https://app.test" },
        "@/lib/billing/context": { BillingAccessError: AccessError, requireBillingOwner: async () => { if (!permitted) throw new AccessError("OWNER only"); return { tenant: { tenantId: "tenant-a", slug: "salon" }, user: { id: "owner-a", email: "a@example.com" } }; } },
        "@/lib/control-db": {}, "@/lib/billing/mercado-pago": { MercadoPagoBillingConfigurationError: class extends Error {} },
        "@/lib/billing/mercado-pago-subscriptions": { RecurringBillingError: class extends Error {}, cancelRecurringSubscription: async () => { calls++; } },
        "@/lib/billing/mercado-pago-plan-changes": {},
    }) as { POST: (req: NextRequest) => Promise<Response> };
    const request = (origin: string, confirmCancel = false) => new NextRequest("https://app.test/api/billing/subscription", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ tenantSlug: "salon", action: "cancel", confirmCancel }) });
    assert.equal((await routeModule.POST(request("https://evil.test", true))).status, 403);
    assert.equal((await routeModule.POST(request("https://app.test", true))).status, 403);
    permitted = true; assert.equal((await routeModule.POST(request("https://app.test"))).status, 400);
    assert.equal(calls, 0); assert.equal((await routeModule.POST(request("https://app.test", true))).status, 200); assert.equal(calls, 1);
});

test("lifecycle and deletion preserve renewal accounting and cannot silently leave external charges", () => {
    const worker = fs.readFileSync("scripts/billing-lifecycle-worker.mjs", "utf8");
    const deletion = fs.readFileSync("scripts/account-deletion-worker.mjs", "utf8");
    assert.match(worker, /recurring \? "PAST_DUE" : "CANCELED"/);
    assert.match(worker, /"recurringAgreementId" IS NULL/);
    assert.match(worker, /warnFailedRecurringPayments/);
    assert.match(deletion, /cancel_for_deletion/); assert.match(deletion, /recurring_billing_still_active/);
});

test("plan-change endpoints are owner-only and ignore client tenant IDs and amounts", async () => {
    let permitted = false;
    const calls: Row[] = [];
    class AccessError extends Error { status = 403; }
    const route = loadTsModule("src/app/api/billing/subscription/route.ts", {
        "next/server": { NextRequest, NextResponse }, "@/lib/security": { isSameApplicationOrigin: () => true },
        "@/lib/billing/context": { BillingAccessError: AccessError, requireBillingOwner: async () => { if (!permitted) throw new AccessError("owner only"); return { tenant: { tenantId: "actual-tenant", slug: "demo" }, user: { id: "actual-owner", email: "fake@example.invalid" } }; } },
        "@/lib/control-db": {}, "@/lib/billing/mercado-pago": { MercadoPagoBillingConfigurationError: class extends Error {} },
        "@/lib/billing/mercado-pago-subscriptions": { RecurringBillingError: policy.RecurringBillingError },
        "@/lib/billing/mercado-pago-plan-changes": {
            quoteRecurringPlanChange: async (...args: unknown[]) => { calls.push(args); return { id: "quote" }; },
            acceptRecurringPlanChange: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
        },
    }) as { POST: (req: NextRequest) => Promise<Response> };
    const request = (action: string) => new NextRequest("https://app.test/api/billing/subscription", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, tenantSlug: "demo", tenantId: "attacker-supplied", planSlug: "ai", amountCents: 1, changeId: "quote", consent: true, consentVersion: "monthly-plan-change-v1" }) });
    for (const action of ["quote_change", "accept_change"]) assert.equal((await route.POST(request(action))).status, 403);
    assert.equal(calls.length, 0); permitted = true;
    assert.equal((await route.POST(request("quote_change"))).status, 200); assert.deepEqual(calls[0], ["actual-tenant", "ai"]);
    assert.equal((await route.POST(request("accept_change"))).status, 200); assert.equal(calls[1][0], "actual-tenant"); assert.equal(calls[1][2].id, "actual-owner");
});

test("hosted API creates a pending authorization, never an immediate card charge, and pins old environments", async () => {
    const requests: Row[] = [];
    const api = loadTsModule("src/lib/billing/mercado-pago.ts", {
        "server-only": {}, "@/lib/billing/platform-runtime": { getMercadoPagoEnvironment: async () => "production", getMercadoPagoEnvironmentFallback: () => "test" },
        "@/lib/billing/mercado-pago-runtime-helpers": runtimeHelpers,
    }, {
        process: { env: { MERCADO_PAGO_ENABLED: "true", MERCADO_PAGO_APPLICATION_ID: "app", MERCADO_PAGO_TEST_ACCESS_TOKEN: "fake-test", MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "fake-production", MERCADO_PAGO_WEBHOOK_SECRET: "fake-secret" } },
        fetch: async (url: string, init: RequestInit) => { requests.push({ url, init }); return new Response(JSON.stringify({ id: "pre" }), { status: 200 }); },
    }) as Row;
    const pinned = api.getMercadoPagoAgreementRuntime("test", "app");
    assert.equal(pinned.accessToken, "fake-test");
    await api.createMercadoPagoPreapproval(pinned, { externalReference: "tenant-reference", title: "Monthly plan", payerEmail: "fake@example.com", amountCents: 20000, currency: "MXN", startsAt: debit, backUrl: "https://app.test/billing/salon" });
    assert.equal(requests[0].url, "https://api.mercadopago.com/preapproval");
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.status, "pending"); assert.equal(body.auto_recurring.frequency, 1); assert.equal(body.auto_recurring.frequency_type, "months");
    assert.equal(body.auto_recurring.transaction_amount, 200); assert.equal(body.auto_recurring.start_date, debit.toISOString()); assert.equal(body.card_token_id, undefined);
    await api.updateMercadoPagoSubscriptionPrice("pre", 50000, "MXN", pinned);
    assert.equal(requests[1].init.method, "PUT");
    assert.deepEqual(JSON.parse(requests[1].init.body), { auto_recurring: { transaction_amount: 500, currency_id: "MXN" } });
    assert.equal(requests[1].init.headers.Authorization, "Bearer fake-test");
    await api.refundMercadoPagoPayment("payment", "stable-refund-key", pinned);
    assert.equal(requests[2].init.headers["X-Idempotency-Key"], "stable-refund-key");
    assert.equal(requests[2].init.body, "{}"); assert.match(requests[2].url, /payments\/payment\/refunds$/);
});

test("subscription UI starts unchecked and separates renewal management from payment", () => {
    const controls = loadTsModule("src/app/billing/[tenantSlug]/recurring-controls.tsx", { "next/navigation": { useRouter: () => ({ refresh: () => {} }) }, "@/lib/billing/recurring-policy": policy }) as Row;
    const html = renderToStaticMarkup(createElement(controls.RecurringCheckout as ComponentType<Row>, { tenantSlug: "salon", planSlug: "esencial", price: "$200.00", amountCents: 20000, currency: "MXN", disabled: false }));
    assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked=""/); assert.match(html, /disabled=""/); assert.match(html, /renovación automática hasta que cancele/);
    const management = renderToStaticMarkup(createElement(controls.RecurringManagement as ComponentType<Row>, { tenantSlug: "salon", canCancel: true }));
    assert.match(management, /Cancelar renovación/); assert.doesNotMatch(management, /Sí, cancelar renovación/);
});

test("strict readiness detects a missing billing migration without leaking database errors", async () => {
    const route = loadTsModule("src/app/api/health/route.ts", {
        "next/server": { NextRequest, NextResponse }, "@/lib/db": { prisma: { $queryRaw: async () => [] } },
        "@/lib/control-db": { getControlDb: () => ({ $queryRaw: async () => { throw new Error("missing schema private diagnostic"); } }) },
    }, { process: { env: { MULTITENANT_RUNTIME_ENABLED: "true" } } }) as { GET: (request: NextRequest) => Promise<Response> };
    const response = await route.GET(new NextRequest("https://app.test/api/health?scope=ready"));
    assert.equal(response.status, 503); const payload = await response.json(); assert.equal(payload.controlPlane.ok, false);
    assert.doesNotMatch(JSON.stringify(payload), /private diagnostic/);
});

test("readiness waits for both billing tables, not only the fastest successful query", async () => {
    const route = loadTsModule("src/app/api/health/route.ts", {
        "next/server": { NextRequest, NextResponse }, "@/lib/db": { prisma: { $queryRaw: async () => [] } },
        "@/lib/control-db": { getControlDb: () => ({ $queryRaw: async (strings: TemplateStringsArray) => {
            if (strings.join("").includes("MercadoPagoPlanChange")) { await new Promise(resolve => setTimeout(resolve, 15)); throw new Error("missing plan-change table"); }
            return [];
        } }) },
    }, { process: { env: { MULTITENANT_RUNTIME_ENABLED: "true" } } }) as { GET: (request: NextRequest) => Promise<Response> };
    assert.equal((await route.GET(new NextRequest("https://app.test/api/health?scope=ready"))).status, 503);
});
