/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma query-shaped in-memory delegates and provider fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/billing/recurring-policy.ts";
import * as changePolicy from "../src/lib/billing/plan-change-policy.ts";
import { paidPeriodStart } from "../src/lib/billing/paid-period.ts";

type Row = Record<string, any>;
const runtime = { environment: "production", applicationId: "app", accessToken: "fake", webhookSecret: "fake" };
const owner = { id: "owner", email: "owner@example.invalid" };
function fixture(high = false) {
    const now = new Date();
    const start = new Date(now.getTime() - 15 * 86_400_000), end = new Date(now.getTime() + 15 * 86_400_000);
    const agreement: Row = { id: "a", tenantId: "t", activeKey: "t", providerSubscriptionId: "pre", planId: high ? "ai" : "basic", initialPlanId: high ? "ai" : "basic", amountCents: high ? 50000 : 20000, initialAmountCents: high ? 50000 : 20000, status: "AUTHORIZED", environment: "production", applicationId: "app", externalReference: "sub-ref", startsAt: start, currency: "MXN", cancelRequestedAt: null, reconciliationOffset: 0 };
    const tables: Record<string, Row[]> = { mercadoPagoAgreement: [agreement], mercadoPagoPlanChange: [], billingCheckoutAttempt: [], commercialEvent: [], trial: [], trialPolicy: [],
        subscription: [{ id: "s", tenantId: "t", provider: "MERCADO_PAGO", providerSubscriptionId: "pre", planId: agreement.planId, status: "ACTIVE", currentPeriodStartsAt: start, currentPeriodEndsAt: end }],
        plan: [{ id: "basic", slug: "esencial", name: "Esencial", monthlyAmountCents: 20000, currency: "MXN", isActive: true }, { id: "ai", slug: "automatiza", name: "con IA", monthlyAmountCents: 50000, currency: "MXN", isActive: true }],
        tenant: [{ id: "t", status: "READY", accessMode: "FULL" }] };
    const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]) => {
        if (key === "OR") return value.some((part: Row) => matches(row, part));
        if (value instanceof Date) return row[key]?.getTime() === value.getTime();
        if (value && typeof value === "object") return (!value.in || value.in.includes(row[key])) && (!value.notIn || !value.notIn.includes(row[key]))
            && (value.not === undefined || (value.not === null ? row[key] != null : row[key] !== value.not))
            && (value.gt === undefined || row[key] > value.gt) && (value.lt === undefined || row[key] < value.lt)
            && (value.gte === undefined || row[key] >= value.gte) && (value.lte === undefined || row[key] <= value.lte);
        return value === null ? row[key] == null : row[key] === value;
    });
    const db: Row = { $queryRaw: async () => [] };
    const hydrated = (name: string, row: Row | undefined, include: Row = {}) => {
        if (!row) return null;
        return structuredClone({ ...row, ...(name === "mercadoPagoPlanChange" && include.agreement ? { agreement: tables.mercadoPagoAgreement.find(a => a.id === row.agreementId) } : {}),
            ...(name === "mercadoPagoPlanChange" && include.payment ? { payment: tables.billingCheckoutAttempt.find(p => p.planChangeId === row.id) || null } : {}) });
    };
    for (const [name, rows] of Object.entries(tables)) {
        const defaults = name === "mercadoPagoPlanChange" ? { status: "QUOTED", processingAt: null, appliedAt: null, providerAppliedAt: null, refundedAt: null, consentAt: null }
            : name === "billingCheckoutAttempt" ? { status: "CREATED", paidAt: null, providerPaymentId: null } : {};
        db[name] = {
            findUnique: async ({ where, include }: Row) => hydrated(name, rows.find(row => matches(row, where)), include),
            findUniqueOrThrow: async (args: Row) => { const row = await db[name].findUnique(args); if (!row) throw new Error("missing"); return row; },
            findFirst: async ({ where = {}, orderBy }: Row = {}) => { const found = rows.filter(row => matches(row, where)); if (orderBy) { const key = Object.keys(orderBy)[0]; found.sort((a, b) => Number(b[key]) - Number(a[key])); } return hydrated(name, found[0]); },
            findMany: async ({ where = {}, orderBy }: Row = {}) => { const found = rows.filter(row => matches(row, where)); if (orderBy) found.sort((a, b) => Number(a.effectiveAt) - Number(b.effectiveAt)); return structuredClone(found); },
            create: async ({ data }: Row) => { const row = { id: `${name}-${rows.length}`, createdAt: new Date(), ...defaults, ...data }; rows.push(row); return structuredClone(row); },
            update: async ({ where, data }: Row) => { const row = rows.find(row => matches(row, where)); if (!row) throw new Error("missing"); Object.assign(row, data); return structuredClone(row); },
            updateMany: async ({ where, data }: Row) => { const found = rows.filter(row => matches(row, where)); found.forEach(row => Object.assign(row, data)); return { count: found.length }; },
            upsert: async ({ where, create, update }: Row) => { const row = rows.find(row => matches(row, where)); if (row) { Object.assign(row, update); return structuredClone(row); } return db[name].create({ data: create }); },
        };
    }
    let queue = Promise.resolve();
    db.$transaction = (callback: ((tx: Row) => Promise<unknown>) | Promise<unknown>[]) => {
        if (Array.isArray(callback)) return Promise.all(callback);
        const pending = queue.then(async () => { const snapshot = structuredClone(tables); try { return await callback(db); } catch (error) { for (const key of Object.keys(tables)) tables[key].splice(0, tables[key].length, ...snapshot[key]); throw error; } });
        queue = pending.then(() => {}, () => {}); return pending;
    };
    const resource: Row = { id: "pre", external_reference: "sub-ref", application_id: "app", status: "authorized", auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: agreement.amountCents / 100, currency_id: "MXN", start_date: start.toISOString() }, next_payment_date: end.toISOString() };
    const refunds: string[] = [];
    let updates = 0, preferences = 0;
    let losePut = false, preparedInvoice = false, providerPayments: Row[] = [];
    let invoicePayment: Row = {};
    const api: Row = { getMercadoPagoAgreementRuntime: () => runtime, isMercadoPagoSubscriptionsEnabled: () => true,
        getMercadoPagoPreapproval: async () => structuredClone(resource),
        updateMercadoPagoSubscriptionPrice: async (_id: string, amount: number) => { updates++; resource.auto_recurring.transaction_amount = amount / 100; if (losePut) { losePut = false; throw new Error("lost PUT response"); } return structuredClone(resource); },
        searchMercadoPagoInvoices: async () => ({ results: preparedInvoice ? [{ preapproval_id: "pre", debit_date: end.toISOString(), transaction_amount: 200 }] : [] }),
        createMercadoPagoPreference: async () => { preferences++; return { id: "checkout", init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=checkout" }; },
        refundMercadoPagoPayment: async (_id: string, key: string) => { refunds.push(key); return { id: "refund" }; },
        searchMercadoPagoPayments: async () => ({ results: structuredClone(providerPayments) }),
        getMercadoPagoPayment: async (id: string) => structuredClone(providerPayments.find(p => String(p.id) === id) || invoicePayment),
    };
    const changes = loadTsModule("src/lib/billing/mercado-pago-plan-changes.ts", { "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "./mercado-pago": api,
        "./recurring-policy": policy, "./plan-change-policy": changePolicy, "./stripe": { getPlatformBaseUrl: () => "https://example.invalid" } }, { Date }) as Row;
    const recurring = loadTsModule("src/lib/billing/mercado-pago-subscriptions.ts", { "server-only": {}, "@/lib/control-db": { getControlDb: () => db }, "./mercado-pago": api,
        "./recurring-policy": policy, "./mercado-pago-plan-changes": changes, "./paid-period": { paidPeriodStart }, "@/lib/billing/stripe": { getPlatformBaseUrl: () => "https://example.invalid" } }, { Date }) as Row;
    const quote = () => changes.quoteRecurringPlanChange("t", high ? "esencial" : "automatiza");
    const accept = (id: string, tenant = "t", consent = true) => changes.acceptRecurringPlanChange(tenant, "demo", owner, id, consent, changePolicy.PLAN_CHANGE_CONSENT_VERSION);
    const payment = (quote: Row, overrides: Row = {}) => ({ id: "fee", status: "approved", external_reference: tables.mercadoPagoPlanChange.find(c => c.id === quote.id)!.externalReference, application_id: "app", live_mode: true, currency_id: "MXN", transaction_amount: quote.amountTodayCents / 100, date_approved: new Date().toISOString(), ...overrides });
    return { tables, db, resource, changes, recurring, quote, accept, payment, refunds, start, end, updates: () => updates, preferences: () => preferences,
        losePut: () => { losePut = true; }, prepareInvoice: () => { preparedInvoice = true; }, setPayments: (payments: Row[]) => { providerPayments = payments; }, setInvoicePayment: (payment: Row) => { invoicePayment = payment; } };
}

test("proration uses the actual period and integer cents", () => {
    const start = new Date("2026-01-01T00:00:00Z"), end = new Date("2026-01-31T00:00:00Z"), halfway = new Date("2026-01-16T00:00:00Z");
    assert.equal(changePolicy.proratedUpgradeCents(20000, 50000, start, end, halfway), 15000);
    assert.equal(changePolicy.proratedUpgradeCents(20000, 50000, start, new Date("2026-02-01T00:00:00Z"), halfway), 15484);
    assert.equal(changePolicy.proratedUpgradeCents(20000, 50000, start, end, start), 30000);
    assert.throws(() => changePolicy.proratedUpgradeCents(20000, 50000, start, end, end));
    assert.throws(() => changePolicy.proratedUpgradeCents(20000, 10000, start, end, halfway));
});

test("quote causes no payment, requires owner-scoped acceptance and explicit consent", async () => {
    const f = fixture(), q = await f.quote();
    assert.equal(q.amountTodayCents, 15000); assert.equal(f.preferences(), 0); assert.equal(f.updates(), 0);
    await assert.rejects(f.accept(q.id, "other-tenant")); await assert.rejects(f.accept(q.id, "t", false));
    assert.equal(f.tables.billingCheckoutAttempt.length, 0);
    await f.accept(q.id); await f.accept(q.id); assert.equal(f.preferences(), 1);
    assert.equal(f.tables.subscription[0].planId, "basic");
});

test("approved proportional payment upgrades only entitlement and the same recurring agreement", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id);
    const p = f.payment(q); await f.changes.reconcilePlanChangePayment(p, runtime); await f.changes.reconcilePlanChangePayment(p, runtime);
    assert.equal(f.updates(), 1); assert.equal(f.tables.mercadoPagoAgreement.length, 1); assert.equal(f.tables.subscription[0].planId, "ai");
    assert.equal(f.tables.subscription[0].currentPeriodEndsAt.getTime(), f.end.getTime());
    assert.equal(f.tables.mercadoPagoAgreement[0].amountCents, 50000); assert.equal(f.tables.commercialEvent.length, 1);
    assert.equal((await f.changes.recurringCyclePrice(f.tables.mercadoPagoAgreement[0], f.start)).amountCents, 20000);
    assert.equal((await f.changes.recurringCyclePrice(f.tables.mercadoPagoAgreement[0], f.end)).amountCents, 50000);
});

