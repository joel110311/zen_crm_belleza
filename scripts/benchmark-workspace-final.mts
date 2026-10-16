import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { inboxRenderHarness } from "../tests/helpers/inbox-render-harness.mts";
import { loadTsModule } from "../tests/helpers/load-ts-module.mts";
import { contactListSnapshot, getClientMetrics, type ContactTableItem, type ClientAppointment } from "../src/lib/contacts-view.ts";

const ref = process.argv[2] || "24a41110dd2d66c22db9f17769692392bd92effb";
const folder = "output/performance-final";
mkdirSync(folder, { recursive: true });
const baselinePage = `${folder}/baseline-inbox.tsx`, baselineContacts = `${folder}/baseline-contacts.ts`;
writeFileSync(baselinePage, execFileSync("git", ["show", `${ref}:src/app/dashboard/inbox/page.tsx`]));
writeFileSync(baselineContacts, execFileSync("git", ["show", `${ref}:src/lib/contacts-view.ts`]));
function median(run: () => unknown) {
    for (let n = 0; n < 4; n++) run();
    const values = Array.from({ length: 21 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
    return +values[10].toFixed(3);
}
const renders = [];
for (const [chats, messages] of [[300, 75], [5000, 1000]]) {
    const before = inboxRenderHarness(baselinePage, chats, messages), after = inboxRenderHarness("src/app/dashboard/inbox/page.tsx", chats, messages);
    before.render(); after.render(); let index = 0;
    const type = (subject: typeof before) => { subject.state.inputText = `Escribiendo ${++index}`; subject.render(); };
    const beforeMs = median(() => type(before)), afterMs = median(() => type(after));
    assert.ok(afterMs < beforeMs); assert.equal(after.counters.dateFormats, 0);
    renders.push({ chats, messages, beforeMs, afterMs, beforeCounters: { ...before.counters }, afterCounters: { ...after.counters } });
}

const original = loadTsModule(baselineContacts, {}).getClientMetrics as typeof getClientMetrics;
const now = new Date("2026-10-16T12:00:00Z");
let seed = 16388;
const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
function contact(size: number): ContactTableItem {
    const appointments = Array.from({ length: size }, (_, i): ClientAppointment => ({ id: `a-${i}`, title: ["Corte", "Color", "Manicure"][random(3)], appointmentType: "consulta", serviceId: "service", patientId: "patient", specialistId: "staff",
        notes: "Preferencias del cliente y detalles de la cita. ".repeat(8), source: "crm", isOverbook: false, visitMode: "in_person", meetStatus: "none", meetLink: null, remindersOptOut: false, googleCalendarId: null,
        startTime: new Date(now.getTime() + (random(150) - 100) * 86_400_000), endTime: new Date(now.getTime() + (i - 100) * 86_400_000 + 3_600_000), status: ["scheduled", "completed", "no_show", "cancelled"][random(4)], confirmationStatus: "pending" }));
    return { id: "client", name: "Ana", lastName: "Torres", phone: "5500000000", tags: ["Cliente", "entry_global_internal"], sourceType: "wuzapi", createdAt: now, whatsappAvatarUrl: null, appointments, patients: [{ id: "patient", appointments: appointments.slice(0, random(size || 1)) }] };
}
for (let n = 0; n < 1200; n++) {
    const input = contact(random(180));
    assert.equal(JSON.stringify(getClientMetrics(input, now)), JSON.stringify(original(input, now)), `Equivalent history ${n}`);
}
const clients = contact(120), compact = contactListSnapshot(clients, now);
const beforeBytes = Buffer.byteLength(JSON.stringify(clients)), afterBytes = Buffer.byteLength(JSON.stringify(compact));
const report = { baseline: ref, environment: process.version, renderConstructionOnly: true, renders, contactHistoriesEquivalent: 1200,
    client120Appointments: { beforeBytes, afterBytes, reductionPercent: +(100 * (1 - afterBytes / beforeBytes)).toFixed(2), metricsBeforeMs: median(() => original(clients, now)), metricsAfterMs: median(() => getClientMetrics(clients, now)) },
    limitations: "Synthetic same-input CPU and serialized payload measurements; excludes browser paint, network and production database latency. No chats or history deleted." };
writeFileSync(`${folder}/benchmark-final.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
