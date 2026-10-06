import assert from "node:assert/strict";
import test from "node:test";
import { resolveBranding, resolveTenantBranding } from "../src/lib/branding.ts";

test("tenant menu uses the saved business name instead of seeded branding", () => {
    assert.equal(resolveTenantBranding({ clinicName: "Logicapp", brandName: "Zen CRM Belleza" }, "logicapp").brandName, "Logicapp");
    assert.equal(resolveTenantBranding({ clinicName: "Zen CRM Belleza" }, "Logicapp").brandName, "Logicapp");
});

test("separate tenants never reuse one another's title", () => {
    assert.equal(resolveTenantBranding(null, "Logicapp").brandName, "Logicapp");
    assert.equal(resolveTenantBranding(null, "Glow UP").brandName, "Glow UP");
});

test("business identity keeps its casing, logo and favicon; legacy branding is unchanged", () => {
    const source = { clinicName: "logicapp", brandName: "Marca anterior", brandLogoUrl: "/logo.png", brandFaviconUrl: "/favicon.png" };
    assert.deepEqual(resolveTenantBranding(source, "Logicapp"), { brandName: "logicapp", brandLogoUrl: "/logo.png", brandFaviconUrl: "/favicon.png" });
    assert.equal(resolveBranding(source).brandName, "Marca anterior");
});
