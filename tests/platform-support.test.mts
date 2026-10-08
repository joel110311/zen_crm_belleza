import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as routing from "../src/lib/tenant-request-routing.ts";
import * as policy from "../src/lib/platform-admin-policy.ts";

class Validation extends Error {}
type Grant = { id: string; tenantId: string; slug: string; adminUserId: string; mode: string; reason: string; expiresAt: string; securityVersion: number; credentialVersion: string | null };
type Support = {
    getPlatformSupportGrant: (id: string) => Promise<Grant | null>;
    startPlatformSupport: (id: string, input: Record<string, unknown>) => Promise<{ grant: Grant; destination: string }>;
    endPlatformSupport: (id: string, grantId: unknown) => Promise<void>;
};
function fixture() {
    let setting: { value: Grant } | null = null;
    const audits: Array<Record<string, unknown>> = [];
    const user = { isPlatformAdmin: true, securityVersion: 1 };
    const tenant = { id: "tenant-a", slug: "new-salon", status: "READY" };
    let deleted = false;
    let credentialVersion: string | null = "current-credential-epoch";
    const db = {
        user: { findUnique: async () => user }, tenant: { findUnique: async ({ where }: { where: { id: string } }) => where.id === tenant.id ? tenant : null },
        accountDeletion: { findUnique: async () => deleted ? { id: "deleted" } : null },
        platformRuntimeSetting: {
            findUnique: async () => setting,
            upsert: async ({ create }: { create: { value: Grant } }) => { setting = { value: create.value }; },
            deleteMany: async ({ where }: { where: { value: { equals: string } } }) => {
                if (setting?.value.id !== where.value.equals) return { count: 0 };
                setting = null; return { count: 1 };
            },
        },
        auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); } },
        $transaction: async (action: (tx: unknown) => unknown) => action(db),
    };
    const mod = loadTsModule("src/lib/platform-support.ts", {
        "server-only": {}, "@/lib/control-db": { getControlDb: () => db },
        "@/lib/environment-platform-admin": { ENVIRONMENT_ADMIN_ID: policy.ENVIRONMENT_ADMIN_ID, environmentAdminCredentialVersion: () => credentialVersion },
        "@/lib/control-validation-error": { ControlValidationError: Validation },
    }) as unknown as Support;
    return { mod, user, tenant, audits, setDeletion: (value: boolean) => { deleted = value; }, setEpoch: (value: string | null) => { credentialVersion = value; }, setting: () => setting };
}
const input = { tenantId: "tenant-a", reason: "Verificar el alta del negocio" };

test("support explicitly grants full access by default without adding tenant memberships; entry and exit are audited", async () => {
    const f = fixture();
    assert.equal(await f.mod.getPlatformSupportGrant(policy.ENVIRONMENT_ADMIN_ID), null);
    const result = await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input);
    assert.equal(result.grant.mode, "FULL");
    assert.equal(result.destination, "/t/new-salon/dashboard");
    assert.equal((await f.mod.getPlatformSupportGrant(policy.ENVIRONMENT_ADMIN_ID))?.tenantId, "tenant-a");
    assert.ok(Date.parse(result.grant.expiresAt) - Date.now() <= 30 * 60 * 1000);
    assert.equal(f.audits[0].action, "support.workspace.started");
    assert.equal(f.audits[0].tenantId, "tenant-a");
    assert.equal(f.audits[0].actorUserId, policy.ENVIRONMENT_ADMIN_ID);
    await f.mod.endPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, result.grant.id);
    assert.equal(await f.mod.getPlatformSupportGrant(policy.ENVIRONMENT_ADMIN_ID), null);
    assert.equal(f.audits[1].action, "support.workspace.ended");
});

