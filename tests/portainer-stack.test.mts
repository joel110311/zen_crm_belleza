import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

test("Portainer stack keeps homogeneous environment syntax, dedicated web admin variables and rolling update protection", () => {
    const stack = yaml.load(fs.readFileSync("portainer-stack.crm-belleza.yml", "utf8"));
    for (const [name, service] of Object.entries(stack.services) as Array<[string, { environment?: unknown[] }]>) {
        assert.ok(!service.environment || service.environment.every(entry => typeof entry === "string"), `${name}: use KEY=value strings, never - KEY: value`);
        if (name !== "belleza-crm") assert.equal(service.environment?.some(entry => /^ADMIN_(USERNAME|PASSWORD)=/.test(String(entry))) ?? false, false);
    }
    const web = stack.services["belleza-crm"];
    assert.equal(web.image, "ghcr.io/joel110311/zen_crm_belleza:latest");
    assert.ok(web.environment.includes("ADMIN_USERNAME=${ADMIN_USERNAME:-adminjoel}"));
    assert.ok(web.environment.includes("ADMIN_PASSWORD=${ADMIN_PASSWORD:-}"));
    assert.equal(web.deploy.update_config.order, "start-first");
    assert.equal(web.deploy.update_config.failure_action, "rollback");
    assert.equal(web.deploy.rollback_config.order, "start-first");
});