test("downgrade costs zero now and keeps AI until the already paid period ends", async () => {
    const f = fixture(true), q = await f.quote(); assert.equal(q.amountTodayCents, 0); await f.accept(q.id);
    assert.equal(f.tables.subscription[0].planId, "ai"); assert.equal(f.tables.mercadoPagoAgreement[0].planId, "basic");
    assert.equal(f.preferences(), 0); assert.equal(f.tables.billingCheckoutAttempt.length, 0);
    assert.equal((await f.changes.recurringCyclePrice(f.tables.mercadoPagoAgreement[0], f.end)).planId, "basic");
});

test("declined or mismatched proportional payments never upgrade", async () => {
    for (const overrides of [{ status: "rejected" }, { live_mode: false }, { application_id: "wrong" }, { transaction_amount: 500 }, { currency_id: "USD" }]) {
        const f = fixture(), q = await f.quote(); await f.accept(q.id);
        await f.changes.reconcilePlanChangePayment(f.payment(q, overrides), runtime).catch(() => {});
        assert.equal(f.updates(), 0); assert.equal(f.tables.subscription[0].planId, "basic");
    }
});

test("lost PUT response is recovered by reading the new price, without another mutation", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); f.losePut();
    await assert.rejects(f.changes.reconcilePlanChangePayment(f.payment(q), runtime));
    await f.changes.recoverRecurringPlanChanges("a"); assert.equal(f.updates(), 1); assert.equal(f.tables.subscription[0].planId, "ai");
});

