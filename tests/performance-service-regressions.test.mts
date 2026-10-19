import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as hours from "../src/lib/calendar/business-hours.ts";
import * as aiState from "../src/lib/ai/contact-state.ts";
import { validCalendarDateKey } from "../src/lib/calendar/date-key.ts";
import { mergeDuplicateContactRecords, type PrismaLikeClient } from "../src/lib/contact-deduplication.ts";
import * as replies from "../src/lib/bulk-campaign-replies.ts";

function automation(text: string, options: { state?: object; email?: string; type?: string; scoring?: boolean } = {}) {
    const updates: { data: Record<string, unknown> }[] = [], notes: unknown[] = [];
    const contact = { id: "contact", status: "customer", email: options.email || null, aiState: options.state || null };
    const db = {
        conversation: { findUnique: async () => ({ id: "chat", contactId: contact.id, contact }) },
        message: {
            findFirst: async (query: { where: { direction: string } }) => query.where.direction === "inbound" ? { content: text, type: options.type || "text", createdAt: new Date("2026-10-16T15:00:00Z") } : null,
            findMany: async () => Array.from({ length: 4 }, () => ({ content: text })),
            create: async (note: unknown) => { notes.push(note); },
        },
        contact: { update: async (update: { data: Record<string, unknown> }) => { updates.push(update); } },
        $transaction: async (run: (tx: unknown) => Promise<void>) => run(db),
    };
    const service = loadTsModule("src/lib/ai/lead-intelligence.ts", {
        "@/lib/db": { prisma: db }, "./contact-state": aiState,
        "@/lib/ai/openai": { generateCompletion: async () => '{"name":null,"declined":false}' },
        "@/lib/calendar/business-hours": hours,
    });
    return { updates, notes, run: () => (service.processLeadAutomationTurn as (input: unknown) => Promise<{ instruction: string | null; pendingCaptureField: string | null }>)({
        conversationId: "chat", latestUserMessage: text,
        settings: { leadScoringEnabled: options.scoring ?? true, captureLeadName: true, captureLeadEmail: true, leadInterestThreshold: 45, businessTimeZone: "America/Mexico_City" },
    }) };
}

test("AI capture and scoring work without a Deal, preserve customer status and save a private note", async () => {
    const subject = automation("Me llamo Ana Torres");
    const result = await subject.run();
    const state = subject.updates.find(update => update.data.aiState)?.data.aiState as Record<string, unknown>;
    assert.equal(state.capturedName, "Ana Torres");
    assert.ok(Number(state.score) >= 45); assert.equal(state.sameDayInboundCount, 4);
    assert.ok(subject.updates.some(update => update.data.name === "Ana" && update.data.lastName === "Torres"));
    assert.ok(subject.updates.every(update => !update.data.status));
    assert.equal(subject.notes.length, 1); assert.ok(result.instruction);
    const emailTurn = automation("Mi correo es ana@example.invalid", { state }); await emailTurn.run();
    assert.equal((emailTurn.updates[0].data.aiState as Record<string, unknown>).capturedEmail, "ana@example.invalid");
});
test("AI remembers a declined email and never extracts contact details from image text", async () => {
    const declined = automation("No quiero dar mi correo", { state: { score: 60, interestStatus: "interesado", pendingCaptureField: "email", nameCaptured: true } });
    await declined.run();
    assert.equal((declined.updates[0].data.aiState as Record<string, unknown>).emailDeclined, true);
    const media = automation("Me llamo Ana Torres ana@example.invalid", { type: "image" });
    await media.run();
    const state = media.updates[0].data.aiState as Record<string, unknown>;
    assert.equal(state.nameCaptured, false); assert.equal(state.emailCaptured, false); assert.equal(media.notes.length, 0);
});
test("existing email is persisted even with scoring disabled; unchanged stored state adds no update", async () => {
    const subject = automation("Hola", { email: "ana@example.invalid", scoring: false });
    await subject.run();
    const state = subject.updates[0].data.aiState as Record<string, unknown>;
    assert.equal(state.emailCaptured, true); assert.equal(state.capturedEmail, "ana@example.invalid");
    const unchanged = automation("Hola", { state, email: "ana@example.invalid", scoring: false });
    await unchanged.run(); assert.equal(unchanged.updates.length, 0);
});

