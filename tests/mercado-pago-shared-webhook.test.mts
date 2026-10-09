import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import { resolveMercadoPagoWebhookPayment } from "../src/lib/billing/mercado-pago-runtime-helpers.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function harness(options: { reference?: string; signature?: boolean; app?: string; status?: number; failure?: boolean; live?: boolean } = {}) {
    const forwarded: { url: URL; options: RequestInit }[] = [];
    const local: string[] = [];
    let reads = 0;
    const mod = loadTsModule("src/app/api/webhooks/mercado-pago/shared/route.ts", {
        "next/server": { NextRequest, NextResponse },
        "@/lib/billing/mercado-pago": {
            getMercadoPagoWebhookRuntimeConfigurations: () => [{ environment: "production", applicationId: "228", webhookSecret: "private" }],
            verifyMercadoPagoWebhookSignature: () => options.signature !== false,
            getMercadoPagoPayment: async () => {
                reads++;
                if (options.failure) throw Object.assign(new Error("provider unavailable"), { status: 503 });
                return { id: 42, application_id: options.app ?? "228", live_mode: options.live ?? true, external_reference: options.reference ?? "eventiia:abc" };
            },
        },
        "@/lib/billing/mercado-pago-runtime-helpers": { resolveMercadoPagoWebhookPayment },
        "../route": { POST: async (request: Request) => { local.push(await request.text()); return Response.json({ destination: "crm" }); } },
    }, { fetch: async (url: URL, opts: RequestInit) => {
        forwarded.push({ url, options: opts }); return new Response(null, { status: options.status ?? 204 });
    } });
    const body = JSON.stringify({ type: "payment", data: { id: "42" }, external_reference: "eventiia:forged" });
    const request = (type = "payment", headers = true) => new NextRequest(`https://app.synapselogik.com/api/webhooks/mercado-pago/shared?data.id=42&type=${type}`, {
        method: "POST", body, headers: headers ? { "x-signature": "signed", "x-request-id": "rid", cookie: "private=session", authorization: "Bearer private" } : {},
    });
    return { post: mod.POST as (r: NextRequest) => Promise<Response>, request, forwarded, local, body, reads: () => reads };
}

test("shared webhook forwards only canonical Eventiia payments, preserving signed content without credentials", async () => {
    const h = harness(); assert.equal((await h.post(h.request())).status, 200);
    assert.equal(h.local.length, 0); assert.equal(h.forwarded.length, 1);
    const delivery = h.forwarded[0];
    assert.equal(String(delivery.url), "https://eventiia.mx/api/webhooks/mercado-pago?data.id=42&type=payment");
    assert.equal(delivery.options.body, h.body);
    assert.equal(new Headers(delivery.options.headers).get("x-signature"), "signed");
    assert.equal(new Headers(delivery.options.headers).get("x-request-id"), "rid");
    assert.equal(new Headers(delivery.options.headers).get("authorization"), null);
    assert.equal(new Headers(delivery.options.headers).get("cookie"), null);
    assert.equal(delivery.options.redirect, "manual");
});
test("canonical CRM owner overrides forged Eventiia reference in payload and keeps body readable", async () => {
    const h = harness({ reference: "crm:owned" }); assert.equal((await h.post(h.request())).status, 200);
    assert.equal(h.local[0], h.body); assert.equal(h.forwarded.length, 0);
});
for (const topic of ["subscription_preapproval", "subscription_authorized_payment"]) {
    test(`${topic} uses the existing CRM reconciliation rather than Eventiia`, async () => {
        const h = harness(); assert.equal((await h.post(h.request(topic))).status, 200);
        assert.equal(h.reads(), 0); assert.equal(h.local.length, 1); assert.equal(h.forwarded.length, 0);
    });
}
test("invalid signatures and missing headers never read provider or forward", async () => {
    const h = harness({ signature: false }); assert.equal((await h.post(h.request())).status, 401);
    assert.equal(h.reads(), 0); assert.equal(h.forwarded.length, 0);
    assert.equal((await h.post(h.request("payment", false))).status, 400);
});
test("foreign application cannot be forwarded or reconciled", async () => {
    const h = harness({ app: "other" }); assert.equal((await h.post(h.request())).status, 422);
    assert.equal(h.local.length + h.forwarded.length, 0);
});
for (const status of [301, 401, 500, 503]) {
    test(`Eventiia ${status} preserves provider retries, never reports delivered`, async () => {
        const h = harness({ status }); assert.equal((await h.post(h.request())).status, 502);
    });
}
test("provider outage or mismatched live mode fails closed for retry", async () => {
    for (const options of [{ failure: true }, { live: false }]) {
        const h = harness(options); assert.equal((await h.post(h.request())).status, 503);
        assert.equal(h.local.length + h.forwarded.length, 0);
    }
});
