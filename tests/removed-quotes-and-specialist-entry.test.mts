import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("retira cotizador y todos sus accesos sin retirar adjuntos, respuestas ni campañas", async () => {
    const inbox = await source("src/app/dashboard/inbox/page.tsx");
    const templates = await source("src/app/dashboard/templates/page.tsx");
    assert.doesNotMatch(inbox, /QuoteBuilder|quoteBuilderOpen|handleQuoteGenerated|Cotizar|Crear cotizacion/);
    assert.doesNotMatch(templates, /QuoteBuilder|value: "quotes"|Cotizaciones/);
    for (const panel of ["TemplateManagerPanel", "MetaTemplateRequestPanel", "BulkCampaignManagerPanel"]) assert.ok(templates.includes(panel));
    assert.ok(inbox.includes("/api/upload"));
    assert.ok(inbox.includes("quotedSnippet")); // Responder a un mensaje no es una cotizacion.
    await assert.rejects(access(new URL("../src/components/quotes/quote-builder-panel.tsx", import.meta.url)));
    const packages = JSON.parse(await source("package.json"));
    assert.equal(packages.dependencies.jspdf, undefined);
    assert.equal(packages.dependencies["html-to-image"], undefined);
});
test("especialistas tiene alta visible y reutiliza guardado existente con usuario opcional", async () => {
    const panel = await source("src/components/settings/specialist-manager-panel.tsx");
    assert.match(panel, /onClick=\{handleNew\}/);
    assert.match(panel, /<Dialog open=\{isFormOpen\}/);
    assert.match(panel, /await saveSpecialist\(/);
    assert.match(panel, /userId: form.userId === "none" \? null : form.userId/);
    assert.match(panel, /setIsFormOpen\(false\)/);
    assert.match(panel, /formBaseline/);
});
