import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as landingOffer from "../src/lib/landing-offer.ts";
import * as planCatalog from "../src/lib/plan-catalog.ts";

test("public cards show all prices, recommendations and quotas from the live offer", () => {
    const mod = loadTsModule("src/components/marketing/crm-landing.tsx", {
        "next/image": () => null,
        "next/link": (props: React.ComponentProps<"a"> & { prefetch?: boolean }) => { const attributes = { ...props }; delete attributes.prefetch; return React.createElement("a", attributes); },
        "@/lib/branding": { DEFAULT_BRAND_NAME: "Zen CRM" },
        "@/components/brand/brand-logo": { BrandLogo: () => null },
        "@/lib/landing-offer": landingOffer,
        "@/lib/plan-catalog": planCatalog,
        "./chat-demo": { LandingChatDemo: () => null },
        "./landing-experience": { LandingExperience: ({ children }: { children: React.ReactNode }) => React.createElement("div", {}, children), RotatingBusiness: () => null },
        "./integration-marks": { GoogleCalendarMark: () => null, WhatsAppMark: () => null },
        "./landing.module.css": {},
    });
    const render = (offer: landingOffer.LandingOffer) => renderToStaticMarkup((mod.CrmLanding as (props: { offer: landingOffer.LandingOffer }) => React.ReactNode)({ offer }));
    const html = render(landingOffer.LANDING_PREVIEW_OFFER);
    for (const text of ["Planes simples y claros", "Plan Esencial", "Plan Crecimiento", "Plan Elite", "MX$299", "MX$499", "MX$799", "1,000 respuestas al mes", "3,000 respuestas al mes", "10,000 respuestas al mes", "1 o 2 lugares", "3 a 5 lugares", "6 o más sillas o multisucursal"]) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /sin chatbot|Automatiza|sin límite de respuestas/);
    assert.match(html, /Renovación automática mensual/);
    assert.doesNotMatch(html, /sin renovación automática|href="\/delete-account"/);
    const withoutRenewal = render({ ...landingOffer.LANDING_PREVIEW_OFFER, automaticRenewal: false });
    assert.doesNotMatch(withoutRenewal, /Renovación automática mensual/);
    assert.match(withoutRenewal, /Consulta las condiciones al contratar/);
    // A changed real price must be reflected; do not substitute a local marketing constant.
    assert.ok(render({ trialDays: null, plans: [{ ...landingOffer.LANDING_PREVIEW_OFFER.plans[0], monthlyAmountCents: 34900 }] }).includes("MX$349"));
    const unavailable = render({ trialDays: null, plans: [] });
    assert.doesNotMatch(unavailable, /MX\$299|MX\$499|MX\$799/);
    assert.match(unavailable, /Los precios no están disponibles/);
});

test("counter is discreet, reports the quota and exhaustion without claiming renewal during trial", () => {
    const snapshot = { tenantSlug: "negocio", usage: { used: 1000, limit: 1000, periodStart: "2026-10-01T12:00:00Z", periodEnd: "2026-11-01T12:00:00Z", isTrial: false } };
    let pathname = "/t/negocio/brain";
    const mod = loadTsModule("src/components/brain/chatbot-usage-counter.tsx", {
        react: { useEffect() {}, useState: () => [snapshot, () => {}] },
        "next/navigation": { usePathname: () => pathname },
    });
    const render = () => renderToStaticMarkup((mod.ChatbotUsageCounter as () => React.ReactNode)());
    assert.match(render(), /1,000 \/ 1,000 respuestas/);
    assert.match(render(), /Cupo agotado.*manualmente/);
    assert.match(render(), /text-xs/);
    snapshot.usage.isTrial = true;
    assert.match(render(), /Prueba hasta el/);
    assert.doesNotMatch(render(), /Se renueva el/);
    pathname = "/t/otro-negocio/brain";
    assert.doesNotMatch(render(), /1,000 \/ 1,000/);
    assert.match(render(), /Consultando consumo/);
});
