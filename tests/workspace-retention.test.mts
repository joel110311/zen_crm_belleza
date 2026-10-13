import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import { addBusinessMonths, workspaceBillingState } from "../scripts/lib/billing-retention-policy.mjs";
import * as routing from "../src/lib/tenant-request-routing.ts";
import { loadTsModule } from "./helpers/load-ts-module.mts";

const expiry = "2026-10-13T07:27:00.000Z";
const expiredTenant = { status: "READY", accessMode: "BILLING_ONLY", timeZone: "America/Mexico_City", trial: { status: "EXPIRED", endsAt: expiry }, subscriptions: [] };

test("expired trials enter read-only immediately, warn after one month and expire exactly three months later", () => {
    const initial = workspaceBillingState(expiredTenant, new Date(expiry));
    assert.equal(initial.accessMode, "READ_ONLY");
    assert.equal(initial.notice?.phase, "EXPIRED");
    assert.equal(initial.notice?.warningAt, "2026-11-13T07:27:00.000Z");
    assert.equal(initial.notice?.deletionAt, "2027-01-13T07:27:00.000Z");
    assert.equal(workspaceBillingState(expiredTenant, new Date("2026-11-13T07:26:59Z")).notice?.phase, "EXPIRED");
    assert.equal(workspaceBillingState(expiredTenant, new Date("2026-11-13T07:27:00Z")).notice?.phase, "RETENTION_WARNING");
    assert.equal(workspaceBillingState(expiredTenant, new Date("2027-01-13T07:26:59Z")).accessMode, "READ_ONLY");
    assert.equal(workspaceBillingState(expiredTenant, new Date("2027-01-13T07:27:00Z")).accessMode, "BILLING_ONLY");
});

test("retention starts at the last paid period end, never cancellation, login or row update time", () => {
    const paid = { ...expiredTenant, subscriptions: [{ status: "CANCELED", currentPeriodEndsAt: "2026-11-30T05:30:00Z" }, { status: "ACTIVE", currentPeriodEndsAt: "2026-10-20T05:30:00Z" }] };
    const result = workspaceBillingState(paid, new Date("2026-12-05T12:00:00Z"));
    assert.equal(result.notice?.expiredAt, "2026-11-30T05:30:00.000Z");
    assert.equal(result.notice?.source, "subscription");
    assert.equal(result.notice?.deletionAt, "2027-03-01T05:30:00.000Z"); // Nov 29, 23:30 -> Feb 28, 23:30 in Mexico.
    assert.equal(workspaceBillingState(paid, new Date("2026-12-25T12:00:00Z")).notice?.deletionAt, result.notice?.deletionAt);
});

