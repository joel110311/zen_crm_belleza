import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function service({ days, redeemed = false, existing = false, fallback }: { days?: number; redeemed?: boolean; existing?: boolean; fallback?: string }) {
    const sent: { to: string; html: string; text: string }[] = [];
    const policies: unknown[] = [];
    const db = {
        user: { findUnique: async () => existing ? { id: "existing-owner" } : null },
        signupIntent: {
            findUnique: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "intent-a", ...data }),
        },
        trialPolicy: { findFirst: async (query: unknown) => { policies.push(query); return days ? { trialDays: days } : null; } },
        trialRedemption: { findUnique: async () => redeemed ? { redeemedAt: new Date() } : null },
        emailDelivery: { create: async () => ({ id: "delivery-a" }), update: async () => ({}) },
    };
    const mod = loadTsModule("src/lib/public-auth.ts", {
        "server-only": {}, "bcryptjs": { hash: async () => "fixture-hash" },
        "@/generated/control-plane": { Prisma: {} }, "@/lib/control-db": { getControlDb: () => db },
        "@/lib/control-plane": { normalizeTenantSlug: (value: string) => value },
        "@/lib/security": { hashSecurityIdentifier: () => "hashed-ip" },
        "@/lib/billing/trial-identity": { trialEmailHmac: () => "hashed-email" },
        "@/lib/transactional-email": { sendTransactionalEmail: async (input: typeof sent[number]) => { sent.push(input); return { provider: "resend", externalId: "sent-id" }; } },
    }, { process: { env: { NODE_ENV: "production", APP_BASE_URL: "https://crm.example.invalid", TENANT_TRIAL_DAYS: fallback } } });
    return {
        sent, policies,
        create: () => (mod.createSignupIntent as (input: unknown) => Promise<unknown>)({
            name: "Ana", email: "qa@example.invalid", password: "fixture-only-password", displayName: "Estudio <Belleza>",
            slug: "estudio-belleza", timeZone: "America/Mexico_City", idempotencyKey: "signup-email-fixture", ip: "127.0.0.1",
        }),
    };
}

for (const days of [7, 14]) {
    test(`signup verification email advertises the configured ${days}-day trial in HTML and plain text`, async () => {
        const subject = service({ days }); await subject.create();
        for (const copy of [subject.sent[0].text, subject.sent[0].html]) {
            assert.ok(copy.includes(`Tu prueba gratuita es de ${days} días`));
            assert.ok(copy.includes("comienza cuando el espacio de tu negocio esté listo"));
            assert.ok(copy.includes("El enlace vence en 20 minutos"));
        }
        assert.ok(subject.sent[0].html.includes("Estudio &lt;Belleza&gt;"));
        assert.ok(!subject.sent[0].html.includes("Estudio <Belleza>"));
        assert.deepEqual(JSON.parse(JSON.stringify(subject.policies[0])), {
            where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], select: { trialDays: true },
        });
    });
}

test("signup email uses the provisioner's fallback when no policy is configured", async () => {
    for (const [fallback, days] of [[undefined, 14], ["7", 7], ["invalid", 14]] as const) {
        const subject = service({ fallback }); await subject.create();
        assert.ok(subject.sent[0].text.includes(`prueba gratuita es de ${days} días`));
    }
});

test("a previously redeemed trial is not offered again in the signup email", async () => {
    const subject = service({ days: 14, redeemed: true }); await subject.create();
    assert.ok(subject.sent[0].html.includes("ya utilizó su prueba gratuita"));
    assert.ok(!subject.sent[0].text.includes("prueba gratuita es de"));
});

test("an existing account still receives no new signup or trial email", async () => {
    const subject = service({ days: 14, existing: true }); await subject.create();
    assert.equal(subject.sent.length, 0); assert.equal(subject.policies.length, 0);
});
