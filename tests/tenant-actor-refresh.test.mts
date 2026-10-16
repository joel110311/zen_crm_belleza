import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mts";

function fixture(initial?: Record<string, unknown> | null) {
    let globalUser: Record<string, unknown> | null = { id: "global", email: "owner@example.invalid", name: "Owner" };
    let local: Record<string, unknown> | null = initial === undefined ? {
        id: "local", controlUserId: "global", email: "owner@example.invalid", name: "Owner", role: "ADMINISTRADOR", permissions: ["chats.manage"],
    } : initial;
    const counts = { transactions: 0, updates: 0, creates: 0, invitationChecks: 0 };
    const user = {
        findUnique: async ({ where }: { where: Record<string, unknown> }) => local && Object.entries(where).every(([key, value]) => local![key] === value) ? { ...local } : null,
        update: async ({ data }: { data: Record<string, unknown> }) => { counts.updates++; local = { ...local, ...data }; return { ...local }; },
        create: async ({ data }: { data: Record<string, unknown> }) => { counts.creates++; local = { id: "created", ...data }; return { ...local }; },
    };
    const db = { user, $transaction: async (work: (tx: { user: typeof user }) => unknown) => { counts.transactions++; return work({ user }); } };
    const service = loadTsModule("src/lib/tenant-actor.ts", {
        "server-only": {},
        "@/lib/control-db": { getControlDb: () => ({ user: { findUnique: async () => globalUser }, tenantInvitation: { findFirst: async () => { counts.invitationChecks++; return null; } } }) },
    });
    const resolve = (role = "OWNER") => (service.ensureTenantActor as (db: unknown, access: unknown, id: string) => Promise<Record<string, unknown>>)(db, { role }, "global");
    return { counts, resolve, setGlobal: (value: typeof globalUser) => { globalUser = value; },
        setLocal: (changes: Record<string, unknown>) => { local = { ...local, ...changes }; } };
}
test("30 unchanged owner requests avoid all projection transactions/writes and return current local permissions", async () => {
    const f = fixture();
    for (let index = 0; index < 30; index++) await f.resolve();
    assert.equal(f.counts.transactions, 0); assert.equal(f.counts.updates, 0);
    f.setLocal({ permissions: ["calendar.manage"] });
    assert.deepEqual((await f.resolve()).permissions, ["calendar.manage"]);
});
test("changes to name, email and membership role still refresh the actor, including demotion", async () => {
    const f = fixture();
    f.setGlobal({ id: "global", email: "new@example.invalid", name: "New name" });
    const actor = await f.resolve("RECEPTION");
    assert.equal(actor.email, "new@example.invalid"); assert.equal(actor.name, "New name"); assert.equal(actor.role, "RECEPCION");
    assert.equal(f.counts.updates, 1); assert.equal(f.counts.transactions, 1);
    await f.resolve("RECEPTION"); assert.equal(f.counts.updates, 1);
});
test("professional invitations are still checked on the unchanged fast path", async () => {
    const f = fixture({ id: "local", controlUserId: "global", email: "owner@example.invalid", name: "Owner", role: "PROFESIONAL", permissions: [] });
    await f.resolve("PROFESSIONAL"); await f.resolve("PROFESSIONAL");
    assert.equal(f.counts.invitationChecks, 2); assert.equal(f.counts.updates, 0);
});
test("first access creates an actor, existing unlinked email links it, and another identity cannot claim it", async () => {
    const fresh = fixture(null); assert.equal((await fresh.resolve()).controlUserId, "global"); assert.equal(fresh.counts.creates, 1);
    const legacy = fixture({ id: "legacy", controlUserId: null, email: "owner@example.invalid", name: "Old", role: "RECEPCION", permissions: [] });
    assert.equal((await legacy.resolve()).id, "legacy"); assert.equal(legacy.counts.updates, 1);
    const conflict = fixture({ id: "other", controlUserId: "another-global", email: "owner@example.invalid", name: "Other", role: "RECEPCION", permissions: [] });
    await assert.rejects(conflict.resolve(), /otra identidad/); assert.equal(conflict.counts.updates, 0);
});
test("the current control-plane identity remains required even if the local actor already exists", async () => {
    const f = fixture(); f.setGlobal(null);
    await assert.rejects(f.resolve(), /identidad global/);
    assert.equal(f.counts.transactions, 0);
});