test("calendar months clamp leap years and preserve business-local dates across UTC boundaries and DST", () => {
    assert.equal(addBusinessMonths("2024-01-31T18:00:00Z", 1).toISOString(), "2024-02-29T18:00:00.000Z");
    assert.equal(addBusinessMonths("2026-01-31T05:30:00Z", 3).toISOString(), "2026-05-01T05:30:00.000Z"); // Jan 30 local -> Apr 30 local.
    assert.equal(addBusinessMonths("2026-01-15T17:00:00Z", 3, "America/New_York").toISOString(), "2026-04-15T16:00:00.000Z");
    assert.equal(addBusinessMonths("2025-12-08T07:30:00Z", 3, "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
});

test("verified renewal restores operations and cancels the notice; unpaid future periods never buy access", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const renewed = workspaceBillingState({ ...expiredTenant, subscriptions: [{ status: "ACTIVE", currentPeriodEndsAt: "2026-12-01T12:00:00Z" }] }, now);
    assert.equal(renewed.accessMode, "FULL"); assert.equal(renewed.notice, null);
    const unpaid = workspaceBillingState({ ...expiredTenant, subscriptions: [{ status: "PAST_DUE", pastDueAt: "2026-11-01T12:00:00Z", currentPeriodEndsAt: "2026-12-01T12:00:00Z" }] }, now);
    assert.equal(unpaid.accessMode, "READ_ONLY"); assert.equal(unpaid.notice?.expiredAt, "2026-11-01T12:00:00.000Z");
});

test("administrative suspension, unfinished tenants and unknown billing records are not unlocked", () => {
    assert.equal(workspaceBillingState({ ...expiredTenant, accessMode: "SUSPENDED" }).accessMode, "SUSPENDED");
    assert.equal(workspaceBillingState({ ...expiredTenant, status: "ARCHIVED" }).notice, null);
    assert.equal(workspaceBillingState({ status: "READY", accessMode: "BILLING_ONLY" }).accessMode, "BILLING_ONLY");
    assert.equal(workspaceBillingState({ ...expiredTenant, subscriptions: [{ status: "ACTIVE", currentPeriodEndsAt: null }] }).accessMode, "FULL");
});

test("API mutations fail before their handlers while read-only exports, billing and authentication remain reachable", async () => {
    let mode = "READ_ONLY";
    const proxy = loadTsModule("src/proxy.ts", {
        "next/server": { NextResponse }, "next-auth/jwt": { getToken: async () => ({ id: "owner", authScope: "control", role: "ADMINISTRADOR" }) },
        "@/lib/platform-admin-policy": { ENVIRONMENT_ADMIN_ID: "environment" }, "@/lib/platform-support": { getPlatformSupportGrant: async () => null },
        "@/lib/control-plane": { getTenantAccessForUser: async () => ({ status: "READY", accessMode: mode }) },
        "@/lib/permissions": { hasPermission: () => true }, "@/lib/tenant-request-routing": routing,
    }).proxy as (request: NextRequest) => Promise<Response>;
    const request = (path: string, method = "GET") => new NextRequest(`https://crm.test${path}`, { method, headers: { cookie: `${routing.ACTIVE_TENANT_COOKIE}=salon` } });
    for (const path of ["/api/chat", "/api/assistant-preview", "/api/upload", "/api/t/salon/v1/appointments"]) assert.equal((await proxy(request(path, "POST"))).status, 403);
    for (const path of ["/api/chat", "/api/t/salon/export"]) assert.equal((await proxy(request(path))).headers.get("x-middleware-next"), "1");
    for (const path of ["/api/billing/checkout", "/api/account/delete", "/api/auth/signout"]) assert.notEqual((await proxy(request(path, "POST"))).status, 403);
    mode = "FULL"; assert.equal((await proxy(request("/api/chat", "POST"))).headers.get("x-middleware-next"), "1");
});

test("read-only tenant context permits queries but denies writes even when the browser skips the modal", async () => {
    const loaded = loadTsModule("src/lib/tenant-context.ts", {
        "server-only": {}, "@/lib/control-plane": { normalizeTenantSlug: (slug: string) => slug, getTenantAccessForUser: async () => ({ tenantId: "a", status: "READY", accessMode: "READ_ONLY" }) },
        "@/lib/tenant-prisma-manager": {}, "@/lib/tenant-actor": {},
    }) as { requireTenantContext: (id: string, slug: string, operation: string) => Promise<unknown> };
    await loaded.requireTenantContext("owner", "salon", "read");
    await assert.rejects(loaded.requireTenantContext("owner", "salon", "write"), /sólo para lectura/);
});

test("export streams paginated tenant data with explicit field lists and an end marker; credentials are excluded", async () => {
    const queries: Record<string, unknown>[] = [];
    let authorizations = 0;
    const db = new Proxy({}, { get: (_target, model) => ({ findMany: async (query: Record<string, unknown>) => {
        queries.push(query);
        const fields = Object.keys(query.select as object);
        assert.ok(!fields.some(field => /password|token|secret|cipher|storageKey|publicBooking/i.test(field)));
        return model === "contact" ? [{ id: "contact-a", name: "Cliente" }] : [];
    } }) });
    const loaded = loadTsModule("src/lib/billing/workspace-export.ts", { "server-only": {} }, { TextEncoder }) as { workspaceExportStream: (db: unknown, manifest: object, authorize: () => Promise<void>) => ReadableStream };
    const file = await new Response(loaded.workspaceExportStream(db, { business: "salon-a" }, async () => { authorizations++; })).text();
    const lines = file.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines[0].business, "salon-a"); assert.equal(lines[0].attachmentsIncluded, false);
    assert.ok(lines.some(line => line.dataset === "contact" && line.record.id === "contact-a"));
    assert.equal(lines.at(-1).dataset, "complete"); assert.equal(authorizations, queries.length);
});

test("export endpoint requires the actual owner, never another member or a support session", async () => {
    let role = "RECEPTION"; let support: object | undefined; let streams = 0;
    const tenant = () => ({ tenantId: "a", slug: "salon", role, support, db: {} });
    const get = loadTsModule("src/app/api/t/[tenantSlug]/export/route.ts", {
        "next/server": { NextResponse }, "@/lib/auth": { auth: async () => ({ user: { id: "owner", authScope: "control" } }) },
        "@/lib/tenant-context": { requireTenantContext: async () => tenant(), requireTenantRuntimeContext: async () => tenant(), TenantAccessDeniedError: class extends Error {} },
        "@/lib/billing/workspace-export": { workspaceExportStream: () => { streams++; return "export"; } },
    }).GET as (request: Request, input: { params: Promise<{ tenantSlug: string }> }) => Promise<Response>;
    const call = () => get(new Request("https://crm.test/api/t/salon/export"), { params: Promise.resolve({ tenantSlug: "salon" }) });
    assert.equal((await call()).status, 403); assert.equal(streams, 0);
    role = "OWNER"; support = {}; assert.equal((await call()).status, 403); assert.equal(streams, 0);
    support = undefined; const response = await call(); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition") || "", /attachment/); assert.equal(streams, 1);
});
