import assert from "node:assert/strict";
import test from "node:test";
import { onboardingExitAdvice, shouldGuardOnboardingLink } from "../src/lib/onboarding-navigation.ts";

test("module and external links warn, including the Specialists link", () => {
    const current = "https://app.synapselogik.com/t/logicapp/onboarding";
    assert.equal(shouldGuardOnboardingLink("/t/logicapp/specialists", current), true);
    assert.equal(shouldGuardOnboardingLink("/t/logicapp/dashboard", current), true);
    assert.equal(shouldGuardOnboardingLink("https://business.facebook.com/billing_hub", current), true);
    assert.equal(shouldGuardOnboardingLink("#portal", current), false);
    assert.equal(shouldGuardOnboardingLink(current, current), false);
});

test("recommendations identify where to complete optional setup afterwards", () => {
    assert.match(onboardingExitAdvice("/t/logicapp/specialists"), /Negocio → Especialistas/);
    assert.match(onboardingExitAdvice("channels"), /Configuración → Canal WhatsApp/);
    assert.match(onboardingExitAdvice("https://business.facebook.com/billing_hub"), /Configuración → Canal WhatsApp/);
});