test("missed payment webhook is recovered through its exact external reference", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); f.setPayments([f.payment(q)]);
    await f.changes.recoverRecurringPlanChanges("a"); assert.equal(f.tables.subscription[0].planId, "ai");
});

test("simultaneous fee notifications cannot update price or entitlement twice", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); const p = f.payment(q);
    await Promise.allSettled(Array.from({ length: 8 }, () => f.changes.reconcilePlanChangePayment(p, runtime)));
    await f.changes.reconcilePlanChangePayment(p, runtime);
    assert.equal(f.updates(), 1); assert.equal(f.tables.commercialEvent.length, 1); assert.equal(f.tables.billingCheckoutAttempt.length, 1);
});

test("a payment approved after its quoted expiry is refunded, not used to activate AI", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id);
    await f.changes.reconcilePlanChangePayment(f.payment(q, { date_approved: new Date(Date.now() + 11 * 60_000).toISOString() }), runtime);
    assert.equal(f.refunds.length, 1); assert.equal(f.updates(), 0); assert.equal(f.tables.subscription[0].planId, "basic");
});

test("refund cannot remove a later fully paid AI month", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); const p = f.payment(q);
    await f.changes.reconcilePlanChangePayment(p, runtime);
    f.tables.subscription[0].currentPeriodEndsAt = new Date(f.end.getTime() + 31 * 86_400_000);
    await f.changes.reconcilePlanChangePayment({ ...p, status: "refunded" }, runtime);
    assert.equal(f.tables.subscription[0].planId, "ai"); assert.ok(f.tables.mercadoPagoAgreement[0].cancelRequestedAt);
});