test("support validates operator, reason and destination, rejects archived workspaces, never forces unfinished runtimes ready", async () => {
    const f = fixture();
    for (const bad of [{ ...input, reason: "x" }, { ...input, mode: "OWNER" }, { ...input, tenantId: "tenant-other" }]) {
        await assert.rejects(f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, bad), Validation);
    }
    f.user.isPlatformAdmin = false;
    await assert.rejects(f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input), Validation);
    f.user.isPlatformAdmin = true;
    const result = await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, { ...input, destination: "https://evil.test" });
    assert.equal(result.destination, "/t/new-salon/dashboard");
    assert.equal((await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, { ...input, destination: "onboarding" })).destination, "/t/new-salon/onboarding");
    f.tenant.status = "FAILED";
    assert.equal((await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input)).destination, "/onboarding/new-salon");
    f.tenant.status = "ARCHIVED";
    await assert.rejects(f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input), Validation);
});

test("expiry, admin revocation, securityVersion, deletion and credential rotation invalidate support immediately", async () => {
    for (const change of [
        (f: ReturnType<typeof fixture>) => { f.user.isPlatformAdmin = false; },
        (f: ReturnType<typeof fixture>) => { f.user.securityVersion++; },
        (f: ReturnType<typeof fixture>) => { f.setDeletion(true); },
        (f: ReturnType<typeof fixture>) => { f.setEpoch("rotated"); },
        (f: ReturnType<typeof fixture>) => { f.setEpoch(null); },
        (f: ReturnType<typeof fixture>) => { f.setting()!.value.expiresAt = new Date(Date.now() - 1000).toISOString(); },
    ]) {
        const f = fixture(); await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input);
        change(f); assert.equal(await f.mod.getPlatformSupportGrant(policy.ENVIRONMENT_ADMIN_ID), null);
    }
});

test("opening another workspace replaces the grant; an old tab cannot revoke the newer grant", async () => {
    const f = fixture();
    const first = await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, input);
    f.tenant.id = "tenant-b"; f.tenant.slug = "other-salon";
    const second = await f.mod.startPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, { ...input, tenantId: "tenant-b" });
    await f.mod.endPlatformSupport(policy.ENVIRONMENT_ADMIN_ID, first.grant.id);
    assert.equal((await f.mod.getPlatformSupportGrant(policy.ENVIRONMENT_ADMIN_ID))?.id, second.grant.id);
    assert.equal(f.audits.length, 2);
});

test("DAL resolves only the selected support tenant, retains member permissions and blocks writes in optional read-only mode", async () => {
    let grant: Grant | null = null;
    const tenant = { id: "tenant-a", slug: "new-salon", displayName: "New salon", timeZone: "America/Mexico_City", status: "READY", accessMode: "BILLING_ONLY", memberships: [] as Array<{ role: string }> };
    const plane = loadTsModule("src/lib/control-plane.ts", {
        "server-only": {}, "@/generated/control-plane": {},
        "@/lib/control-db": { getControlDb: () => ({ accountDeletion: { findUnique: async () => null }, tenant: { findUnique: async () => tenant } }) },
        "@/lib/platform-support": { getPlatformSupportGrant: async () => grant },
    });
    const get = plane.getTenantAccessForUser as (id: string, slug: string) => Promise<Record<string, unknown> | null>;
    assert.equal(await get(policy.ENVIRONMENT_ADMIN_ID, tenant.slug), null);
    grant = { id: "grant", tenantId: tenant.id, slug: tenant.slug, adminUserId: policy.ENVIRONMENT_ADMIN_ID, mode: "FULL", reason: "Test", expiresAt: new Date(Date.now() + 60000).toISOString(), securityVersion: 1, credentialVersion: "epoch" };
    assert.equal((await get(policy.ENVIRONMENT_ADMIN_ID, tenant.slug))?.accessMode, "FULL");
    assert.equal(tenant.accessMode, "BILLING_ONLY", "support must not change customer billing flags");
    tenant.id = "tenant-b";
    assert.equal(await get(policy.ENVIRONMENT_ADMIN_ID, tenant.slug), null);
    tenant.memberships = [{ role: "RECEPTION" }];
    assert.equal((await get("member", tenant.slug))?.role, "RECEPTION");
    tenant.id = "tenant-a"; tenant.memberships = [];
    grant.mode = "READ_ONLY";
    let dbLoads = 0;
    const context = loadTsModule("src/lib/tenant-context.ts", {
        "server-only": {}, "@/lib/control-plane": plane,
        "@/lib/tenant-prisma-manager": { getTenantPrismaManager: () => ({ getForTenant: async () => { dbLoads++; } }) },
        "@/lib/tenant-actor": {},
    });
    const requireContext = context.requireTenantContext as (id: string, slug: string, op: string) => Promise<Record<string, unknown>>;
    assert.equal((await requireContext(policy.ENVIRONMENT_ADMIN_ID, tenant.slug, "read")).accessMode, "READ_ONLY");
    await assert.rejects(requireContext(policy.ENVIRONMENT_ADMIN_ID, tenant.slug, "write"), /sólo para lectura/);
    tenant.status = "FAILED";
    await assert.rejects(requireContext(policy.ENVIRONMENT_ADMIN_ID, tenant.slug, "read"), /todavía no está listo/);
    assert.equal(dbLoads, 0, "authorization must occur before opening a tenant database");
});

