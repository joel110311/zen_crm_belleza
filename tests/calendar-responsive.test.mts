import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as businessHours from "../src/lib/calendar/business-hours.ts";
import { resolveCalendarClient } from "../src/lib/calendar/client-selection.ts";
const dates = loadTsModule("src/lib/operation-dates.ts", {
  "@/lib/calendar/business-hours": businessHours,
}, { Date });
const draft = loadTsModule("src/lib/calendar/draft.ts", {
  "../operation-dates.ts": dates,
}) as {
  validCalendarDateKey: (key: string) => string | null;
  resolveDraftTimes: (input: {
    dateKey: string;
    time: string;
    duration: number;
    timeZone: string;
    original?: { start: Date; end: Date };
  }) => { start: Date; end: Date; unchanged: boolean };
  appointmentsOnDay: (
    rows: { id: string; startTime: string }[],
    key: string,
    zone: string,
  ) => { id: string }[];
};
test("calendar rejects impossible dates instead of rolling them into another month", () => {
  assert.equal(draft.validCalendarDateKey("2026-02-31"), null);
  assert.equal(draft.validCalendarDateKey("2026-13-01"), null);
  assert.equal(draft.validCalendarDateKey("2024-02-29"), "2024-02-29");
});
test("editing an imported time preserves its exact instant, seconds and unusual duration", () => {
  const start = new Date("2026-10-13T17:22:37Z");
  const end = new Date("2026-10-13T18:09:37Z");
  const result = draft.resolveDraftTimes({
    dateKey: "2026-10-13",
    time: "11:22",
    duration: 47,
    timeZone: "America/Mexico_City",
    original: { start, end },
  });
  assert.equal(result.unchanged, true);
  assert.equal(result.start.getTime(), start.getTime());
  assert.equal(result.end.getTime(), end.getTime());
});
test("an explicit time change is converted using business timezone and selected duration", () => {
  const result = draft.resolveDraftTimes({
    dateKey: "2026-10-14",
    time: "14:17",
    duration: 60,
    timeZone: "America/Mexico_City",
    original: {
      start: new Date("2026-10-13T17:22Z"),
      end: new Date("2026-10-13T18:07Z"),
    },
  });
  assert.equal(result.unchanged, false);
  assert.equal(result.start.toISOString(), "2026-10-14T20:17:00.000Z");
  assert.equal(result.end.toISOString(), "2026-10-14T21:17:00.000Z");
});
test("invalid duration and time never become saveable draft timestamps", () => {
  for (const [time, duration] of [
    ["25:00", 30],
    ["11:30", 0],
    ["11:30", NaN],
    ["11:30", 1500],
  ] as const)
    assert.throws(() =>
      draft.resolveDraftTimes({
        dateKey: "2026-10-14",
        time,
        duration,
        timeZone: "America/Mexico_City",
      }),
    );
});
test("day list uses the business date across UTC midnight and sorts by time", () => {
  const rows = [
    { id: "tomorrow", startTime: "2026-10-14T06:30Z" },
    { id: "late", startTime: "2026-10-14T05:30Z" },
    { id: "early", startTime: "2026-10-13T15:00Z" },
  ];
  assert.deepEqual(
    Array.from(
      draft.appointmentsOnDay(rows, "2026-10-13", "America/Mexico_City"),
      (x) => x.id,
    ),
    ["early", "late"],
  );
});
const db = (
  patient: { id: string; contactId: string | null } | null,
  contact: { id: string; patients: { id: string }[] } | null,
) => ({
  patient: { findUnique: async () => patient },
  contact: { findUnique: async () => contact },
});
test("a CRM contact without a profile can book without creating a duplicate profile", async () => {
  assert.deepEqual(
    await resolveCalendarClient(
      { contactId: "contact-a" },
      db(null, { id: "contact-a", patients: [] }),
    ),
    { success: true, contactId: "contact-a", patientId: null },
  );
});
test("a contact with an existing profile preserves its association", async () => {
  assert.deepEqual(
    await resolveCalendarClient(
      { contactId: "contact-a" },
      db(null, { id: "contact-a", patients: [{ id: "patient-a" }] }),
    ),
    { success: true, contactId: "contact-a", patientId: "patient-a" },
  );
});
test("profile and contact from different clients cannot be combined", async () => {
  assert.equal(
    (
      await resolveCalendarClient(
        { patientId: "patient-a", contactId: "contact-b" },
        db({ id: "patient-a", contactId: "contact-a" }, null),
      )
    ).success,
    false,
  );
});
test("missing, deleted or foreign-business clients fail before appointment creation", async () => {
  for (const input of [
    {},
    { contactId: "foreign-id" },
    { patientId: "missing" },
  ])
    assert.equal(
      (await resolveCalendarClient(input, db(null, null))).success,
      false,
    );
});
