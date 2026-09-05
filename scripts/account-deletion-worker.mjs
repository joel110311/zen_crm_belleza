import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { readdir, lstat, unlink, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import Stripe from "stripe";
import { S3Client, ListObjectVersionsCommand, ListObjectsV2Command, DeleteObjectsCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";

export function databaseIdentifiers(id) {
    if (!/^[a-z0-9]{8,40}$/.test(id)) throw new Error("unsafe_tenant_identifier");
    return { database: `zencrm_t_${id}`, migration: `zencrm_m_${id}`, runtime: `zencrm_r_${id}` };
}

function decryptChannel(channel) {
    const version = Number(process.env.TENANT_CREDENTIALS_KEY_VERSION || "1");
    if (channel.secretKeyVersion !== version) throw new Error("channel_key_version_unavailable");
    const master = Buffer.from(process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY || process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY || "", "base64");
    if (master.length !== 32) throw new Error("channel_key_unavailable");
    const key = crypto.createHmac("sha256", master).update("zen-crm:tenant-channel-connection:v1").digest();
    const envelope = Buffer.from(channel.secretCiphertext);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.subarray(0, 12));
    decipher.setAuthTag(envelope.subarray(12, 28));
    return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString("utf8");
}

async function request(url, options, allowedStatuses = [404]) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok && !allowedStatuses.includes(response.status)) throw new Error(`provider_http_${response.status}`);
    return response;
}

function decryptGoogleToken(value) {
    if (!value) return null;
    if (!value.startsWith("enc:v1:")) return value;
    const parts = value.split(":");
    if (parts.length !== 5) throw new Error("google_token_invalid");
    const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim() || "";
    const key = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
    if (key.length !== 32) throw new Error("google_token_key_required");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], "base64url")), decipher.final()]).toString("utf8");
}

async function revokeGoogleToken(value) {
    const token = decryptGoogleToken(value);
    if (!token) return;
    await request("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
    }, [400]); // Google returns 400 when the grant is already invalid/revoked.
}

async function removeGoogleConnection(local, deletedEmail = null) {
    const settings = (await local.query('SELECT id, "googleAccessToken", "googleRefreshToken", "googleConnectedEmail" FROM "SystemSettings" LIMIT 1')).rows[0];
    if (!settings) return;
    if (deletedEmail && settings.googleConnectedEmail?.trim().toLowerCase() !== deletedEmail.trim().toLowerCase()) return;
    await revokeGoogleToken(settings.googleRefreshToken || settings.googleAccessToken);
    await local.query('DELETE FROM "GoogleCalendarSource" WHERE "systemSettingsId"=$1', [settings.id]);
    await local.query('UPDATE "SystemSettings" SET "googleAccessToken"=NULL, "googleRefreshToken"=NULL, "googleTokenExpiresAt"=NULL, "googleConnectedEmail"=NULL, "googleCalendarId"=NULL, "googleSyncToken"=NULL, "googleLastSyncedAt"=NULL, "updatedAt"=NOW() WHERE id=$1', [settings.id]);
}

