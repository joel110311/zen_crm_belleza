import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function subject(slug: string | null, denied = false) {
    const paths: string[] = [], events: string[] = [];
    let state = { id: "appointment-a", status: "scheduled", confirmationStatus: "pending" };
    const service = loadTsModule("src/app/actions/calendar.ts", {
        "@/lib/db": { prisma: { appointment: { update: async ({ data }: { data: Partial<typeof state> }) => { events.push("write"); state = { ...state, ...data }; return state; } } } },
        "next/cache": { revalidatePath: (path: string) => paths.push(path) },
        "@/lib/authz": { requireAnyPermission: async () => { if (denied) throw new Error("Forbidden"); } },
        "@/lib/active-tenant-context": { getActiveTenantRuntimeContext: async () => { await Promise.resolve(); events.push("context"); return slug ? { slug } : null; } },
        "@/lib/tenant-request-routing": loadTsModule("src/lib/tenant-request-routing.ts", {}),
        "@/lib/calendar/appointments": { cancelManagedAppointment: async () => { events.push("cancel"); state = { ...state, status: "cancelled", confirmationStatus: "declined" }; return state; } },
        "@/lib/appointment-reminders": { syncAppointmentReminders: async () => events.push("reminders"), cancelAppointmentReminders: async () => events.push("cancel-reminders") },
        "@/lib/google-calendar": {}, "@/lib/system-settings": {}, "@/lib/operation-context": {},
        "@/lib/calendar/business-hours": {}, "@/lib/calendar/client-selection": {}, "@/lib/calendar/draft": {}, "@/lib/operation-dates": {},
    });
    return { paths, events, state: () => state, update: service.updateAppointmentStatus as (id: string, status: string) => Promise<{ success: boolean }> };
}

test("confirming a request persists confirmation and refreshes the same business dashboard before returning", async () => {
    const s = subject("atelier-belleza");
    assert.equal((await s.update("appointment-a", "confirmed")).success, true);
    assert.equal(s.state().confirmationStatus, "confirmed");
    assert.equal(s.state().status, "scheduled");
    assert.deepEqual(s.events, ["write", "reminders", "context"]);
    for (const path of ["dashboard", "calendar", "reception", "contacts"]) assert.ok(s.paths.includes(`/t/atelier-belleza/${path}`));
    assert.ok(!s.paths.some(p => p.includes("otro-negocio")));
});

test("rejecting a request cancels it and invalidates the business home as well as reception", async () => {
    const s = subject("atelier-belleza");
    assert.equal((await s.update("appointment-a", "cancelled")).success, true);
    assert.equal(s.state().status, "cancelled");
    assert.equal(s.state().confirmationStatus, "declined");
    assert.ok(s.paths.includes("/t/atelier-belleza/dashboard"));
    assert.ok(s.paths.includes("/t/atelier-belleza/reception"));
});

test("legacy appointments still refresh legacy pages without inventing a tenant", async () => {
    const s = subject(null); await s.update("appointment-a", "confirmed");
    assert.deepEqual(s.paths, ["/dashboard", "/dashboard/calendar", "/dashboard/reception", "/dashboard/contacts"]);
});

test("permission denial prevents appointment changes and invalidation", async () => {
    const s = subject("atelier-belleza", true);
    await assert.rejects(s.update("appointment-a", "confirmed"), /Forbidden/);
    assert.deepEqual(s.events, []); assert.deepEqual(s.paths, []);
});