test("proxy permits supported tenant pages, APIs and private media but denies different tenants, stale JWTs and read-only mutations", async () => {
    let grant: Grant | null = { id: "grant", tenantId: "tenant-a", slug: "new-salon", adminUserId: policy.ENVIRONMENT_ADMIN_ID, mode: "FULL", reason: "Test", expiresAt: new Date(Date.now() + 60000).toISOString(), securityVersion: 1, credentialVersion: "current" };
    const token = { id: policy.ENVIRONMENT_ADMIN_ID, authScope: "control", platformAdminCredentialVersion: "current" };
    const mod = loadTsModule("src/proxy.ts", {
        "@/lib/platform-admin-policy": policy, "@/lib/platform-support": { getPlatformSupportGrant: async () => grant },
        "next-auth/jwt": { getToken: async () => token }, "@/lib/tenant-request-routing": routing,
        "@/lib/permissions": { hasPermission: () => true },
    });
    const proxy = mod.proxy as (request: NextRequest) => Promise<Response>;
    const req = (path: string, method = "GET", cookie = "new-salon") => new NextRequest(`https://crm.test${path}`, { method, headers: { cookie: `${routing.ACTIVE_TENANT_COOKIE}=${cookie}`, [routing.TENANT_SLUG_HEADER]: "forged" } });
    for (const path of ["/t/new-salon/dashboard", "/t/new-salon/onboarding", "/api/t/new-salon/v1/contacts", "/api/chat", "/api/media/private.mp3", "/uploads/private.mp3"]) {
        const response = await proxy(req(path));
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("x-middleware-request-x-synapselogik-business"), "new-salon");
    }
    assert.equal((await proxy(req("/api/t/other/v1/contacts"))).status, 403);
    assert.equal((await proxy(req("/t/other/dashboard"))).headers.get("location"), "https://crm.test/control");
    assert.equal((await proxy(req("/api/chat", "POST"))).headers.get("x-middleware-next"), "1");
    grant!.mode = "READ_ONLY";
    for (const path of ["/api/chat", "/t/new-salon/onboarding", "/api/t/new-salon/v1/contacts"]) assert.equal((await proxy(req(path, "POST"))).status, 403);
    token.platformAdminCredentialVersion = "old";
    assert.equal((await proxy(req("/api/media/private.mp3"))).status, 403);
    grant = null;
    assert.equal((await proxy(req("/api/chat"))).status, 403);
});

