import crypto from "node:crypto";
import path from "node:path";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { databaseIdentifiers, runDeletionOnce } from "./account-deletion-worker.mjs";

const controlUrl = process.env.CONTROL_DATABASE_URL;
const adminUrl = process.env.TENANT_POSTGRES_ADMIN_URL;
if (!controlUrl || !adminUrl) throw new Error("CONTROL_DATABASE_URL and TENANT_POSTGRES_ADMIN_URL are required.");

const suffix = crypto.randomBytes(6).toString("hex");
const tenantId = `deltest${suffix}`;
const userId = `delete-user-${suffix}`;
const jobId = `delete-job-${suffix}`;
const sharedTenantId = `sharetest${suffix}`;
const sharedIds = databaseIdentifiers(sharedTenantId);
const sharedUserId = `shared-user-${suffix}`;
const successorUserId = `successor-user-${suffix}`;
const sharedJobId = `shared-job-${suffix}`;
const sharedEmail = `shared-${suffix}@invalid.local`;
const receiptHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
const email = `delete-${suffix}@invalid.local`;
const ids = databaseIdentifiers(tenantId);
const uploads = await mkdtemp(path.join(tmpdir(), "zen-account-deletion-"));
const prefix = `t-${crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 16)}-`;
const targetFile = path.join(uploads, `${prefix}discard.txt`);
const sentinelFile = path.join(uploads, "keep.txt");
const control = new Pool({ connectionString: controlUrl });
const admin = new Pool({ connectionString: adminUrl });

async function missing(file) {
    try { await access(file); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; }
}

