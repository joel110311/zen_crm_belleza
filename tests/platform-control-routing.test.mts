import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as routing from "../src/lib/tenant-request-routing.ts";
import * as adminPolicy from "../src/lib/platform-admin-policy.ts";

test("control requests never inherit an unrelated workspace cookie or spoofed tenant scope headers", async () => {
    let token: unknown = { id: "platform-env-admin", authScope: "control" };
    const mod = loadTsModule("src/proxy.ts", {
        "next-auth/jwt": { getToken: async () => token },
        "next/server": { NextResponse: { next: (value: unknown) => value, redirect: (url: URL) => ({ redirect: String(url), headers: new Headers() }), rewrite: (url: URL, value: object) => ({ rewrite: String(url), headers: new Headers(), ...value }), json: (_value: unknown, init: unknown) => init } },
        "@/lib/platform-admin-policy": adminPolicy,
        "@/lib/platform-support": { getPlatformSupportGrant: async () => null },
        "@/lib/permissions": { hasPermission: () => true },
        "@/lib/tenant-request-routing": routing,
    }, { process: { env: { AUTH_SECRET: "test-only" } } });
    const request = (path: string) => ({
        url: `https://crm.test${path}`, nextUrl: new URL(`https://crm.test${path}`),
        headers: new Headers({ [routing.TENANT_SCOPE_HEADER]: "control", [routing.TENANT_SLUG_HEADER]: "spoofed", [routing.TENANT_USER_HEADER]: "spoofed-id" }),
        cookies: { get: () => ({ value: "unavailable-workspace" }) },
    });
    const proxy = mod.proxy as (request: unknown) => Promise<{ request?: { headers: Headers }; redirect?: string; rewrite?: string }>;
    for (const path of ["/control", "/control/login", "/api/control/commerce"]) {
        const result = await proxy(request(path));
        assert.equal(result.request?.headers.has(routing.TENANT_SCOPE_HEADER), false);
        assert.equal(result.request?.headers.has(routing.TENANT_SLUG_HEADER), false);
        assert.equal(result.request?.headers.has(routing.TENANT_USER_HEADER), false);
    }
    const expired = await proxy(request("/t/logicapp/dashboard"));
    assert.equal(expired.redirect, undefined); assert.match(expired.rewrite || "", /\/support-access\?returnTo=/);
    assert.equal(expired.request?.headers.has(routing.TENANT_SLUG_HEADER), false);
    for (const path of ["/api/users", "/api/chat", "/api/t/logicapp/v1/contacts", "/api/media/private.mp3", "/uploads/private.mp3"]) {
        const response = await proxy(request(path)) as unknown as { status: number };
        assert.equal(response.status, 403, "platform credentials must not inherit operational/legacy data access");
    }
    token = { id: "ordinary-tenant-member", authScope: "control" };
    const workspace = await proxy(request("/t/logicapp/dashboard"));
    assert.equal(workspace.request?.headers.get(routing.TENANT_SLUG_HEADER), "logicapp");
    assert.equal(workspace.request?.headers.get(routing.TENANT_USER_HEADER), "ordinary-tenant-member");
    token = null;
    assert.ok((await proxy(request("/api/control/commerce"))).request, "API must enforce its own JSON 401, not redirect to HTML");
    assert.equal((await proxy(request("/control"))).redirect, "https://crm.test/control/login");
    assert.ok((await proxy(request("/control/login"))).request);
});

test("email and Google logins retain the explicitly requested control destination but reject external destinations", async () => {
    const calls: Array<{ provider: string; destination: unknown }> = [];
    const mod = loadTsModule("src/app/login/actions.ts", {
        "next-auth": { AuthError: class extends Error {} },
        "@/lib/auth": { signIn: async (provider: string, input: FormData | { redirectTo: string }) => { calls.push({ provider, destination: input instanceof FormData ? input.get("redirectTo") : input.redirectTo }); } },
        "next/headers": { headers: async () => new Headers() },
        "@/lib/application-host": { isLegacyApplicationRequest: () => false },
        "@/lib/google-signin": { isGoogleSignInEnabled: () => true }, "next/navigation": {},
    }, { process: { env: { MULTITENANT_AUTH_ENABLED: "true" } } });
    const login = mod.loginAction as (prev: undefined, form: FormData) => Promise<unknown>;
    const google = mod.googleLoginAction as (form: FormData) => Promise<unknown>;
    for (const destination of ["/control", "https://evil.test", "//evil.test"]) {
        const form = new FormData(); form.set("redirectTo", destination);
        await login(undefined, form);
        assert.equal(calls.at(-1)?.destination, destination === "/control" ? "/control" : "/tenants");
        form.set("redirectTo", destination);
        await google(form);
        assert.equal(calls.at(-1)?.destination, destination === "/control" ? "/control" : "/tenants");
    }
});
