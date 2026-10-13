import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rmdir } from "node:fs/promises";
import { Pool } from "pg";
import { synchronizeTenantRetention, runTenantRetentionOnce, RETENTION_JOB_COLUMNS } from "./lib/tenant-data-retention.mjs";
import { databaseIdentifiers, purgeTenant } from "./account-deletion-worker.mjs";

// Destructive integration tests are deliberately limited to the dedicated local test database.
const url = process.env.CONTROL_DATABASE_URL || "";
const target = new URL(url);
if (target.hostname !== "127.0.0.1" || target.port !== "5446" || target.pathname !== "/crm_retention_control") throw new Error("Use the dedicated local crm_retention_control database on port 5446.");
const suffix = crypto.randomBytes(5).toString("hex");
const schema = `retention_test_${suffix}`;
const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
process.env.TENANT_POSTGRES_ADMIN_URL = adminUrl.toString();
process.env.TENANT_POSTGRES_CLUSTER_KEY = "retention-local";
const admin = new Pool({ connectionString: adminUrl.toString() });
const bootstrap = new Pool({ connectionString: url });
const control = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
const databases = [];
const uploads = await mkdtemp(path.join(tmpdir(), "zen-retention-test-"));
process.env.TENANT_DELETION_UPLOADS_DIR = uploads;
const now = new Date("2026-10-14T12:00:00Z");
const due = new Date("2027-01-13T07:27:00Z");

async function seed(id, endsAt = "2026-10-13T07:27:00Z") {
    await control.query(`INSERT INTO "Tenant" (id,slug,"displayName",status,"provisioningStatus","billingStatus","accessMode","createdAt","updatedAt") VALUES ($1,$1,'Disposable','READY','SUCCEEDED','CANCELED','BILLING_ONLY',NOW(),NOW())`, [id]);
    await control.query(`INSERT INTO "Trial" (id,"tenantId",status,"startsAt","endsAt","createdAt","updatedAt") VALUES ($1,$1,'EXPIRED',$2::timestamp-INTERVAL '14 days',$2,NOW(),NOW())`, [id, endsAt]);
    await control.query(`INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"isActive","createdAt","updatedAt") VALUES ($1,$1,'retained-owner','OWNER',true,NOW(),NOW())`, [id]);
}
async function job(id) { return (await control.query(`SELECT ${RETENTION_JOB_COLUMNS} FROM "TenantDataRetention" WHERE "tenantId"=$1`, [id])).rows[0]; }

