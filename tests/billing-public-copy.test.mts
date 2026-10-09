import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("onboarding never advertises the paused Stripe card-storage flow", async () => {
    const wizard = await readFile(new URL("../src/app/t/[tenantSlug]/onboarding/onboarding-wizard.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(wizard, /Stripe guardará|primer cobro ocurrirá|Puedes dejar preparado tu plan sin pagar hoy/);
    assert.match(wizard, /Consultar los planes no registra una tarjeta ni programa un cobro/);
});

test("billing preserves honest one-time wording only for the subscriptions-disabled fallback", async () => {
    const billing = await readFile(new URL("../src/app/billing/[tenantSlug]/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(billing, /Stripe realizará el primer cobro|Tu tarjeta quedó protegida en Stripe|hoy pagas \$0/);
    assert.match(billing, /Cada pago cubre una mensualidad, sin renovación automática/);
});
