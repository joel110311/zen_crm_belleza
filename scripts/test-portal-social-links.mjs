import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/portal-social-links.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
vm.runInNewContext(compiled.outputText, { exports, URL, require: createRequire(import.meta.url) });
const { normalizePortalSocialLinks: normalize, publicPortalSocialLinks: publicLinks } = exports;
const rows = [
    { network: "instagram", url: " https://instagram.com/example ", enabled: true },
    { network: "tiktok", url: "https://tiktok.com/@private", enabled: false },
];
assert.equal(normalize(rows, true).length, 2, "Hidden links must remain editable");
assert.equal(publicLinks(rows).length, 1, "Hidden links must not be serialized publicly");
assert.equal(publicLinks(rows)[0].url, "https://instagram.com/example");
assert.equal(publicLinks(undefined).length, 0);
for (const url of ["javascript:alert(1)", "data:text/html,hello", "https://user:secret@example.com", "not a url"]) {
    assert.throws(() => normalize([{ network: "website", url, enabled: true }], true));
    assert.equal(publicLinks([{ network: "website", url, enabled: true }]).length, 0);
}
assert.throws(() => normalize([{ network: "facebook", url: "", enabled: true }], true));
assert.throws(() => normalize([rows[0], rows[0]], true));
assert.throws(() => normalize([{ ...rows[0], enabled: "false" }], true));
assert.throws(() => normalize([{ ...rows[0], network: "unknown" }], true));
assert.equal(publicLinks([{ ...rows[0], enabled: false }]).length, 0);
console.log("Portal social links: validation, private/public filtering and unsafe URL tests passed.");