try {
    await writeFile(targetFile, "discard");
    await writeFile(sentinelFile, "keep");
    await admin.query(`CREATE DATABASE "${ids.database}"`);
    const localUrl = new URL(adminUrl); localUrl.pathname = `/${ids.database}`;
    const local = new Pool({ connectionString: localUrl.toString() });
    try {
        await local.query(`
            CREATE TABLE "SystemSettings" (
                id TEXT PRIMARY KEY,
                "googleAccessToken" TEXT, "googleRefreshToken" TEXT, "googleConnectedEmail" TEXT,
                "googleTokenExpiresAt" TIMESTAMP(3), "googleCalendarId" TEXT, "googleSyncToken" TEXT,
                "googleLastSyncedAt" TIMESTAMP(3), "whatsappWabaId" TEXT, "whatsappAccessToken" TEXT,
                "whatsappGraphApiVersion" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE "GoogleCalendarSource" (id TEXT PRIMARY KEY, "systemSettingsId" TEXT);
        `);
    } finally { await local.end(); }

    await control.query('INSERT INTO "User" (id,email,name,"passwordHash","securityVersion","isPlatformAdmin","createdAt","updatedAt") VALUES ($1,$2,$3,$4,1,false,NOW(),NOW())', [userId, email, "Disposable", "disabled"]);
    await control.query('INSERT INTO "Tenant" (id,slug,"displayName",status,"provisioningStatus","billingStatus","accessMode","createdByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,\'ARCHIVED\',\'SUCCEEDED\',\'TRIALING\',\'SUSPENDED\',$4,NOW(),NOW())', [tenantId, tenantId, "Disposable deletion test", userId]);
    await control.query('INSERT INTO "TenantMembership" (id,"userId","tenantId",role,"isActive","createdAt","updatedAt") VALUES ($1,$2,$3,\'OWNER\',false,NOW(),NOW())', [`membership-${suffix}`, userId, tenantId]);
    await control.query('INSERT INTO "TenantDatabase" (id,"tenantId","clusterKey","databaseName","runtimeUrlCiphertext","runtimeSecretKeyVersion",status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,1,\'READY\',NOW(),NOW())', [`database-${suffix}`, tenantId, process.env.TENANT_POSTGRES_CLUSTER_KEY || "local", ids.database, Buffer.from([1])]);
    await control.query('INSERT INTO "AccountDeletion" (id,"userId","tokenHash",status,targets,attempts,"nextRunAt","createdAt") VALUES ($1,$2,$3,\'PENDING\',$4,0,NOW(),NOW())', [jobId, userId, receiptHash, JSON.stringify({ close: [tenantId] })]);

    process.env.TENANT_DELETION_UPLOADS_DIR = uploads;
    await runDeletionOnce(control, admin);

    const job = (await control.query('SELECT status,"userId" FROM "AccountDeletion" WHERE id=$1', [jobId])).rows[0];
    const identityCount = Number((await control.query('SELECT COUNT(*) FROM "User" WHERE id=$1', [userId])).rows[0].count);
    const tenantCount = Number((await control.query('SELECT COUNT(*) FROM "Tenant" WHERE id=$1', [tenantId])).rows[0].count);
    const databaseCount = Number((await admin.query('SELECT COUNT(*) FROM pg_database WHERE datname=$1', [ids.database])).rows[0].count);
    if (job?.status !== "COMPLETED" || job.userId !== null || identityCount || tenantCount || databaseCount || !(await missing(targetFile)) || await missing(sentinelFile)) {
        throw new Error("Account deletion integration assertions failed.");
    }
    await admin.query(`CREATE DATABASE "${sharedIds.database}"`);
    const sharedUrl = new URL(adminUrl); sharedUrl.pathname = `/${sharedIds.database}`;
    const shared = new Pool({ connectionString: sharedUrl.toString() });
    try {
        await shared.query(`
            CREATE TABLE "SystemSettings" (
                id TEXT PRIMARY KEY,
                "googleAccessToken" TEXT, "googleRefreshToken" TEXT, "googleConnectedEmail" TEXT,
                "googleTokenExpiresAt" TIMESTAMP(3), "googleCalendarId" TEXT, "googleSyncToken" TEXT,
                "googleLastSyncedAt" TIMESTAMP(3), "whatsappWabaId" TEXT, "whatsappAccessToken" TEXT,
                "whatsappGraphApiVersion" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE "GoogleCalendarSource" (id TEXT PRIMARY KEY, "systemSettingsId" TEXT);
            CREATE TABLE "User" (
                id TEXT PRIMARY KEY, "controlUserId" TEXT, email TEXT NOT NULL, name TEXT, password TEXT,
                permissions JSONB NOT NULL DEFAULT '[]', role TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE "Specialist" (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, "displayName" TEXT, email TEXT, phone TEXT,
                "professionalTitle" TEXT, "professionalLicense" TEXT, bio TEXT, "photoUrl" TEXT,
                "isActive" BOOLEAN NOT NULL DEFAULT true, "userId" TEXT
            );
        `);
        await shared.query('INSERT INTO "User" (id,"controlUserId",email,name,password,permissions,role) VALUES ($1,$2,$3,$4,$5,\'[]\',\'ADMIN\')', [`local-user-${suffix}`, sharedUserId, sharedEmail, "Disposable member", "disabled"]);
        await shared.query('INSERT INTO "Specialist" (id,name,"displayName",email,phone,"professionalTitle","professionalLicense",bio,"photoUrl","isActive","userId") VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,true,$9)', [`specialist-${suffix}`, "Disposable member", sharedEmail, "000", "Title", "License", "Bio", "photo", `local-user-${suffix}`]);
    } finally { await shared.end(); }

    await control.query('INSERT INTO "User" (id,email,name,"passwordHash","securityVersion","isPlatformAdmin","createdAt","updatedAt") VALUES ($1,$2,$3,$4,1,false,NOW(),NOW()),($5,$6,$7,$4,1,false,NOW(),NOW())', [sharedUserId, sharedEmail, "Disposable member", "disabled", successorUserId, `successor-${suffix}@invalid.local`, "Successor"]);
    await control.query('INSERT INTO "Tenant" (id,slug,"displayName",status,"provisioningStatus","billingStatus","accessMode","createdByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,\'READY\',\'SUCCEEDED\',\'TRIALING\',\'FULL\',$4,NOW(),NOW())', [sharedTenantId, sharedTenantId, "Business that continues", successorUserId]);
    await control.query('INSERT INTO "TenantMembership" (id,"userId","tenantId",role,"isActive","createdAt","updatedAt") VALUES ($1,$2,$3,\'ADMIN\',false,NOW(),NOW()),($4,$5,$3,\'OWNER\',true,NOW(),NOW())', [`shared-membership-${suffix}`, sharedUserId, sharedTenantId, `successor-membership-${suffix}`, successorUserId]);
    await control.query('INSERT INTO "TenantDatabase" (id,"tenantId","clusterKey","databaseName","runtimeUrlCiphertext","runtimeSecretKeyVersion",status,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,1,\'READY\',NOW(),NOW())', [`shared-database-${suffix}`, sharedTenantId, process.env.TENANT_POSTGRES_CLUSTER_KEY || "local", sharedIds.database, Buffer.from([1])]);
    await control.query('INSERT INTO "AccountDeletion" (id,"userId","tokenHash",status,targets,attempts,"nextRunAt","createdAt") VALUES ($1,$2,$3,\'PENDING\',$4,0,NOW(),NOW())', [sharedJobId, sharedUserId, crypto.randomBytes(32).toString("hex"), JSON.stringify({ close: [] })]);
    await runDeletionOnce(control, admin);

    const sharedJob = (await control.query('SELECT status,"userId" FROM "AccountDeletion" WHERE id=$1', [sharedJobId])).rows[0];
    const sharedIdentityCount = Number((await control.query('SELECT COUNT(*) FROM "User" WHERE id=$1', [sharedUserId])).rows[0].count);
    const sharedTenantCount = Number((await control.query('SELECT COUNT(*) FROM "Tenant" WHERE id=$1', [sharedTenantId])).rows[0].count);
    const sharedDatabaseCount = Number((await admin.query('SELECT COUNT(*) FROM pg_database WHERE datname=$1', [sharedIds.database])).rows[0].count);
    const verifyShared = new Pool({ connectionString: sharedUrl.toString() });
    let projection;
    let specialist;
    try {
        projection = (await verifyShared.query('SELECT "controlUserId",email,name,password,permissions,role FROM "User" WHERE id=$1', [`local-user-${suffix}`])).rows[0];
        specialist = (await verifyShared.query('SELECT name,email,phone,"isActive","userId" FROM "Specialist" WHERE id=$1', [`specialist-${suffix}`])).rows[0];
    } finally { await verifyShared.end(); }
    if (sharedJob?.status !== "COMPLETED" || sharedJob.userId !== null || sharedIdentityCount || sharedTenantCount !== 1 || sharedDatabaseCount !== 1 || projection?.controlUserId !== null || projection?.name !== "Usuario eliminado" || projection?.password !== null || specialist?.name !== "Especialista eliminado" || specialist?.isActive !== false || specialist?.userId !== null) {
        throw new Error("Shared business anonymization assertions failed.");
    }
    console.log("Account deletion integration test passed (closed and continuing businesses). ");
} finally {
    await control.query('DELETE FROM "AccountDeletion" WHERE id=$1', [jobId]).catch(() => undefined);
    await control.query('DELETE FROM "AccountDeletion" WHERE id=$1', [sharedJobId]).catch(() => undefined);
    await control.query('DELETE FROM "Tenant" WHERE id=$1', [tenantId]).catch(() => undefined);
    await control.query('DELETE FROM "Tenant" WHERE id=$1', [sharedTenantId]).catch(() => undefined);
    await control.query('DELETE FROM "User" WHERE id=$1', [userId]).catch(() => undefined);
    await control.query('DELETE FROM "User" WHERE id IN ($1,$2)', [sharedUserId, successorUserId]).catch(() => undefined);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [ids.database]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${ids.database}"`).catch(() => undefined);
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [sharedIds.database]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${sharedIds.database}"`).catch(() => undefined);
    await control.end();
    await admin.end();
    await rm(uploads, { recursive: true, force: true });
}
