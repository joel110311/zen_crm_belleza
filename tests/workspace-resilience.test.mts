import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import { runIsolatedWorkspaceTasks } from "../scripts/lib/workspace-task-isolation.mjs";

test("one disconnected/scheduled workspace does not starve other workspaces", async () => {
    const visited: string[] = [];
    const failures: string[] = [];
    const result = await runIsolatedWorkspaceTasks([{ id: "a" }, { id: "b" }, { id: "c" }], async (workspace: { id: string }) => {
        visited.push(workspace.id);
        if (workspace.id === "a") throw new Error("simulated disconnected DB");
    }, (workspace: { id: string }) => failures.push(workspace.id));
    assert.deepEqual(visited, ["a", "b", "c"]);
    assert.deepEqual(failures, ["a"]);
    assert.deepEqual(result, { processed: 2, failed: 1 });
});

test("runtime pools have bounded connection/statement waits and handle idle errors without credential leaks", () => {
    const pools: FakePool[] = [];
    const logs: string[] = [];
    class FakePool extends EventEmitter { options: Record<string, unknown>; constructor(options: Record<string, unknown>) { super(); this.options = options; pools.push(this); } }
    const mod = loadTsModule("src/lib/runtime-pool.ts", { "server-only": {}, pg: { Pool: FakePool } }, {
        process: { env: { DATABASE_CONNECTION_TIMEOUT_MS: "garbage", DATABASE_STATEMENT_TIMEOUT_MS: "0" } },
        console: { error: (...args: unknown[]) => logs.push(JSON.stringify(args)) },
    });
    const pool = (mod.createRuntimePool as (url: string, scope: string, max: number) => FakePool)("postgresql://secret:test@db/workspace", "tenant", 3);
    assert.equal(pool.options.connectionTimeoutMillis, 5000);
    assert.equal(pool.options.statement_timeout, 60000);
    assert.equal(pool.options.max, 3);
    assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("postgresql://secret:test@db/workspace"), { code: "ECONNRESET" })));
    assert.match(logs.join(), /ECONNRESET/);
    assert.equal(logs.join().includes("secret:test"), false);
});

function managerFixture(max = "2") {
    const pools = new Map<string, { totalCount: number; idleCount: number; waitingCount: number; ended: number; end: () => Promise<void> }>();
    const queries: string[] = [];
    let release: (() => void) | undefined;
    let waitOn: string | undefined;
    const mod = loadTsModule("src/lib/tenant-prisma-manager.ts", {
        "server-only": {}, "@prisma/client": { Prisma: {}, PrismaClient: class {
            readonly id: string;
            constructor({ adapter }: { adapter: { pool: { id: string } } }) { this.id = adapter.pool.id; }
            async $queryRaw() {
                queries.push(this.id);
                if (this.id === waitOn) await new Promise<void>((resolve) => { release = resolve; });
                if (this.id === "broken") throw new Error("simulated credentials/private database failure");
                return [{ ready: true }];
            }
            async $disconnect() {}
        } },
        "@prisma/adapter-pg": { PrismaPg: class { pool: unknown; constructor(pool: unknown) { this.pool = pool; } } },
        "@/lib/runtime-pool": { createRuntimePool: (id: string) => {
            const pool = { id, totalCount: 0, idleCount: 0, waitingCount: 0, ended: 0, async end() { this.ended++; } };
            pools.set(id, pool); return pool;
        } },
        "@/lib/control-db": { getControlDb: () => ({ tenantDatabase: { findUnique: async ({ where }: { where: { tenantId: string } }) => ({ tenantId: where.tenantId, status: "READY", runtimeUrlCiphertext: where.tenantId, runtimeSecretKeyVersion: 1 }) } }) },
        "@/lib/tenant-credentials": { decryptTenantRuntimeUrl: (ciphertext: string) => ciphertext },
    }, { process: { env: { TENANT_PRISMA_MAX_CLIENTS: max } }, console: { error: () => {} } });
    const Manager = mod.TenantPrismaManager as new () => { getForTenant: (id: string) => Promise<unknown>; disconnectAll: () => Promise<void> };
    return { manager: new Manager(), pools, queries, waitOn: (id: string) => { waitOn = id; }, release: () => release?.() };
}

test("tenant client cache deduplicates simultaneous opens and a failed tenant does not poison another tenant", async () => {
    const f = managerFixture();
    const [a, again] = await Promise.all([f.manager.getForTenant("a"), f.manager.getForTenant("a")]);
    assert.equal(a, again);
    assert.equal(f.queries.filter((id) => id === "a").length, 1);
    await assert.rejects(f.manager.getForTenant("broken"), (error: Error) => error.name === "TenantDatabaseUnavailableError" && !error.message.includes("credentials"));
    assert.equal(f.pools.get("broken")?.ended, 1);
    assert.equal(await f.manager.getForTenant("a"), a);
    await f.manager.getForTenant("b");
    await f.manager.disconnectAll();
});

test("capacity does not disconnect another workspace's active transaction", async () => {
    const f = managerFixture("1");
    await f.manager.getForTenant("a");
    Object.assign(f.pools.get("a")!, { totalCount: 1, idleCount: 0 });
    await assert.rejects(f.manager.getForTenant("b"), (error: Error) => error.name === "TenantDatabaseUnavailableError");
    assert.equal(f.pools.get("a")?.ended, 0);
    assert.equal(f.pools.has("b"), false);
    Object.assign(f.pools.get("a")!, { idleCount: 1 });
    await f.manager.getForTenant("b");
    assert.equal(f.pools.get("a")?.ended, 1);
    await f.manager.disconnectAll();
});

test("simultaneous distinct workspace startups reserve bounded capacity before network I/O", async () => {
    const f = managerFixture("1");
    f.waitOn("a");
    const startup = f.manager.getForTenant("a");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.rejects(f.manager.getForTenant("b"), (error: Error) => error.name === "TenantDatabaseUnavailableError");
    assert.equal(f.pools.size, 1);
    f.release();
    await startup;
    await f.manager.disconnectAll();
});
