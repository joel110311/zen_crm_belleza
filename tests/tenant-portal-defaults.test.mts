import assert from "node:assert/strict";
import test from "node:test";
import { portalEnabledFromInput, portalNameAfterBusinessChange, resolveTenantPortalName } from "../src/lib/tenant-portal-defaults.ts";

test("first portal setup uses the tenant business name instead of seeded CRM branding", () => {
    assert.equal(resolveTenantPortalName("Zen CRM Belleza", "logicapp", "logicapp"), "logicapp");
    assert.equal(resolveTenantPortalName("Zen CRM Belleza", "Zen CRM Belleza", "logicapp"), "logicapp");
    assert.equal(resolveTenantPortalName(null, "logicapp", "logicapp"), "logicapp");
});

test("saved or customized portal titles are preserved", () => {
    assert.equal(resolveTenantPortalName("Agenda Logic", "logicapp", "logicapp"), "Agenda Logic");
    assert.equal(resolveTenantPortalName("Zen CRM Belleza", "logicapp", "logicapp", true), "Zen CRM Belleza");
    assert.equal(portalNameAfterBusinessChange("Agenda Logic", "logicapp", "Nuevo nombre"), "Agenda Logic");
    assert.equal(portalNameAfterBusinessChange("logicapp", "logicapp", "Nuevo nombre", true), "logicapp");
});

test("saving step one updates the untouched portal draft in the same wizard session", () => {
    assert.equal(portalNameAfterBusinessChange("Zen CRM Belleza", "logicapp", "logicapp"), "logicapp");
    assert.equal(portalNameAfterBusinessChange("logicapp", "logicapp", "Nuevo nombre"), "Nuevo nombre");
});

test("disabling the portal stays disabled on save and older clients cannot reactivate it", () => {
    assert.equal(portalEnabledFromInput(false, true), false);
    assert.equal(portalEnabledFromInput(undefined, false), false);
    assert.equal(portalEnabledFromInput(true, false), true);
    assert.equal(portalEnabledFromInput(undefined), true);
});
