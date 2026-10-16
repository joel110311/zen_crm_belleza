import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function fixture(stored: string | null = null, blocked = false) {
    const values = new Map<string, string>(); if (stored) values.set("zen-color-theme-v3", stored);
    const attributes = new Map<string, string>();
    const globals = {
        window: { localStorage: { getItem(key: string) { if (blocked) throw new Error("storage denied"); return values.get(key) ?? null; }, setItem(key: string, value: string) { if (blocked) throw new Error("storage denied"); values.set(key, value); } } },
        document: { documentElement: { setAttribute(key: string, value: string) { attributes.set(key, value); } } },
    };
    const mod = loadTsModule("src/lib/color-theme.ts", {}, globals) as {
        COLOR_THEMES: readonly string[]; DEFAULT_COLOR_THEME: string;
        getColorThemeInitScript(): string; readStoredColorTheme(): string;
        applyColorTheme(theme: string): void; persistColorTheme(theme: string): void;
    };
    return { mod, globals, values, attributes };
}

test("every supported theme restores consistently before first paint and after mount, including Pink", () => {
    const { mod: catalog } = fixture(); assert.ok(catalog.COLOR_THEMES.includes("pink")); assert.ok(catalog.COLOR_THEMES.includes("gold"));
    for (const theme of catalog.COLOR_THEMES) {
        const f = fixture(theme); vm.runInNewContext(f.mod.getColorThemeInitScript(), f.globals);
        assert.equal(f.attributes.get("data-color-theme"), theme); assert.equal(f.mod.readStoredColorTheme(), theme);
    }
});

test("selecting Pink persists across reloads and does not rename the existing green storage key", () => {
    const f = fixture("green"); assert.equal(f.mod.readStoredColorTheme(), "green");
    f.mod.applyColorTheme("pink"); f.mod.persistColorTheme("pink");
    assert.equal(f.attributes.get("data-color-theme"), "pink"); assert.equal(f.values.get("zen-color-theme-v3"), "pink");
    vm.runInNewContext(f.mod.getColorThemeInitScript(), f.globals); assert.equal(f.attributes.get("data-color-theme"), "pink");
    f.mod.persistColorTheme("green"); assert.equal(f.mod.readStoredColorTheme(), "green");
});

test("unrecognized stored values fall back consistently without becoming root attributes", () => {
    for (const stored of [null, "old-unknown-theme", '<script>alert(1)</script>']) {
        const f = fixture(stored); vm.runInNewContext(f.mod.getColorThemeInitScript(), f.globals);
        assert.equal(f.attributes.get("data-color-theme"), f.mod.DEFAULT_COLOR_THEME); assert.equal(f.mod.readStoredColorTheme(), f.mod.DEFAULT_COLOR_THEME);
    }
});

test("blocked browser storage leaves the theme usable and does not crash startup or selection", () => {
    const f = fixture(null, true); vm.runInNewContext(f.mod.getColorThemeInitScript(), f.globals);
    assert.equal(f.mod.readStoredColorTheme(), f.mod.DEFAULT_COLOR_THEME);
    assert.doesNotThrow(() => { f.mod.applyColorTheme("pink"); f.mod.persistColorTheme("pink"); }); assert.equal(f.attributes.get("data-color-theme"), "pink");
});


test("Gold persists independently from Pink and restores from the same catalog at startup", () => {
    const f = fixture("pink"); f.mod.applyColorTheme("gold"); f.mod.persistColorTheme("gold");
    assert.equal(f.mod.readStoredColorTheme(), "gold");
    vm.runInNewContext(f.mod.getColorThemeInitScript(), f.globals); assert.equal(f.attributes.get("data-color-theme"), "gold");
});
