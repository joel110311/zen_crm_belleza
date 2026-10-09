import assert from "node:assert/strict";
import test from "node:test";
import { resolveMercadoPagoCredentials, resolveMercadoPagoWebhookPayment, resolveMercadoPagoApplicationId } from "../src/lib/billing/mercado-pago-runtime-helpers.ts";

test("test seller and production application IDs stay separate, with backward-compatible fallback", () => {
    const env = { MERCADO_PAGO_APPLICATION_ID: "common", MERCADO_PAGO_TEST_APPLICATION_ID: "test-seller", MERCADO_PAGO_PRODUCTION_APPLICATION_ID: "production" };
    assert.equal(resolveMercadoPagoApplicationId(env, "test"), "test-seller");
    assert.equal(resolveMercadoPagoApplicationId(env, "production"), "production");
    assert.equal(resolveMercadoPagoApplicationId({ MERCADO_PAGO_APPLICATION_ID: "common", MERCADO_PAGO_TEST_APPLICATION_ID: " " }, "test"), "common");
});

test("Eventtia's shared webhook secret supports test and production with separate tokens", () => {
    const env = {
        MERCADO_PAGO_TEST_ACCESS_TOKEN: "test-token",
        MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "production-token",
        MERCADO_PAGO_WEBHOOK_SECRET: "shared-secret",
    };
    assert.deepEqual(resolveMercadoPagoCredentials(env, "production", "test"), {
        accessToken: "production-token", webhookSecret: "shared-secret",
    });
    assert.deepEqual(resolveMercadoPagoCredentials(env, "test", "test"), {
        accessToken: "test-token", webhookSecret: "shared-secret",
    });
});

test("explicit webhook secrets take precedence and legacy tokens never cross environments", () => {
    const env = {
        MERCADO_PAGO_ACCESS_TOKEN: "legacy-test-token",
        MERCADO_PAGO_WEBHOOK_SECRET: "shared-secret",
        MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "production-secret",
    };
    assert.deepEqual(resolveMercadoPagoCredentials(env, "production", "test"), {
        accessToken: "", webhookSecret: "production-secret",
    });
});

const runtimes = [{ environment: "test" as const }, { environment: "production" as const }];

test("a shared signature resolves a production payment through the production credentials", async () => {
    const tried: string[] = [];
    const resolved = await resolveMercadoPagoWebhookPayment("123", runtimes, async (runtime) => {
        tried.push(runtime.environment);
        if (runtime.environment === "test") throw Object.assign(new Error("Not found"), { status: 404 });
        return { id: 123, live_mode: true };
    });
    assert.equal(resolved.runtime.environment, "production");
    assert.deepEqual(tried, ["test", "production"]);
});

test("a payment's live_mode determines the environment even when both tokens can read it", async () => {
    const resolved = await resolveMercadoPagoWebhookPayment("123", runtimes,
        async () => ({ id: 123, live_mode: true }));
    assert.equal(resolved.runtime.environment, "production");
});

test("missing live_mode and a mismatched payment ID cannot activate access", async () => {
    await assert.rejects(resolveMercadoPagoWebhookPayment("123", runtimes, async () => ({ id: 123 })));
    await assert.rejects(resolveMercadoPagoWebhookPayment("123", runtimes, async () => ({ id: 456, live_mode: false })));
});

test("provider outages remain retryable rather than trying a different environment", async () => {
    const error = Object.assign(new Error("Provider unavailable"), { status: 503 });
    await assert.rejects(resolveMercadoPagoWebhookPayment("123", runtimes, async () => { throw error; }), error);
});
