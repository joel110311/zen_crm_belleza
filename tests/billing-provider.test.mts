import assert from "node:assert/strict";
import test from "node:test";
import { hasActiveTrial, resolveActiveBillingProvider } from "../src/lib/billing/provider-policy.ts";

test("Mercado Pago is the default; stale Stripe configuration cannot restore Stripe", () => {
    for (const env of [{}, { BILLING_PROVIDER: "stripe" }, { BILLING_STRIPE_ENABLED: "true" }, { BILLING_PROVIDER: "stripe", BILLING_STRIPE_ENABLED: "false" }]) {
        assert.equal(resolveActiveBillingProvider(env), "MERCADO_PAGO");
    }
});

test("Stripe requires both explicit provider selection and enabled flag", () => {
    assert.equal(resolveActiveBillingProvider({ BILLING_PROVIDER: "stripe", BILLING_STRIPE_ENABLED: "true" }), "STRIPE");
    assert.equal(resolveActiveBillingProvider({ BILLING_PROVIDER: "mercado_pago", BILLING_STRIPE_ENABLED: "true" }), "MERCADO_PAGO");
});

test("expired and converted trials must never be presented as active", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    assert.equal(hasActiveTrial(null, now), false);
    assert.equal(hasActiveTrial({ status: "ACTIVE", endsAt: new Date("2026-09-10T12:00:00Z") }, now), false);
    assert.equal(hasActiveTrial({ status: "CONVERTED", endsAt: new Date("2026-10-10T12:00:00Z") }, now), false);
    assert.equal(hasActiveTrial({ status: "ACTIVE", endsAt: new Date("2026-10-10T12:00:00Z") }, now), true);
});
