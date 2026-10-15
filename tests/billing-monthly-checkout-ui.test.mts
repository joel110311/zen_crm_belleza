import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasActiveTrial, shouldOfferBillingPortal } from "../src/lib/billing/provider-policy.ts";
import { RECURRING_CONSENT_VERSION } from "../src/lib/billing/recurring-policy.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as billingPresentation from "../src/lib/billing/presentation.ts";
import * as planCatalog from "../src/lib/plan-catalog.ts";

const controls = loadTsModule("src/app/billing/[tenantSlug]/recurring-controls.tsx", {
    "./billing.module.css": {}, "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/lib/billing/recurring-policy": { RECURRING_CONSENT_VERSION },
});
const checkoutProps = { tenantSlug: "logicapp", planSlug: "esencial", price: "$299.00", amountCents: 29900, currency: "MXN", disabled: false };

async function page(recurringEnabled: boolean) {
    const plan = { id: "plan", slug: "esencial", name: "Esencial", currency: "MXN", monthlyAmountCents: 29900, limits: { chatbotMessagesPerMonth: 1000 }, features: { chatbot: true }, prices: [] };
    const mod = loadTsModule("src/app/billing/[tenantSlug]/page.tsx", {
        "next/navigation": { notFound() { throw new Error("not found"); }, redirect() { throw new Error("redirect"); } },
        "next/link": (props: React.ComponentProps<"a">) => React.createElement("a", props),
        "./billing.module.css": {},
        "@/lib/billing/presentation": billingPresentation,
        "./billing-actions": { BillingActions: ({ planSlug }: { planSlug?: string }) => planSlug ? React.createElement("button", {}, "Pagar solo un mes") : null },
        "./billing-status-refresh": { BillingStatusRefresh: () => null },
        "./recurring-controls": controls,
        "./plan-change-actions": { PlanChangeActions: () => null },
        "@/lib/billing/mercado-pago": { isMercadoPagoSubscriptionsEnabled: () => recurringEnabled },
        "@/lib/billing/context": { requireBillingOwner: async () => ({ tenant: { tenantId: "tenant", slug: "logicapp", displayName: "Logicapp" } }) },
        "@/lib/billing/provider": { getActiveBillingProvider: () => "MERCADO_PAGO" },
        "@/lib/billing/provider-policy": { hasActiveTrial, shouldOfferBillingPortal },
        "@/lib/plan-catalog": planCatalog,
        "@/lib/control-db": { getControlDb: () => ({
            plan: { findMany: async () => [plan] }, trial: { findUnique: async () => null },
            subscription: { findMany: async () => [] }, billingSelection: { findUnique: async () => null },
            mercadoPagoAgreement: { findFirst: async () => null },
        }) },
    });
    const tree = await (mod.default as (props: unknown) => Promise<React.ReactNode>)({ params: Promise.resolve({ tenantSlug: "logicapp" }), searchParams: Promise.resolve({}) });
    return renderToStaticMarkup(tree);
}

test("enabled monthly billing renders a single subscription CTA, no one-time checkout", async () => {
    const html = await page(true);
    assert.match(html, /Contratar plan mensual/);
    assert.match(html, /Renovación mensual automática hasta que canceles/);
    assert.match(html, /no necesitas hacer un pago por separado/);
    assert.match(html, /\$299\.00/);
    assert.match(html, /1,000 respuestas al mes/);
    assert.match(html, /1 o 2 lugares/);
    assert.match(html, /href="\/delete-account"/);
    assert.match(html, /Solicitar eliminación de mi cuenta/);
    assert.doesNotMatch(html, /Pagar solo un mes|paga solo un mes/);
    assert.match(html, /type="checkbox"/);
    assert.doesNotMatch(html, /checked=""/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Contratar plan mensual/);
});
test("disabled recurring feature retains the explicit legacy one-time fallback without claiming renewal", async () => {
    const html = await page(false);
    assert.match(html, /Pagar solo un mes/);
    assert.match(html, /sin renovación automática/);
    assert.doesNotMatch(html, /Contratar plan mensual/);
    assert.match(html, /href="\/delete-account"/);
});

for (const consent of [false, true]) {
    test(`monthly CTA ${consent ? "creates only the recurring authorization" : "does not send anything without consent"}`, async () => {
        let hook = 0;
        const requests: { url: string; body: Record<string, unknown> }[] = [];
        const navigations: string[] = [];
        const mod = loadTsModule("src/app/billing/[tenantSlug]/recurring-controls.tsx", {
            react: { useState: () => [[consent, false, null][hook++], () => {}] },
            "./billing.module.css": {}, "next/navigation": { useRouter: () => ({ refresh() {} }) },
            "@/lib/billing/recurring-policy": { RECURRING_CONSENT_VERSION },
        }, { fetch: async (url: string, options: RequestInit) => {
            requests.push({ url, body: JSON.parse(String(options.body)) });
            return Response.json({ url: "https://www.mercadopago.com.mx/subscriptions/checkout" });
        }, window: { location: { assign: (url: string) => navigations.push(url) } } });
        const tree = (mod.RecurringCheckout as (props: typeof checkoutProps) => React.ReactElement<{ children: React.ReactElement[] }>)(checkoutProps);
        const button = tree.props.children.find(child => child?.type === "button")!;
        await (button.props as { onClick: () => Promise<void> }).onClick();
        assert.equal(requests.length, consent ? 1 : 0);
        assert.equal(navigations.length, consent ? 1 : 0);
        if (consent) {
            assert.equal(requests[0].url, "/api/billing/subscription");
            assert.equal(requests[0].body.action, "start");
            assert.equal(requests[0].body.amountCents, 29900);
            assert.equal(requests[0].body.tenantSlug, "logicapp");
            assert.equal(requests[0].body.consent, true);
            assert.equal(requests[0].body.consentVersion, RECURRING_CONSENT_VERSION);
        }
    });
}
