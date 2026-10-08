import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import { BRAND_LOTUS_PATHS, buildLotusFaviconSvg } from "../src/lib/brand-lotus.ts";
import { DEFAULT_BRAND_FAVICON_URL, DEFAULT_BRAND_APPLE_ICON_URL, getBrandingIcons, resolveBranding, resolveTenantBranding } from "../src/lib/branding.ts";

test("SVG, URL predeterminada y servicios comparten la misma flor de loto", async () => {
    const svg = await readFile(new URL(`../public${DEFAULT_BRAND_FAVICON_URL}`, import.meta.url), "utf8");
    assert.equal(svg.trim(), buildLotusFaviconSvg());
    assert.equal((svg.match(/<path /g) || []).length, 5);
    for (const d of BRAND_LOTUS_PATHS) assert.ok(svg.includes(`d="${d}"`));
    assert.equal(resolveBranding(null).brandFaviconUrl, DEFAULT_BRAND_FAVICON_URL);
    assert.equal(resolveBranding({ brandFaviconUrl: "/brand/zen-favicon.svg" }).brandFaviconUrl, DEFAULT_BRAND_FAVICON_URL);
    await access(new URL(`../public${DEFAULT_BRAND_APPLE_ICON_URL}`, import.meta.url));
});
test("marca blanca conserva favicon personalizado en metadata y no mezcla tenants", () => {
    const custom = resolveTenantBranding({ brandFaviconUrl: "/api/media/mi-icono.png", brandLogoUrl: "/mi-logo.png" }, "Mi Spa");
    assert.equal(custom.brandLogoUrl, "/mi-logo.png");
    assert.deepEqual(getBrandingIcons(custom), { icon: [{ url: "/api/media/mi-icono.png" }], shortcut: "/api/media/mi-icono.png", apple: "/api/media/mi-icono.png" });
    const other = getBrandingIcons(resolveTenantBranding(null, "Otro Spa"));
    assert.equal(other.icon[0].url, DEFAULT_BRAND_FAVICON_URL);
    assert.equal(other.apple, DEFAULT_BRAND_APPLE_ICON_URL);
});
test("favicon ICO incluye tamaños 16, 32 y 48 y PNG Apple tiene 180px", async () => {
    const ico = await readFile(new URL("../src/app/favicon.ico", import.meta.url));
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    assert.deepEqual([ico[6], ico[22], ico[38]], [16, 32, 48]);
    const png = await readFile(new URL(`../public${DEFAULT_BRAND_APPLE_ICON_URL}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 180);
    assert.equal(png.readUInt32BE(20), 180);
});
