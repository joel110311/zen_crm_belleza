import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { LANDING_PREVIEW_OFFER, landingMoney, landingStartingPrice, landingTrialLabel } from "../src/lib/landing-offer.ts";

test("landing preview has current monthly prices and a 14-day introductory trial", () => {
    assert.deepEqual(LANDING_PREVIEW_OFFER.plans.map((plan) => plan.monthlyAmountCents), [20000, 50000, 80000]);
    assert.equal(landingStartingPrice(LANDING_PREVIEW_OFFER.plans), 20000);
    assert.equal(landingTrialLabel(14), "Probar gratis 14 días");
    assert.equal(landingMoney(20000), "$200");
});

test("landing follows policy changes and never advertises an unavailable offer", () => {
    assert.equal(landingTrialLabel(7), "Probar gratis 7 días");
    assert.equal(landingTrialLabel(null), "Crear mi cuenta");
    assert.equal(landingStartingPrice([]), null);
    assert.equal(landingStartingPrice([{ ...LANDING_PREVIEW_OFFER.plans[0], monthlyAmountCents: null }]), null);
    assert.equal(landingStartingPrice([{ ...LANDING_PREVIEW_OFFER.plans[0], currency: "USD" }]), null);
    assert.equal(landingStartingPrice([{ ...LANDING_PREVIEW_OFFER.plans[0], monthlyAmountCents: 25000 }]), 25000);
});

test("public landing uses live catalog, safe routes and no unsupported legacy claims", async () => {
    const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const landing = await readFile(new URL("../src/components/marketing/crm-landing.tsx", import.meta.url), "utf8");
    const offer = await readFile(new URL("../src/lib/billing/public-offer.ts", import.meta.url), "utf8");
    assert.match(page, /isPublicTenantSignupEnabled/);
    assert.match(page, /getPublicLandingOffer/);
    assert.match(landing, /href="\/signup"/);
    assert.match(landing, /href="\/login"/);
    assert.match(landing, /<BrandLogo/);
    assert.match(landing, /id="inicio"/);
    assert.match(landing, /href="#inicio" className="landing-brand"/);
    assert.doesNotMatch(landing, /Acceso beta|facturación CFDI|n8n|Teknobyte|Laura Vega|reduce errores a cero/i);
    assert.match(offer, /isActive: true/);
    assert.doesNotMatch(offer, /accessToken|providerCustomerId|externalPriceId/);
});

test("decorative sparkle marks have been removed from the CRM", async () => {
    async function inspect(directory: URL): Promise<void> {
        const files = await readdir(directory, { withFileTypes: true });
        for (const file of files) {
            const url = new URL(file.name + (file.isDirectory() ? "/" : ""), directory);
            if (file.isDirectory()) await inspect(url);
            else if (/\.(tsx?|svg)$/.test(file.name)) assert.doesNotMatch(await readFile(url, "utf8"), /\b(?:Sparkles|Sparkle|WandSparkles|Wand2)\b|✨/, url.pathname);
        }
    }
    await inspect(new URL("../src/", import.meta.url));
});

test("14-day trial migration preserves existing trials and versions the policy", async () => {
    const migration = await readFile(new URL("../prisma/control-plane/migrations/20261006010000_fourteen_day_introductory_trial/migration.sql", import.meta.url), "utf8");
    assert.match(migration, /INSERT INTO "TrialPolicy"/);
    assert.doesNotMatch(migration, /UPDATE "Trial"/);
    assert.match(migration, /OPTIONAL_AFTER_ONBOARDING/);
    assert.match(migration, /"trialDays" = 14/);
});

test("renaming defaults stays consistent across legacy and tenant migrations", async () => {
    const files = ["legacy-runtime-migrations/20261006_personal_care_branding.sql", "migrations/20261006000000_personal_care_branding/migration.sql", "tenant-migrations/20261006000000_personal_care_branding/migration.sql"];
    const migrations = await Promise.all(files.map((file) => readFile(new URL(`../prisma/${file}`, import.meta.url), "utf8")));
    assert.equal(migrations[0], migrations[1]);
    assert.equal(migrations[0], migrations[2]);
    assert.doesNotMatch(migrations[0], /DELETE|DROP|portalSlug|WHERE.*LIKE/i);
});