test("support endpoints require admin and same-origin JSON mutations; listing is paginated and includes new workspaces", async () => {
    let allowed = false;
    let calls = 0;
    let query: Record<string, unknown> | null = null;
    class Access extends Error { status = 403; }
    const mod = loadTsModule("src/app/api/control/support/route.ts", {
        "next/server": { NextResponse },
        "@/lib/platform-admin": { requirePlatformAdmin: async () => { if (!allowed) throw new Access(); return { id: "admin" }; } },
        "@/lib/control-db": { getControlDb: () => ({ tenant: { count: async () => 101, findMany: async (input: Record<string, unknown>) => { query = input; return [{ id: "new-account", status: "PROVISIONING" }]; } } }) },
        "@/lib/control-api-errors": { ControlValidationError: Validation, controlApiError: (error: unknown) => ({ status: error instanceof Access ? 403 : error instanceof Validation ? 400 : 500, message: "Safe error" }) },
        "@/lib/security": { isSameApplicationOrigin: (request: Request) => request.headers.get("origin") === "https://crm.test" },
        "@/lib/platform-support": { startPlatformSupport: async () => { calls++; return { destination: "/t/new/dashboard", grant: { slug: "new" } }; }, endPlatformSupport: async () => { calls++; } },
        "@/lib/tenant-request-routing": routing,
    });
    const get = mod.GET as (r: Request) => Promise<Response>;
    const post = mod.POST as (r: Request) => Promise<Response>;
    const request = (origin?: string, body = "{}") => new Request("https://crm.test/api/control/support", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body });
    assert.equal((await get(new Request("https://crm.test/api/control/support"))).status, 403);
    assert.equal((await post(request("https://evil.test"))).status, 403);
    assert.equal((await post(request())).status, 403);
    allowed = true;
    const listing = await get(new Request("https://crm.test/api/control/support?page=1&q=salon"));
    assert.equal((await listing.json()).total, 101);
    assert.equal(query!.skip, 50); assert.equal(query!.take, 50);
    assert.equal((await post(request("https://crm.test", "[]"))).status, 400);
    const opened = await post(request("https://crm.test"));
    assert.equal(opened.status, 200);
    assert.match(opened.headers.get("set-cookie") || "", /synapselogik-active-business=new/);
    assert.equal(calls, 1);
});

test("read-only support does not create local staff or impersonate an owner", async () => {
    const db = { user: { findUnique: async () => null } };
    const mod = loadTsModule("src/lib/tenant-actor.ts", {
        "server-only": {}, "@/lib/control-db": { getControlDb: () => ({ user: { findUnique: async () => ({ id: "admin", email: "admin@platform.invalid", name: "Admin" }) } }) },
    });
    const actor = await (mod.ensureTenantActor as (db: unknown, access: unknown, id: string) => Promise<Record<string, unknown>>)(db, { role: "ADMIN", support: { mode: "READ_ONLY" } }, "admin");
    assert.equal(actor.id, "support:admin");
    assert.equal(actor.name, "Soporte de plataforma");
    assert.equal(actor.role, "ADMINISTRADOR");
});

test("read-only batch transactions work without weakening checks on write batches or interactive transactions", async () => {
    const operations: string[] = [];
    const client = {
        contact: { findMany: async () => ["contact"], create: async () => "created" },
        $transaction: async (input: unknown[]) => Promise.all(input),
    };
    const mod = loadTsModule("src/lib/routed-prisma.ts", {
        "server-only": {},
        "@/lib/active-tenant-context": { getActiveTenantPrisma: async (operation: string) => { operations.push(operation); if (operation === "write") throw new Error("READ_ONLY"); return client; } },
    });
    const db = (mod.createRoutedPrismaClient as (input: unknown) => typeof client)(client);
    await db.$transaction([db.contact.findMany(), db.contact.findMany()]);
    assert.equal(operations.at(-1), "read");
    await assert.rejects(db.$transaction([db.contact.create()]), /READ_ONLY/);
    assert.equal(operations.at(-1), "write");
});
