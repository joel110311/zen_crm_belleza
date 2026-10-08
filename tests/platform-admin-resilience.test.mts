import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as adminPolicy from "../src/lib/platform-admin-policy.ts";
type Authorize = typeof import("../src/lib/environment-platform-admin.ts").authorizeEnvironmentPlatformAdmin;

function adminFixture(overrides: Record<string, string> = {}) {
    const env = { ADMIN_USERNAME: "adminjoel", ADMIN_PASSWORD: "test-only-password-not-production", AUTH_SECRET: "test-only-session-secret", ...overrides };
    let user: Record<string, unknown> | null = null;
    let writes = 0;
    let audits = 0;
    let accesses = 0;
    const tx = {
        user: { findUnique: async () => user, upsert: async ({ create }: { create: Record<string, unknown> }) => { writes++; user ||= { ...create, securityVersion: 1 }; return user; } },
        auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits++; assert.equal(JSON.stringify(data).includes(env.ADMIN_PASSWORD), false); } },
    };
    const mod = loadTsModule("src/lib/environment-platform-admin.ts", {
        "server-only": {}, "@/lib/platform-admin-policy": adminPolicy, "@/lib/control-db": { getControlDb: () => { accesses++; return { $transaction: async (action: (tx: unknown) => unknown) => action(tx), accountDeletion: { findUnique: async () => null } }; } },
    }, { process: { env } });
    return { env, mod, setUser: (u: Record<string, unknown>) => { user = u; }, stats: () => ({ writes, audits, accesses }) };
}

test("dedicated admin fails closed without a strong configured secret and never queries DB for wrong credentials", async () => {
    const scenarios: Array<Record<string, string>> = [{ ADMIN_PASSWORD: "" }, { ADMIN_PASSWORD: "short" }, { AUTH_SECRET: "" }, { ADMIN_USERNAME: "invalid username" }];
    for (const overrides of scenarios) {
        const fixture = adminFixture(overrides);
        assert.equal(await (fixture.mod.authorizeEnvironmentPlatformAdmin as Authorize)("adminjoel", "wrong"), null);
        assert.equal(fixture.stats().accesses, 0);
    }
    const fixture = adminFixture();
    const authorize = fixture.mod.authorizeEnvironmentPlatformAdmin as Authorize;
    assert.equal(await authorize("adminjoel", "wrong"), null);
    assert.equal(await authorize("someone-else", fixture.env.ADMIN_PASSWORD), null);
    assert.equal(await authorize("adminjoel", "x".repeat(129)), null);
    assert.equal(fixture.stats().accesses, 0);
});

test("dedicated admin is separate from tenant accounts, audited, and not backed by an email/password hash", async () => {
    const fixture = adminFixture();
    const authorize = fixture.mod.authorizeEnvironmentPlatformAdmin as Authorize;
    const first = await authorize("adminjoel", fixture.env.ADMIN_PASSWORD);
    assert.ok(first);
    assert.equal(first.id, "platform-env-admin");
    assert.equal(first.name, "adminjoel");
    assert.equal(first.authScope, "control");
    assert.equal(first.isPlatformAdmin, true);
    assert.deepEqual(Array.from(first.permissions), []);
    assert.equal(JSON.stringify(first).includes(fixture.env.ADMIN_PASSWORD), false);
    const again = await authorize("adminjoel", fixture.env.ADMIN_PASSWORD);
    assert.ok(again);
    assert.equal(again.id, first.id);
    assert.equal(fixture.stats().writes, 1);
    assert.equal(fixture.stats().audits, 1);
});

test("a revoked dedicated administrator is never silently promoted on login", async () => {
    const fixture = adminFixture();
    fixture.setUser({ id: "platform-env-admin", email: "platform-env-admin@platform.invalid", passwordHash: null, isPlatformAdmin: false });
    assert.equal(await (fixture.mod.authorizeEnvironmentPlatformAdmin as Authorize)("adminjoel", fixture.env.ADMIN_PASSWORD), null);
    assert.equal(fixture.stats().writes, 0);
});

test("credential rotation/removal changes the admin session version without exposing the secret", () => {
    const fixture = adminFixture();
    const version = fixture.mod.environmentAdminCredentialVersion as () => string | null;
    const first = version();
    assert.match(first!, /^[a-f0-9]{64}$/);
    fixture.env.ADMIN_PASSWORD += "-rotated";
    assert.notEqual(version(), first);
    fixture.env.ADMIN_USERNAME = "otheradmin";
    assert.notEqual(version(), first);
    fixture.env.ADMIN_PASSWORD = "";
    assert.equal(version(), null);
});

