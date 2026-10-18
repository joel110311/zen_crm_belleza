import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function service(existing: boolean, fail = false) {
    const sent: { to: string; text: string }[] = [], updates: { data: { status: string; errorCode?: string } }[] = [];
    const tokens: { data: { tokenHash: string; expiresAt: Date } }[] = [];
    const db = {
        user: { findUnique: async () => existing ? { id: "user-a", email: "qa@example.invalid" } : null },
        passwordResetToken: { updateMany: async () => ({ count: 0 }), create: async (data: typeof tokens[number]) => { tokens.push(data); return data; } },
        $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
        emailDelivery: { create: async () => ({ id: "delivery-a" }), update: async (data: typeof updates[number]) => { updates.push(data); return data; } },
    };
    const mod = loadTsModule("src/lib/public-auth.ts", {
        "server-only": {}, "@/generated/control-plane": { Prisma: {} }, "@/lib/control-db": { getControlDb: () => db },
        "@/lib/control-plane": {}, "@/lib/security": { hashSecurityIdentifier: () => "hashed-ip" },
        "@/lib/billing/trial-identity": {},
        "@/lib/transactional-email": { sendTransactionalEmail: async (input: typeof sent[number]) => { sent.push(input); if (fail) throw new Error("provider_failure"); return { provider: "resend", externalId: "sent-id" }; } },
    }, { Error, process: { env: { NODE_ENV: "production", APP_BASE_URL: "https://crm.example.invalid" } } });
    return { mod, sent, updates, tokens, request: mod.requestPasswordReset as (email: string, ip: string) => Promise<void> };
}

test("unknown recovery email does not create a token or attempt to deliver mail", async () => {
    const subject = service(false); await subject.request("qa@example.invalid", "127.0.0.1");
    assert.equal(subject.tokens.length, 0); assert.equal(subject.sent.length, 0); assert.equal(subject.updates.length, 0);
});

test("registered recovery email receives a HTTPS link; only the token hash is persisted", async () => {
    const subject = service(true); const before = Date.now(); await subject.request("QA@example.invalid", "127.0.0.1");
    assert.equal(subject.sent[0].to, "qa@example.invalid");
    const url = new URL(subject.sent[0].text.split("enlace: ")[1]);
    assert.equal(url.origin, "https://crm.example.invalid"); assert.equal(url.pathname, "/reset-password");
    const rawToken = url.searchParams.get("token")!; assert.ok(rawToken.length >= 32);
    assert.notEqual(subject.tokens[0].data.tokenHash, rawToken);
    assert.match(subject.tokens[0].data.tokenHash, /^[a-f0-9]{64}$/);
    assert.ok(subject.tokens[0].data.expiresAt.getTime() >= before + 29 * 60 * 1000);
    assert.equal(subject.updates[0].data.status, "SENT");
});

test("provider failure is recorded rather than marked as a sent password recovery", async () => {
    const subject = service(true, true); await assert.rejects(subject.request("qa@example.invalid", "127.0.0.1"), /provider_failure/);
    assert.equal(subject.updates[0].data.status, "FAILED"); assert.equal(subject.updates[0].data.errorCode, "provider_failure");
});

test("public recovery response stays identical for known, unknown and provider-failed accounts", async () => {
    let captcha = true, calls = 0; const subject = service(true);
    const mod = loadTsModule("src/app/api/public/password-reset/request/route.ts", {
        "next/server": { NextResponse: Response }, "@/lib/captcha": { verifySignupCaptcha: async () => captcha },
        "@/lib/multitenant-features": { isPublicTenantSignupEnabled: () => true },
        "@/lib/public-auth": { PASSWORD_RESET_RESPONSE: subject.mod.PASSWORD_RESET_RESPONSE, requestPasswordReset: async () => { calls++; if (calls === 3) throw new Error("private provider failure"); } },
        "@/lib/security": { isSameApplicationOrigin: () => true, getRequestIp: () => "127.0.0.1", consumeSharedRateLimit: async () => ({ allowed: true }) },
    });
    const post = mod.POST as (request: Request) => Promise<Response>;
    const request = () => new Request("https://crm.example.invalid/api/public/password-reset/request", { method: "POST", body: JSON.stringify({ email: "qa@example.invalid", captchaToken: "test-token" }) });
    const outcomes: { status: number; body: { message: string } }[] = [];
    for (let i = 0; i < 3; i++) { const response = await post(request()); outcomes.push({ status: response.status, body: await response.json() }); }
    assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[1], outcomes[2]);
    assert.equal(outcomes[0].status, 202); assert.match(outcomes[0].body.message, /Si este correo está registrado/);
    captcha = false; const blocked = await post(request()); assert.equal(blocked.status, 400); assert.equal(calls, 3);
});