test("unknown or another-tenant references never fall through as a proportional payment", async () => {
    const f = fixture(); assert.equal(await f.changes.reconcilePlanChangePayment({ external_reference: "another-ref" }, runtime), false);
    assert.equal(f.tables.subscription[0].planId, "basic"); assert.equal(f.updates(), 0);
});

test("an old or expired confirmation cannot authorize another checkout", async () => {
    const f = fixture(), first = await f.quote(); await f.quote(); await assert.rejects(f.accept(first.id));
    const current = f.tables.mercadoPagoPlanChange.at(-1)!; current.expiresAt = new Date(Date.now() - 1000); await assert.rejects(f.accept(current.id)); assert.equal(f.preferences(), 0);
});

test("cancellation or period change before fee approval refunds instead of granting AI", async () => {
    for (const cancel of [true, false]) {
        const f = fixture(), q = await f.quote(); await f.accept(q.id);
        if (cancel) f.tables.mercadoPagoAgreement[0].cancelRequestedAt = new Date(); else f.tables.subscription[0].currentPeriodEndsAt = new Date(Date.now() + 40 * 86_400_000);
        await f.changes.reconcilePlanChangePayment(f.payment(q), runtime);
        assert.equal(f.tables.subscription[0].planId, "basic"); assert.equal(f.updates(), 0); assert.equal(f.refunds.length, 1);
    }
});

test("a second approved payment is refunded with a stable idempotency key", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id);
    await f.changes.reconcilePlanChangePayment(f.payment(q), runtime);
    await f.changes.reconcilePlanChangePayment(f.payment(q, { id: "fee2" }), runtime);
    assert.equal(f.updates(), 1); assert.match(f.refunds[0], /duplicate-plan-change/);
});

test("prepared old-price renewal blocks a quote and refunds a later unapplicable upgrade", async () => {
    const f = fixture(); f.prepareInvoice(); await assert.rejects(f.quote());
    const second = fixture(), q = await second.quote(); await second.accept(q.id); second.prepareInvoice();
    await second.changes.reconcilePlanChangePayment(second.payment(q), runtime); assert.equal(second.refunds.length, 1); assert.equal(second.updates(), 0);
});

test("refund reverses only upgraded entitlement in its own period and cannot be resurrected", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); const p = f.payment(q);
    await f.changes.reconcilePlanChangePayment(p, runtime);
    await f.changes.reconcilePlanChangePayment({ ...p, status: "refunded" }, runtime);
    await f.changes.reconcilePlanChangePayment(p, runtime);
    assert.equal(f.tables.subscription[0].planId, "basic"); assert.ok(f.tables.mercadoPagoAgreement[0].cancelRequestedAt);
    assert.equal(f.tables.mercadoPagoPlanChange[0].status, "REFUNDED");
});

test("historical recurring invoice remains valid after an upgrade, including its refund", async () => {
    const f = fixture(), q = await f.quote(); await f.accept(q.id); await f.changes.reconcilePlanChangePayment(f.payment(q), runtime);
    const invoice = { id: "old-cycle", preapproval_id: "pre", debit_date: f.start.toISOString(), currency_id: "MXN", transaction_amount: 200, payment: { id: "old-payment", status: "approved" } };
    f.setInvoicePayment({ id: "old-payment", status: "approved", live_mode: true, application_id: "app", currency_id: "MXN", transaction_amount: 200, external_reference: "sub-ref", date_approved: f.start.toISOString() });
    await f.recurring.reconcileRecurringInvoice(invoice, runtime); assert.equal(f.tables.subscription[0].planId, "ai");
    f.setInvoicePayment({ id: "old-payment", status: "refunded", live_mode: true, application_id: "app", currency_id: "MXN", transaction_amount: 200, external_reference: "sub-ref" });
    await f.recurring.reconcileRecurringInvoice({ ...invoice, payment: { id: "old-payment", status: "refunded" } }, runtime);
    assert.equal(f.tables.subscription[0].status, "UNPAID"); // proportional payment alone never counts as another month
});