function calendar(zone = "America/Mexico_City", denied = false) {
    const queries: { where: Record<string, unknown> }[] = [];
    let syncs = 0;
    const service = loadTsModule("src/app/actions/calendar.ts", {
        "@/lib/db": { prisma: { systemSettings: { findFirst: async () => ({ businessTimeZone: zone, googleCalendars: [{ isSelected: true, calendarId: "visible" }, { isSelected: false, calendarId: "hidden" }] }) }, appointment: { findMany: async (query: { where: Record<string, unknown> }) => { queries.push(query); return []; } } } },
        "next/cache": {}, "@/lib/calendar/appointments": {}, "@/lib/appointment-reminders": {}, "@/lib/system-settings": {}, "@/lib/operation-context": {}, "@/lib/calendar/client-selection": {},
        "@/lib/authz": { requirePermission: async () => { if (denied) throw new Error("Forbidden"); } },
        "@/lib/active-tenant-context": { getActiveTenantRuntimeContext: async () => ({ accessMode: "READ_ONLY" }) },
        "@/lib/tenant-request-routing": {},
        "@/lib/google-calendar": { syncGoogleCalendarToCrm: async () => { syncs++; } },
        "@/lib/calendar/business-hours": hours, "@/lib/calendar/draft": { validCalendarDateKey },
        "@/lib/operation-dates": { operationDateReference: (key: string, timeZone: string) => hours.zonedDateTimeToUtc(key, "12:00", timeZone) },
    }, { console: { ...console, error() {} } });
    return { queries, syncs: () => syncs, get: service.getAppointments as (input?: unknown) => Promise<unknown[]> };
}
test("calendar range uses business midnight and overlap, retains a deep-linked appointment and calendar visibility", async () => {
    const subject = calendar(); await subject.get({ rangeStart: "2026-10-01", rangeEnd: "2026-11-01", appointmentId: "outside-range", throwOnError: true });
    const where = JSON.parse(JSON.stringify(subject.queries[0].where));
    assert.deepEqual(where.AND[0].OR, [ { startTime: { lt: "2026-11-01T06:00:00.000Z" }, endTime: { gt: "2026-10-01T06:00:00.000Z" } }, { id: "outside-range" } ]);
    assert.deepEqual(where.OR, [{ googleCalendarId: null }, { googleCalendarId: { in: ["visible"] } }]);
    assert.equal(where.status.not, "cancelled"); assert.equal(subject.syncs(), 0);
});
test("calendar handles a 23-hour DST day, rejects invalid/wide ranges and authorizes before reads", async () => {
    const subject = calendar("America/New_York"); await subject.get({ rangeStart: "2026-03-08", rangeEnd: "2026-03-09", throwOnError: true });
    const where = subject.queries[0].where as { AND: { OR: { startTime: { lt: Date }; endTime: { gt: Date } }[] }[] };
    const overlap = where.AND[0].OR[0]; assert.equal(+overlap.startTime.lt - +overlap.endTime.gt, 23 * 3_600_000);
    for (const range of [["2026-02-30", "2026-03-01"], ["2026-10-02", "2026-10-01"], ["2026-01-01", "2026-12-31"]]) {
        await assert.rejects(subject.get({ rangeStart: range[0], rangeEnd: range[1], throwOnError: true }));
    }
    assert.equal(subject.queries.length, 1);
    const forbidden = calendar(undefined, true); await assert.rejects(forbidden.get()); assert.equal(forbidden.queries.length, 0);
    const full = calendar(); await full.get(); assert.equal(full.queries[0].where.AND, undefined);
    await full.get({ rangeStart: "1999-12-25", rangeEnd: "2000-02-15", throwOnError: true });
    await full.get({ rangeStart: "2100-11-24", rangeEnd: "2101-01-15", throwOnError: true });
});