test("control page distinguishes unauthorized, forbidden and infrastructure failures instead of fake 404s", async () => {
    class AccessError extends Error { status: number; constructor(status: number) { super("Access denied"); this.status = status; } }
    let failure: unknown = new AccessError(403);
    let databaseAccesses = 0;
    const mod = loadTsModule("src/app/control/page.tsx", {
        "next/link": ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children),
        "next/navigation": { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } },
        "@/lib/platform-admin": { PlatformAdminAccessError: AccessError, requirePlatformAdmin: async () => { throw failure; } },
        "@/lib/control-db": { getControlDb: () => { databaseAccesses++; throw new Error("must not read protected data"); } },
        "@/components/control/commerce-control-center": {}, "@/lib/ai/platform-runtime": {},
        "@/lib/billing/provider": {}, "@/lib/billing/platform-runtime": {},
    });
    const page = mod.default as () => Promise<Parameters<typeof renderToStaticMarkup>[0]>;
    const markup = renderToStaticMarkup(await page());
    assert.match(markup, /Esta cuenta no tiene acceso administrativo/);
    assert.match(markup, /\/control\/login/);
    assert.equal(databaseAccesses, 0);
    failure = new AccessError(401);
    await assert.rejects(page(), /REDIRECT:\/control\/login/);
    failure = new Error("database unavailable");
    await assert.rejects(page(), (error) => error === failure);
    assert.equal(databaseAccesses, 0);
});

// Imported normally, rather than evaluated as application code inside the mocked VM.
import * as React from "react";

test("dedicated credentials provider rejects legacy requests, enforces rate limits and revokes rotated admin JWTs", async () => {
    const fixture = adminFixture();
    const user = await (fixture.mod.authorizeEnvironmentPlatformAdmin as Authorize)("adminjoel", fixture.env.ADMIN_PASSWORD);
    assert.ok(user);
    let allowed = true;
    let factory: () => { providers: Array<{ id?: string; authorize: (credentials: unknown, request: Request) => Promise<unknown> }>; callbacks: { jwt: (p: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown>> } };
    loadTsModule("src/lib/auth.ts", {
        "next-auth": (f: typeof factory) => { factory = f; return { handlers: {}, auth: () => null }; },
        "next-auth/providers/credentials": (options: unknown) => options,
        "next-auth/providers/google": () => null, "bcryptjs": {},
        "@/lib/db": {}, "@/lib/active-tenant-context": {},
        "@/lib/control-db": { getControlDb: () => ({ accountDeletion: { findUnique: async () => null }, user: { findUnique: async () => user } }) },
        "@/lib/permissions": { normalizeRole: (role: string) => role, normalizePermissions: (permissions: unknown) => permissions || [] },
        "@/lib/security": { consumeRateLimit: () => ({ allowed }), consumeSharedRateLimit: async () => ({ allowed }), getRequestIp: () => "test-ip", resetRateLimit: () => {} },
        "@/lib/application-host": { isLegacyApplicationRequest: (headers: Headers) => headers.get("x-legacy") === "1" },
        "@/lib/google-signin": { isGoogleSignInEnabled: () => false },
        "@/lib/environment-platform-admin": fixture.mod,
    }, { process: { env: { ...fixture.env, MULTITENANT_AUTH_ENABLED: "true" } } });
    const config = factory!();
    const provider = config.providers.find((p) => p.id === "platform-admin")!;
    const credentials = { username: "adminjoel", password: fixture.env.ADMIN_PASSWORD };
    assert.equal(await provider.authorize(credentials, new Request("https://crm.test", { headers: { "x-legacy": "1" } })), null);
    allowed = false;
    assert.equal(await provider.authorize(credentials, new Request("https://crm.test")), null);
    allowed = true;
    assert.ok(await provider.authorize(credentials, new Request("https://crm.test")));
    const token = await config.callbacks.jwt({ token: {}, user });
    assert.equal(token.id, "platform-env-admin");
    fixture.env.ADMIN_PASSWORD += "-rotated";
    const revoked = await config.callbacks.jwt({ token });
    assert.equal(revoked.id, undefined);
    assert.equal(revoked.isPlatformAdmin, undefined);
    assert.equal(revoked.authScope, undefined);
});

test("administrative API never turns infrastructure errors into validation errors or reveals credentials", () => {
    class AccessError extends Error { status = 403; }
    const mod = loadTsModule("src/lib/control-api-errors.ts", { "server-only": {}, "@/lib/platform-admin": { PlatformAdminAccessError: AccessError } });
    const map = mod.controlApiError as (error: unknown) => { status: number; message: string };
    const Validation = mod.ControlValidationError as new (message: string) => Error;
    assert.equal(map(new Validation("Completa el campo")).status, 400);
    assert.equal(map(new AccessError("Forbidden")).status, 403);
    assert.equal(map({ code: "P1001", message: "postgresql://user:secret@db" }).status, 503);
    assert.equal(map(new Error("postgresql://user:secret@db")).status, 500);
    assert.equal(map(new Error("postgresql://user:secret@db")).message.includes("secret"), false);
});
