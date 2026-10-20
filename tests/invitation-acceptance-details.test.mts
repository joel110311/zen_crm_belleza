import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

const privateToken = "a".repeat(48);
function subject(existing: boolean, status = "PENDING", expired = false) {
    let lookups = 0, userReads = 0;
    const db = {
        tenantInvitation: { findUnique: async ({ where }: { where: { tokenHash: string } }) => { lookups++; assert.equal(where.tokenHash, `hashed:tenant-invitation:${privateToken}`); return { email: "invited@example.invalid", status, expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)), tenant: { displayName: "Estudio local", slug: "estudio-local" } }; } },
        user: { findUnique: async ({ where, select }: { where: { email: string }; select: unknown }) => { userReads++; assert.equal(where.email, "invited@example.invalid"); assert.equal(JSON.stringify(select), '{"id":true}'); return existing ? { id: "user-a" } : null; } },
    };
    const mod = loadTsModule("src/lib/tenant-invitations.ts", {
        "server-only": {}, "@/generated/control-plane": {}, "@/lib/control-db": { getControlDb: () => db },
        "@/lib/security": { hashSecurityIdentifier: (value: string) => `hashed:${value}` },
        "@/lib/transactional-email": {}, "@/lib/tenant-services/context": { TenantServiceError: class extends Error {} },
    });
    return { read: mod.getInvitationAcceptanceDetails as (token: string) => Promise<{ requiresNewAccount: boolean; alreadyAccepted: boolean; displayName: string; signInPath: string } | null>, counts: () => ({ lookups, userReads }) };
}

test("valid private invitations distinguish new and existing accounts without exposing email", async () => {
    for (const existing of [false, true]) {
        const s = subject(existing); const details = await s.read(privateToken);
        assert.equal(details?.requiresNewAccount, !existing);
        assert.equal(details?.alreadyAccepted, false);
        assert.equal(details?.signInPath, "/login?redirectTo=%2Ft%2Festudio-local");
        assert.ok(!("email" in details!));
    }
});

test("accepted invitations expose only completion state rather than another signup form", async () => {
    assert.equal((await subject(true, "ACCEPTED").read(privateToken))?.alreadyAccepted, true);
});

test("expired or revoked invitations cannot look up account existence", async () => {
    for (const s of [subject(true, "REVOKED"), subject(true, "EXPIRED"), subject(true, "PENDING", true)]) {
        assert.equal(await s.read(privateToken), null); assert.equal(s.counts().userReads, 0);
    }
});

test("malformed invitation tokens never query the database", async () => {
    const s = subject(true); assert.equal(await s.read("invalid"), null);
    assert.deepEqual(s.counts(), { lookups: 0, userReads: 0 });
});