try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = (await bootstrap.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`)).rows;
    for (const { tablename } of tables) await bootstrap.query(`CREATE TABLE "${schema}"."${tablename.replaceAll('"','""')}" (LIKE public."${tablename.replaceAll('"','""')}" INCLUDING ALL)`);
    await control.query(`INSERT INTO "User" (id,email,name,"updatedAt") VALUES ('retained-owner','retention-test@invalid.local','Retained owner',NOW())`);
    const first = `retention${suffix}`;
    const sibling = `sibling${suffix}`;
    await seed(first); await seed(sibling, "2027-05-01T12:00:00Z");
    const ids = databaseIdentifiers(first); databases.push(ids.database);
    await admin.query(`CREATE DATABASE "${ids.database}"`);
    const localUrl = new URL(adminUrl); localUrl.pathname = `/${ids.database}`;
    const local = new Pool({ connectionString: localUrl.toString() });
    try {
        await local.query(`CREATE TABLE "SystemSettings" (id TEXT PRIMARY KEY,"googleAccessToken" TEXT,"googleRefreshToken" TEXT,"googleConnectedEmail" TEXT,"googleTokenExpiresAt" TIMESTAMP,"googleCalendarId" TEXT,"googleSyncToken" TEXT,"googleLastSyncedAt" TIMESTAMP,"whatsappWabaId" TEXT,"whatsappAccessToken" TEXT,"whatsappGraphApiVersion" TEXT,"updatedAt" TIMESTAMP DEFAULT NOW()); CREATE TABLE "GoogleCalendarSource" (id TEXT PRIMARY KEY,"systemSettingsId" TEXT);`);
    } finally { await local.end(); }
    await control.query(`INSERT INTO "TenantDatabase" (id,"tenantId","clusterKey","databaseName","runtimeUrlCiphertext","runtimeSecretKeyVersion",status,"updatedAt") VALUES ($1,$1,'retention-local',$2,$3,1,'READY',NOW())`, [first, ids.database, Buffer.from([1])]);
    await synchronizeTenantRetention(control, { now });
    assert.equal((await job(first)).status, "RETAINED");
    assert.equal(new Date((await job(first)).deletionAt).toISOString(), due.toISOString());
    assert.equal(await runTenantRetentionOnce(control, admin, purgeTenant, new Date(due.getTime() - 1)), false);
    assert.equal(await runTenantRetentionOnce(control, admin, async (...args) => {
        assert.equal((await control.query('SELECT "isActive" FROM "TenantMembership" WHERE "tenantId"=$1', [first])).rows[0].isActive, false);
        try { await purgeTenant(...args); }
        catch (error) { console.error("Local purge failure:", error); throw error; }
    }, due), true);
    assert.equal((await job(first)).status, "COMPLETED");
    assert.equal((await control.query('SELECT 1 FROM "Tenant" WHERE id=$1', [first])).rowCount, 0);
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [ids.database])).rowCount, 0);
    assert.equal((await control.query(`SELECT 1 FROM "User" WHERE id='retained-owner'`)).rowCount, 1);
    assert.equal((await control.query('SELECT status FROM "Tenant" WHERE id=$1', [sibling])).rows[0].status, "READY");
    console.log("PASS: real PostgreSQL purge at three months; login identity and sibling business retained.");

    const renewed = `renewed${suffix}`; await seed(renewed); await synchronizeTenantRetention(control, { now });
    await control.query(`INSERT INTO "Subscription" (id,"tenantId",provider,status,"currentPeriodEndsAt","updatedAt") VALUES ($1,$1,'MERCADO_PAGO','ACTIVE','2027-02-13T07:27:00Z',NOW())`, [renewed]);
    assert.equal(await runTenantRetentionOnce(control, admin, () => assert.fail("renewed tenant must not be purged"), due), false);
    assert.equal((await job(renewed)).status, "REACTIVATED");
    await synchronizeTenantRetention(control, { now: due });
    assert.equal((await control.query('SELECT "accessMode" FROM "Tenant" WHERE id=$1', [renewed])).rows[0].accessMode, "FULL");
    console.log("PASS: payment immediately before cleanup cancels deletion and restores operations.");

    const historical = `historical${suffix}`; await seed(historical, "2026-01-01T12:00:00Z"); await synchronizeTenantRetention(control, { now });
    assert.equal((await job(historical)).status, "REVIEW_REQUIRED");
    assert.equal(await runTenantRetentionOnce(control, admin, () => assert.fail("newly discovered overdue tenant must not be purged"), due), false);
    console.log("PASS: adopting this policy cannot immediately erase old accounts.");

    const extended = `extended${suffix}`; await seed(extended); await synchronizeTenantRetention(control, { now });
    await control.query(`INSERT INTO "Subscription" (id,"tenantId",provider,status,"currentPeriodEndsAt","updatedAt") VALUES ($1,$1,'MERCADO_PAGO','CANCELED','2026-11-13T07:27:00Z',NOW())`, [extended]);
    assert.equal(await runTenantRetentionOnce(control, admin, () => assert.fail("new paid-period end must extend retention"), due), false);
    await synchronizeTenantRetention(control, { now: due });
    assert.equal(new Date((await job(extended)).deletionAt).toISOString(), "2027-02-13T07:27:00.000Z");
    console.log("PASS: the latest paid period, not the trial, determines the cleanup date.");

    const failed = `retry${suffix}`; await seed(failed); await synchronizeTenantRetention(control, { now });
    assert.equal(await runTenantRetentionOnce(control, admin, async () => { throw new Error("simulated storage outage"); }, due), false);
    assert.equal((await job(failed)).status, "RETRY");
    assert.equal((await control.query('SELECT status,"accessMode" FROM "Tenant" WHERE id=$1', [failed])).rows[0].accessMode, "SUSPENDED");
    assert.equal(await runTenantRetentionOnce(control, admin, async (_control, _admin, id) => { assert.equal(id, failed); }, due), true);
    assert.equal((await job(failed)).status, "COMPLETED");
    console.log("PASS: partial cleanup remains frozen and retries idempotently.");

    const pending = `pending${suffix}`; await seed(pending); await synchronizeTenantRetention(control, { now });
    await control.query(`INSERT INTO "BillingCheckoutAttempt" (id,"tenantId","planId",provider,"externalReference","amountCents",status,"createdAt","updatedAt")
        VALUES ($1,$1,'test-plan','MERCADO_PAGO',$1,29900,'PENDING',$2,NOW())`, [pending, new Date(due.getTime() - 3_600_000).toISOString()]);
    assert.equal(await runTenantRetentionOnce(control, admin, () => assert.fail("unsettled recent payment must defer cleanup"), due), false);
    assert.equal((await control.query('SELECT status FROM "Tenant" WHERE id=$1', [pending])).rows[0].status, "READY");
    assert.ok(new Date((await job(pending)).nextRunAt) > due);
    await synchronizeTenantRetention(control, { now: due });
    assert.ok(new Date((await job(pending)).nextRunAt) > due);
    console.log("PASS: recent pending payments defer freezing; synchronization preserves the retry deadline.");

    const parallel = `parallel${suffix}`; await seed(parallel); await synchronizeTenantRetention(control, { now });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    let calls = 0;
    const firstRun = runTenantRetentionOnce(control, admin, async () => { calls++; started(); await gate; }, due);
    await entered;
    assert.equal(await runTenantRetentionOnce(control, admin, () => assert.fail("parallel cleanup must not run twice"), due), false);
    finish();
    assert.equal(await firstRun, true); assert.equal(calls, 1);
    console.log("PASS: concurrent deletion workers cannot process the same cleanup twice.");
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await control.end();
    for (const database of databases) {
        if (!/^zencrm_t_retention[a-f0-9]{10}$/.test(database)) throw new Error("Unexpected test database name");
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
    await bootstrap.end(); await admin.end();
    await rmdir(uploads);
}
