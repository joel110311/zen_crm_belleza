import test from "node:test";
import assert from "node:assert/strict";
import { calendarQueryWindow } from "../src/lib/calendar/query-window.ts";
import { contactListSnapshot, getClientMetrics, type ContactTableItem, type ClientAppointment } from "../src/lib/contacts-view.ts";
import { mergeInboxSnapshots, sameInboxSnapshot } from "../src/lib/inbox-snapshots.ts";

test("unchanged snapshots keep references while contact, delivery, assignment and intelligence changes remain visible", () => {
    const entry = { id: "a", date: new Date("2026-10-16"), contact: { name: "Ana" }, messages: [{ content: "Hola", status: "sent" }], assigned: "owner", intelligence: { score: 25 } };
    const existing = [entry];
    const fresh = { ...entry, date: new Date(entry.date), contact: { ...entry.contact }, messages: [{ ...entry.messages[0] }] };
    assert.equal(mergeInboxSnapshots(existing, [fresh], (row) => row.date.getTime(), 5000), existing);
    for (const changed of [{ ...fresh, contact: { name: "Ana Torres" } }, { ...fresh, messages: [{ content: "Hola", status: "read" }] }, { ...fresh, assigned: "staff" }, { ...fresh, intelligence: { score: 75 } }]) {
        assert.equal(sameInboxSnapshot(entry, changed), false);
        assert.equal(mergeInboxSnapshots(existing, [changed], (row) => row.date.getTime(), 5000)[0], changed);
    }
});
test("5,000 conversations remain searchable and ordered; merging a page does not discard older loaded chats", () => {
    const entries = Array.from({ length: 5000 }, (_, index) => ({ id: String(index), time: 5000 - index }));
    const merged = mergeInboxSnapshots(entries, [{ id: "0", time: 5001 }], (row) => row.time, 5000);
    assert.equal(merged.length, 5000); assert.equal(merged[4999].id, "4999");
    const added = mergeInboxSnapshots(merged, [{ id: "new", time: 6000 }], (row) => row.time, 5000);
    assert.equal(added[0].id, "new"); assert.equal(added.length, 5000);
});
test("calendar windows include full month grids, adjacent weeks, leap years and year boundaries", () => {
    assert.deepEqual(calendarQueryWindow("2026-12-31"), { start: "2026-11-24", end: "2027-01-15" });
    assert.deepEqual(calendarQueryWindow("2028-02-29"), { start: "2028-01-25", end: "2028-03-15" });
    assert.deepEqual(calendarQueryWindow("2026-10-01"), calendarQueryWindow("2026-10-31"));
    assert.throws(() => calendarQueryWindow("2026-02-30"));
});
test("the compact client list preserves metrics, export fields, patient IDs and every editable field on action appointments", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const appointments = Array.from({ length: 120 }, (_, index): ClientAppointment => ({
        id: String(index), title: index % 2 ? "Manicure" : "Corte", appointmentType: "consulta", serviceId: "service", patientId: "patient", specialistId: "staff",
        notes: "Información de edición".repeat(40), source: "portal", isOverbook: false, visitMode: "virtual", meetStatus: "ready", meetLink: "https://meet.example.invalid/test", remindersOptOut: true,
        googleCalendarId: "calendar", startTime: new Date(now.getTime() + (index - 90) * 86_400_000), endTime: new Date(now.getTime() + (index - 90) * 86_400_000 + 3_600_000),
        status: index < 90 ? "completed" : "scheduled", confirmationStatus: "confirmed",
    }));
    const contact: ContactTableItem = { id: "client", sourceType: "meta", name: "Ana", lastName: "Torres", phone: "5500000000", tags: ["Cliente"], createdAt: now, whatsappAvatarUrl: null,
        appointments, patients: [{ id: "patient", appointments: [appointments[0]] }] };
    const compact = contactListSnapshot(contact, now);
    assert.deepEqual(getClientMetrics(compact, now), getClientMetrics(contact, now));
    assert.equal(compact.patients[0].id, "patient"); assert.equal(compact.sourceType, "meta");
    assert.equal(compact.listMetrics?.actionAppointment?.meetLink, "https://meet.example.invalid/test");
    assert.equal(compact.listMetrics?.actionAppointment?.notes, appointments[90].notes);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(contact).length / 10);
    assert.equal(contact.appointments.length, 120);
});