test("merging duplicate contacts preserves AI capture and historical tags before deleting duplicates", async () => {
    const writes: { data: Record<string, unknown> }[] = []; const deleted: string[] = [];
    const db: PrismaLikeClient = {
        contact: { findMany: async () => [], update: async (data) => { writes.push(data as typeof writes[number]); }, delete: async (input) => { deleted.push((input.where as { id: string }).id); } },
        conversation: { update: async () => {}, delete: async () => {} }, message: { updateMany: async () => {} },
    };
    await mergeDuplicateContactRecords({ id: "primary", phone: "5500000000", tags: ["VIP"] }, [
        { id: "duplicate", phone: "5500000000", aiState: { capturedName: "Ana Torres", score: 60 }, tags: ["VIP", "Histórica"] },
        { id: "duplicate2", phone: "5500000000", aiState: { score: 0 }, tags: ["Otra"] },
    ], db);
    assert.equal((writes[0].data.aiState as Record<string, unknown>).score, 60);
    assert.equal(writes[1].data.aiState, undefined); assert.deepEqual(writes[1].data.tags, ["VIP", "Histórica", "Otra"]);
    assert.deepEqual(deleted, ["duplicate", "duplicate2"]);
});

test("contact enrichment saves the name/email without consulting archived opportunities", async () => {
    const updates: { data: Record<string, string> }[] = [], errors: unknown[] = [];
    const subject = loadTsModule("src/lib/ai-enrichment.ts", {
        "@/lib/db": { prisma: { contact: { findUnique: async () => ({ id: "contact", name: null, lastName: null, phone: "5500000000" }), update: async (update: typeof updates[number]) => { updates.push(update); } } } },
        "@/lib/ai/provider-keys": { resolveAiProviderKey: async () => "test-only" },
        "@/lib/ai/openai": { callGeminiGenerateContent: async () => '{"firstName":"Ana","lastName":"Torres","email":"ana@example.invalid"}' },
        "@/lib/ai/models": {}, "@/lib/contact-enrichment-guards": { hasExplicitCompanyDisclosure: () => false },
    }, { console: { ...console, log() {}, error: (value: unknown) => errors.push(value) } });
    await (subject.enrichContactFromMessage as (id: string, message: string) => Promise<void>)("contact", "Me llamo Ana Torres ana@example.invalid");
    assert.equal(errors.length, 0); assert.equal(updates[0].data.name, "Ana"); assert.equal(updates[0].data.lastName, "Torres"); assert.equal(updates[0].data.email, "ana@example.invalid");
});

test("campaign STOP still cancels queued follow-ups and records opt-out without Pipeline", async () => {
    const writes: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [], contacts: unknown[] = [];
    const db = {
        bulkCampaignRecipient: {
            findMany: async (input: { where: Record<string, unknown> }) => input.where.contactId ? [{ id: input.where.status ? "queued" : "sent", campaignId: "campaign" }] : [],
            count: async () => 0, updateMany: async (input: typeof writes[number]) => { writes.push(input); },
        },
        bulkCampaign: { findUnique: async () => null }, contact: { update: async (input: unknown) => { contacts.push(input); } },
        $transaction: async (input: unknown) => typeof input === "function" ? input(db) : Promise.all(input as Promise<unknown>[]),
    };
    const mocks = Object.fromEntries(["campaign-channels", "outbound-messages", "channel-delivery", "whatsapp-audio", "source-conversations", "message-source", "system-settings", "templates", "bulk-campaign-audience", "phone"].map(name => [`@/lib/${name}`, {}]));
    const subject = loadTsModule("src/lib/bulk-campaigns.ts", { ...mocks, "@/lib/db": { prisma: db }, "@/lib/calendar/business-hours": hours, "@/lib/bulk-campaign-replies": replies }, { console: { ...console, warn() {} } });
    const result = await (subject.markBulkCampaignReplyForContact as (id: string, chat: string, text: string) => Promise<{ optedOut: boolean }>)("contact", "chat", "STOP");
    assert.equal(result.optedOut, true); assert.equal(contacts.length, 1);
    assert.ok(writes.some(write => write.data.status === "skipped")); assert.ok(writes.some(write => write.data.status === "replied"));
});