async function removeLegacyMetaConnection(local) {
    const settings = (await local.query('SELECT id, "whatsappWabaId", "whatsappAccessToken", "whatsappGraphApiVersion" FROM "SystemSettings" LIMIT 1')).rows[0];
    if (!settings?.whatsappWabaId || !settings.whatsappAccessToken) return;
    const version = /^v\d+\.\d+$/.test(settings.whatsappGraphApiVersion || "") ? settings.whatsappGraphApiVersion : (process.env.META_GRAPH_API_VERSION || "v26.0");
    await request(`https://graph.facebook.com/${version}/${encodeURIComponent(settings.whatsappWabaId)}/subscribed_apps`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${settings.whatsappAccessToken}` },
    }, [400, 401, 404]);
}

export async function deleteLocalUploads(directory, tenantId) {
    if (!directory || !path.isAbsolute(directory)) throw new Error("absolute_uploads_directory_required");
    const root = await realpath(directory);
    if (root === path.parse(root).root) throw new Error("unsafe_uploads_directory");
    const prefix = `t-${crypto.createHash("sha256").update(tenantId).digest("hex").slice(0,16)}-`;
    for (const name of await readdir(root)) {
        if (!name.startsWith(prefix)) continue;
        const target = path.resolve(root, name);
        if (path.dirname(target) !== root) throw new Error("unsafe_upload_path");
        const stat = await lstat(target).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
        if (!stat) continue;
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unexpected_upload_entry");
        await unlink(target);
    }
}

async function deleteStoredObjects(tenantId, hasPrivateFiles) {
    const bucket = process.env.TENANT_STORAGE_S3_BUCKET;
    if (!bucket) { if (hasPrivateFiles) throw new Error("private_storage_not_configured"); return; }
    const s3 = new S3Client({ endpoint: process.env.TENANT_STORAGE_S3_ENDPOINT, region: process.env.TENANT_STORAGE_S3_REGION || "us-east-1", forcePathStyle: process.env.TENANT_STORAGE_S3_FORCE_PATH_STYLE !== "false", credentials: { accessKeyId: process.env.TENANT_STORAGE_S3_ACCESS_KEY_ID || "", secretAccessKey: process.env.TENANT_STORAGE_S3_SECRET_ACCESS_KEY || "", sessionToken: process.env.TENANT_STORAGE_S3_SESSION_TOKEN } });
    const prefix = `tenants/${tenantId}/`;
    const remove = async (objects) => {
        if (objects.some((object) => !object.Key?.startsWith(prefix))) throw new Error("unsafe_object_key");
        if (!objects.length) return;
        const result = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
        if (result.Errors?.length) throw new Error("object_deletion_failed");
    };
    try {
        // Repeat first page after each deletion, including historical versions and delete markers.
        while (true) {
            const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, MaxKeys: 500 }));
            const objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])].map(({ Key, VersionId }) => ({ Key, VersionId }));
            if (!objects.length) break;
            await remove(objects);
        }
        while (true) {
            const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 500 }));
            if (!page.Contents?.length) break;
            await remove(page.Contents.map(({ Key }) => ({ Key })));
        }
        while (true) {
            const page = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix, MaxUploads: 500 }));
            if (!page.Uploads?.length) break;
            for (const upload of page.Uploads) {
                if (!upload.Key?.startsWith(prefix)) throw new Error("unsafe_upload_key");
                await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: upload.Key, UploadId: upload.UploadId }));
            }
        }
    } finally { s3.destroy(); }
}

async function cancelBilling(control, tenantId) {
    const { rows } = await control.query('SELECT * FROM "Subscription" WHERE "tenantId"=$1', [tenantId]);
    for (const subscription of rows) {
        if (!subscription.providerSubscriptionId) continue;
        if (subscription.provider === "STRIPE") {
            if (!process.env.STRIPE_SECRET_KEY) throw new Error("stripe_key_required");
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            try {
                const current = await stripe.subscriptions.retrieve(subscription.providerSubscriptionId);
                if (current.status !== "canceled") await stripe.subscriptions.cancel(current.id, { prorate: false, invoice_now: false });
            } catch (error) { if (error.code !== "resource_missing") throw error; }
        } else if (subscription.status !== "CANCELED") {
            if (!process.env.PADDLE_API_KEY) throw new Error("paddle_key_required");
            const base = process.env.PADDLE_ENVIRONMENT === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
            const result = await request(`${base}/subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}`, { headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}` } });
            if (result.status === 404) continue;
            const current = await result.json();
            if (current.data?.status !== "canceled") await request(`${base}/subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ effective_from: "immediately" }) });
        }
        await control.query('UPDATE "Subscription" SET status=\'CANCELED\', "canceledAt"=NOW(), "updatedAt"=NOW() WHERE id=$1', [subscription.id]);
    }
}

async function purgeTenant(control, admin, tenantId) {
    const ids = databaseIdentifiers(tenantId);
    const registered = (await control.query('SELECT * FROM "TenantDatabase" WHERE "tenantId"=$1', [tenantId])).rows[0];
    if (registered && (registered.databaseName !== ids.database || registered.clusterKey !== (process.env.TENANT_POSTGRES_CLUSTER_KEY || "primary"))) throw new Error("database_registry_mismatch");
    const tenant = (await control.query('SELECT status, "accessMode" FROM "Tenant" WHERE id=$1', [tenantId])).rows[0];
    if (tenant && (tenant.status !== "ARCHIVED" || tenant.accessMode !== "SUSPENDED")) throw new Error("tenant_not_frozen");
    if ((await control.query('SELECT 1 FROM "TenantMembership" WHERE "tenantId"=$1 AND role=\'OWNER\' AND "isActive"=true', [tenantId])).rowCount) throw new Error("tenant_has_active_owner");
    await cancelBilling(control, tenantId);
    // The request disables future work. Allow an already running request/worker lease to finish.
    if ((await control.query('SELECT 1 FROM "TenantWorkItem" WHERE "tenantId"=$1 AND status=\'RUNNING\' AND COALESCE("heartbeatAt","lockedAt","updatedAt") > NOW()-INTERVAL \'10 minutes\'', [tenantId])).rowCount) throw new Error("tenant_work_still_running");
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [ids.database])).rowCount;
    let hasPrivateFiles = false;
    if (exists) {
        if (!registered) throw new Error("unregistered_database");
        const url = new URL(process.env.TENANT_POSTGRES_ADMIN_URL); url.pathname = `/${ids.database}`;
        const local = new Pool({ connectionString: url.toString() });
        try {
            const tables = (await local.query("SELECT to_regclass('\"PrivateFile\"') IS NOT NULL AS files")).rows[0];
            if (tables.files) hasPrivateFiles = Boolean((await local.query('SELECT 1 FROM "PrivateFile" LIMIT 1')).rowCount);
            await removeGoogleConnection(local);
            await removeLegacyMetaConnection(local);
        } finally { await local.end(); }
    }
    const channels = (await control.query('SELECT * FROM "ChannelConnection" WHERE "tenantId"=$1 AND "secretCiphertext" IS NOT NULL', [tenantId])).rows;
    for (const channel of channels) {
        if (channel.provider === "WUZAPI") {
            const base = process.env.MULTITENANT_WUZAPI_BASE_URL?.replace(/\/$/, "");
            if (!base) throw new Error("wuzapi_url_required");
            await request(`${base}/session/logout`, { method: "POST", headers: { Token: decryptChannel(channel) } }, [401, 404]);
        }
        // The Meta token is dedicated to this connection, but its WABA id is not stored in the
        // control plane. Removing the secret and route prevents all future access and callbacks.
        await control.query('UPDATE "ChannelConnection" SET status=\'DISCONNECTED\', "secretCiphertext"=NULL, "routeSecretHash"=NULL, "disconnectedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1', [channel.id]);
    }
    await deleteStoredObjects(tenantId, hasPrivateFiles);
    await deleteLocalUploads(process.env.TENANT_DELETION_UPLOADS_DIR, tenantId);
    if (exists) {
        await admin.query(`ALTER DATABASE "${ids.database}" WITH ALLOW_CONNECTIONS false`);
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [ids.database]);
        await admin.query(`DROP DATABASE IF EXISTS "${ids.database}"`);
    }
    for (const role of [ids.runtime, ids.migration]) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await control.query('DELETE FROM "WebhookEvent" WHERE "tenantId"=$1', [tenantId]);
    await control.query('DELETE FROM "AuditLog" WHERE "tenantId"=$1', [tenantId]);
    await control.query('DELETE FROM "BillingEvent" WHERE payload #>> \'{data,object,metadata,tenantId}\'=$1 OR payload #>> \'{data,custom_data,tenantId}\'=$1 OR payload #>> \'{data,metadata,tenantId}\'=$1', [tenantId]);
    await control.query('DELETE FROM "Tenant" WHERE id=$1', [tenantId]);
}

async function eraseSharedProjections(control, admin, userId, email) {
    // Include old/inactive memberships: their local projections also contain personal data.
    const clusterKey = process.env.TENANT_POSTGRES_CLUSTER_KEY || "primary";
    const databases = (await control.query('SELECT d.* FROM "TenantDatabase" d INNER JOIN "TenantMembership" m ON m."tenantId"=d."tenantId" WHERE d.status=\'READY\' AND d."clusterKey"=$1 AND m."userId"=$2', [clusterKey, userId])).rows;
    for (const registered of databases) {
        const ids = databaseIdentifiers(registered.tenantId);
        if (registered.databaseName !== ids.database) throw new Error("database_registry_mismatch");
        if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [ids.database])).rowCount) continue;
        const url = new URL(process.env.TENANT_POSTGRES_ADMIN_URL); url.pathname = `/${ids.database}`;
        const local = new Pool({ connectionString: url.toString() });
        try {
            await removeGoogleConnection(local, email);
            const actor = (await local.query('SELECT id FROM "User" WHERE "controlUserId"=$1', [userId])).rows[0];
            if (!actor) continue;
            await local.query('BEGIN');
            // Keep operational references, but remove the profile and login identifying the person.
            await local.query('UPDATE "Specialist" SET name=\'Especialista eliminado\', "displayName"=NULL, email=NULL, phone=NULL, "professionalTitle"=NULL, "professionalLicense"=NULL, bio=NULL, "photoUrl"=NULL, "isActive"=false, "userId"=NULL WHERE "userId"=$1', [actor.id]);
            await local.query('UPDATE "User" SET "controlUserId"=NULL, email=$2, name=\'Usuario eliminado\', password=NULL, permissions=\'[]\', role=\'RECEPCION\', "updatedAt"=NOW() WHERE id=$1', [actor.id, `deleted-${crypto.randomUUID()}@invalid.local`]);
            await local.query('COMMIT');
        } finally { await local.end(); }
    }
}

export async function runDeletionOnce(control, admin) {
    const lock = await control.connect();
    try {
        if (!(await lock.query("SELECT pg_try_advisory_lock(735190405) AS locked")).rows[0].locked) return false;
        const job = (await control.query('SELECT * FROM "AccountDeletion" WHERE status<>\'COMPLETED\' AND "nextRunAt"<=NOW() ORDER BY "createdAt" LIMIT 1')).rows[0];
        if (!job) return false;
        await control.query('UPDATE "AccountDeletion" SET status=\'PROCESSING\', attempts=attempts+1 WHERE id=$1', [job.id]);
        try {
            if (!job.userId || !Array.isArray(job.targets?.close)) throw new Error("invalid_deletion_job");
            const identity = (await control.query('SELECT email FROM "User" WHERE id=$1', [job.userId])).rows[0];
            if (!identity) throw new Error("deletion_identity_missing");
            for (const id of job.targets.close) await purgeTenant(control, admin, id);
            await eraseSharedProjections(control, admin, job.userId, identity.email);
            const tx = await control.connect();
            try {
                await tx.query('BEGIN');
                const user = (await tx.query('SELECT email FROM "User" WHERE id=$1', [job.userId])).rows[0];
                if (user) {
                    await tx.query('DELETE FROM "EmailDelivery" WHERE "userId"=$1 OR lower("recipientEmail")=lower($2)', [job.userId, user.email]);
                    await tx.query('DELETE FROM "LegalAcceptance" WHERE "userId"=$1 OR "signupIntentId" IN (SELECT id FROM "SignupIntent" WHERE lower(email)=lower($2))', [job.userId,user.email]);
                    await tx.query('DELETE FROM "SignupIntent" WHERE "userId"=$1 OR lower(email)=lower($2)', [job.userId,user.email]);
                    await tx.query('DELETE FROM "TenantInvitation" WHERE "invitedByUserId"=$1 OR "acceptedByUserId"=$1 OR lower(email)=lower($2)', [job.userId,user.email]);
                    await tx.query('DELETE FROM "AuditLog" WHERE "actorUserId"=$1', [job.userId]);
                    await tx.query('DELETE FROM "User" WHERE id=$1', [job.userId]);
                }
                await tx.query('UPDATE "AccountDeletion" SET status=\'COMPLETED\', "userId"=NULL, "lastError"=NULL, "completedAt"=NOW() WHERE id=$1', [job.id]);
                await tx.query('COMMIT');
            } catch(error) { await tx.query('ROLLBACK'); throw error; } finally { tx.release(); }
        } catch (error) {
            // No provider payloads, personal data or credentials in retry logs/receipts.
            await control.query('UPDATE "AccountDeletion" SET status=\'RETRY\', "lastError"=\'cleanup_failed\', "nextRunAt"=NOW()+INTERVAL \'1 minute\' WHERE id=$1', [job.id]);
            console.error(`[Account deletion] ${job.id}: cleanup_failed; retry scheduled.`);
            if (process.env.ACCOUNT_DELETION_DEBUG === "true") console.error(error);
        }
        return true;
    } finally { await lock.query("SELECT pg_advisory_unlock(735190405)"); lock.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (!process.env.CONTROL_DATABASE_URL || !process.env.TENANT_POSTGRES_ADMIN_URL) throw new Error("deletion_worker_database_configuration_required");
    const control = new Pool({ connectionString: process.env.CONTROL_DATABASE_URL });
    const admin = new Pool({ connectionString: process.env.TENANT_POSTGRES_ADMIN_URL });
    try {
        do {
            await runDeletionOnce(control, admin);
            if (process.argv.includes("--once")) break;
            await new Promise((resolve) => setTimeout(resolve, 5000));
        } while (true);
    } finally { await control.end(); await admin.end(); }
}
