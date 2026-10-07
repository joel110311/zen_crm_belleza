import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BRAND_NAME, normalizeDefaultBusinessText, resolveBranding, resolveTenantBranding } from "../src/lib/branding.ts";

test("tenant menu uses the saved business name instead of seeded branding", () => {
    assert.equal(resolveTenantBranding({ clinicName: DEFAULT_BRAND_NAME }, "Logicapp").brandName, "Logicapp");
    assert.equal(resolveTenantBranding({ clinicName: "Logicapp", brandName: "Zen CRM Belleza" }, "logicapp").brandName, "Logicapp");
    assert.equal(resolveTenantBranding({ clinicName: "Zen CRM Belleza" }, "Logicapp").brandName, "Logicapp");
});

test("old product defaults use the new neutral name while custom businesses keep their identity", () => {
    assert.equal(resolveBranding({ brandName: "Zen CRM Belleza" }).brandName, "Zen CRM Cuidado Personal");
    assert.equal(resolveBranding(null).brandName, "Zen CRM Cuidado Personal");
    assert.equal(normalizeDefaultBusinessText("Servicios de belleza"), "Servicios de cuidado personal");
    assert.equal(normalizeDefaultBusinessText("Zen CRM Belleza\nServicios de belleza\nDireccion del negocio"), "Zen CRM Cuidado Personal\nServicios de cuidado personal\nDireccion del negocio");
    assert.equal(resolveBranding({ brandName: "Salón Belleza Natural" }).brandName, "Salón Belleza Natural");
    assert.equal(normalizeDefaultBusinessText("toString"), "toString");
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
