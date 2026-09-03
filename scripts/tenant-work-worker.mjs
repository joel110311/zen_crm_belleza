import "dotenv/config";
import crypto from "node:crypto";
import os from "node:os";
import { Pool } from "pg";

const controlUrl = process.env.CONTROL_DATABASE_URL?.trim();
if (!controlUrl) throw new Error("CONTROL_DATABASE_URL is required by the tenant worker.");

const workerId = process.env.TENANT_WORKER_ID?.trim() || `${os.hostname()}:${process.pid}`;
const staleAfterSeconds = boundedInteger("TENANT_WORKER_STALE_SECONDS", 300, 30, 3_600);
const maxClaimBatch = boundedInteger("TENANT_WORKER_MAX_DRAIN", 100, 1, 2_000);
const drain = process.argv.includes("--drain");
const once = process.argv.includes("--once");
const control = new Pool({ connectionString: controlUrl, max: 4 });

function boundedInteger(name, fallback, minimum, maximum) {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function channelRootKey(keyVersion) {
    const configuredVersion = Number.parseInt(process.env.TENANT_CREDENTIALS_KEY_VERSION || "1", 10);
    if (configuredVersion !== keyVersion) throw new Error(`No decryption key is configured for tenant credential key version ${keyVersion}.`);
    const encoded = process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY?.trim() || "";
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return key;
}

function decryptTenantRuntimeUrl(ciphertext, keyVersion) {
    const payload = Buffer.from(ciphertext);
    if (payload.length <= 28) throw new Error("Tenant runtime credential ciphertext is invalid.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", channelRootKey(keyVersion), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    const value = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = new URL(value);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("Tenant runtime credential is not a PostgreSQL URL.");
    return value;
}

function retryDelaySeconds(attempts) {
    return Math.min(3_600, Math.max(10, 2 ** Math.min(attempts, 10) * 5));
}

function cleanError(error) {
    const value = error instanceof Error ? error.message : String(error);
    return value.replace(/[\r\n]+/g, " ").slice(0, 1_000);
}

async function claimNextWorkItem() {
    const { rows } = await control.query(
        `WITH candidate AS (
            SELECT "id"
              FROM "TenantWorkItem"
             WHERE (
                 ("status" IN ('QUEUED', 'RETRY_WAIT') AND "availableAt" <= NOW())
                 OR ("status" = 'RUNNING' AND COALESCE("heartbeatAt", "lockedAt", "updatedAt") <= NOW() - ($2 * INTERVAL '1 second'))
             )
             ORDER BY "availableAt" ASC, "createdAt" ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
        )
        UPDATE "TenantWorkItem" AS work
           SET "status" = 'RUNNING', "lockedAt" = NOW(), "lockedBy" = $1, "heartbeatAt" = NOW(),
               "attempts" = work."attempts" + 1, "updatedAt" = NOW()
          FROM candidate
         WHERE work."id" = candidate."id"
        RETURNING work.*`,
        [workerId, staleAfterSeconds],
    );
    return rows[0] || null;
}

async function heartbeat(workId) {
    await control.query(
        `UPDATE "TenantWorkItem" SET "heartbeatAt" = NOW(), "updatedAt" = NOW()
          WHERE "id" = $1 AND "status" = 'RUNNING' AND "lockedBy" = $2`,
        [workId, workerId],
    );
}

async function markSucceeded(work) {
    await control.query(
        `UPDATE "TenantWorkItem"
            SET "status" = 'SUCCEEDED', "completedAt" = NOW(), "lockedAt" = NULL, "lockedBy" = NULL,
                "heartbeatAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
          WHERE "id" = $1 AND "status" = 'RUNNING' AND "lockedBy" = $2`,
        [work.id, workerId],
    );
}

async function markFailed(work, error) {
    const lastError = cleanError(error);
    const deadLetter = work.attempts >= work.maxAttempts;
    const availableAt = new Date(Date.now() + retryDelaySeconds(work.attempts) * 1_000);
    await control.query(
        `UPDATE "TenantWorkItem"
            SET "status" = $3::"TenantWorkStatus", "availableAt" = $4, "failedAt" = CASE WHEN $3 = 'DEAD_LETTER' THEN NOW() ELSE NULL END,
                "lockedAt" = NULL, "lockedBy" = NULL, "heartbeatAt" = NULL, "lastError" = $5, "updatedAt" = NOW()
          WHERE "id" = $1 AND "status" = 'RUNNING' AND "lockedBy" = $2`,
        [work.id, workerId, deadLetter ? "DEAD_LETTER" : "RETRY_WAIT", availableAt, lastError],
    );
    if (work.kind === "WEBHOOK_EVENT" && typeof work.recordId === "string") {
        await control.query(
            `UPDATE "WebhookEvent" SET "status" = $2::"WebhookProcessingStatus", "processingError" = $3,
                    "processedAt" = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE NULL END
              WHERE "id" = $1`,
            [work.recordId, deadLetter ? "FAILED" : "RECEIVED", lastError],
        );
    }
}

async function tenantPool(tenantId) {
    const { rows } = await control.query(
        `SELECT "runtimeUrlCiphertext", "runtimeSecretKeyVersion", "status"
           FROM "TenantDatabase" WHERE "tenantId" = $1`,
        [tenantId],
    );
    const database = rows[0];
    if (!database || database.status !== "READY") throw new Error("Tenant database is unavailable to the worker.");
    return new Pool({ connectionString: decryptTenantRuntimeUrl(database.runtimeUrlCiphertext, database.runtimeSecretKeyVersion), max: 1 });
}

function text(value, maximum = 4_000) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function timestamp(value) {
    if (typeof value !== "string" || !value) return new Date();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function applyMessage(db, event) {
    const payload = event.payload || {};
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const sourceId = text(payload.sourceId, 160);
    const providerMessageId = text(payload.providerMessageId, 300) || null;
    const phone = text(payload.phone, 80).replace(/\D/g, "");
    if (!sourceId || !phone || phone.length < 7 || phone.length > 20) return;

    await db.query("BEGIN");
    try {
        // The durable queue already de-duplicates deliveries, and this transaction-level lock also
        // handles a worker crash between the tenant write and the control-plane acknowledgement.
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${sourceType}:${providerMessageId || event.providerEventId}`]);
        if (providerMessageId) {
            const duplicate = await db.query(
                `SELECT "id" FROM "Message" WHERE "source_type" = $1 AND "providerMessageId" = $2 LIMIT 1`,
                [sourceType, providerMessageId],
            );
            if (duplicate.rowCount) {
                await db.query("COMMIT");
                return;
            }
        }
        const contact = await db.query(
            `INSERT INTO "Contact" ("id", "phone", "name", "tags", "status", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, ARRAY[]::TEXT[], 'lead', NOW(), NOW())
             ON CONFLICT ("phone") DO UPDATE SET
                 "name" = COALESCE("Contact"."name", EXCLUDED."name"),
                 "updatedAt" = NOW()
             RETURNING "id"`,
            [crypto.randomUUID(), phone, text(payload.contactName, 160) || null],
        );
        const contactId = contact.rows[0].id;
        const existingConversation = await db.query(
            `SELECT "id" FROM "Conversation"
              WHERE "contactId" = $1 AND "source_type" = $2 AND "source_id" IS NOT DISTINCT FROM $3 AND "status" = 'active'
              ORDER BY "updatedAt" DESC LIMIT 1`,
            [contactId, sourceType, sourceId],
        );
        const conversationId = existingConversation.rows[0]?.id || crypto.randomUUID();
        if (!existingConversation.rowCount) {
            await db.query(
                `INSERT INTO "Conversation" ("id", "contactId", "source_type", "source_id", "createdAt", "updatedAt", "sessionExpiresAt")
                 VALUES ($1, $2, $3, $4, NOW(), NOW(), CASE WHEN $3 = 'meta' THEN NOW() + INTERVAL '24 hours' ELSE NULL END)`,
                [conversationId, contactId, sourceType, sourceId],
            );
        }
        const direction = payload.direction === "outbound" ? "outbound" : "inbound";
        await db.query(
            `INSERT INTO "Message" ("id", "conversationId", "content", "type", "direction", "source_type", "source_id", "status", "senderType", "providerMessageId", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8, $9, $10)`,
            [
                crypto.randomUUID(), conversationId, text(payload.content) || "[Mensaje de WhatsApp]",
                ["image", "video", "audio", "document"].includes(payload.messageType) ? payload.messageType : "text",
                direction, sourceType, sourceId, direction === "outbound" ? "human" : null, providerMessageId, timestamp(payload.occurredAt),
            ],
        );
        await db.query(
            `UPDATE "Conversation" SET "updatedAt" = NOW(), "sessionExpiresAt" = CASE WHEN $2 = 'meta' THEN NOW() + INTERVAL '24 hours' ELSE "sessionExpiresAt" END
              WHERE "id" = $1`,
            [conversationId, sourceType],
        );
        await db.query("COMMIT");
    } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
    }
}

async function applyStatus(db, event) {
    const payload = event.payload || {};
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const providerMessageId = text(payload.providerMessageId, 300);
    const status = ["sent", "delivered", "read", "failed"].includes(payload.messageStatus) ? payload.messageStatus : "sent";
    if (!providerMessageId) return;
    const updated = await db.query(
        `UPDATE "Message" SET "status" = $3
          WHERE "id" = (
              SELECT "id" FROM "Message" WHERE "source_type" = $1 AND "providerMessageId" = $2 ORDER BY "createdAt" DESC LIMIT 1
          ) RETURNING "conversationId"`,
        [sourceType, providerMessageId, status],
    );
    if (updated.rowCount) await db.query(`UPDATE "Conversation" SET "updatedAt" = NOW() WHERE "id" = $1`, [updated.rows[0].conversationId]);
}

async function applyReaction(db, event) {
    const payload = event.payload || {};
    const sourceType = payload.sourceType === "meta" ? "meta" : "wuzapi";
    const targetId = text(payload.targetProviderMessageId, 300);
    if (!targetId) return;
    const updated = await db.query(
        `UPDATE "Message" SET "reaction" = $3
          WHERE "id" = (
              SELECT "id" FROM "Message" WHERE "source_type" = $1 AND "providerMessageId" = $2 ORDER BY "createdAt" DESC LIMIT 1
          ) RETURNING "conversationId"`,
        [sourceType, targetId, typeof payload.reaction === "string" ? payload.reaction.slice(0, 32) : null],
    );
    if (updated.rowCount) await db.query(`UPDATE "Conversation" SET "updatedAt" = NOW() WHERE "id" = $1`, [updated.rows[0].conversationId]);
}

async function processWebhookEvent(work) {
    const { rows } = await control.query(
        `SELECT "id", "tenantId", "provider", "providerEventId", "payload", "status"
           FROM "WebhookEvent" WHERE "id" = $1`,
        [work.recordId],
    );
    const event = rows[0];
    if (!event || !event.tenantId || event.status === "IGNORED" || event.status === "PROCESSED") return;
    if (event.tenantId !== work.tenantId) throw new Error("Webhook work item tenant mismatch.");
    await control.query(`UPDATE "WebhookEvent" SET "status" = 'PROCESSING', "processingError" = NULL WHERE "id" = $1`, [event.id]);
    const db = await tenantPool(event.tenantId);
    try {
        if (event.payload?.kind === "message") await applyMessage(db, event);
        else if (event.payload?.kind === "status") await applyStatus(db, event);
        else if (event.payload?.kind === "reaction") await applyReaction(db, event);
    } finally {
        await db.end();
    }
    await control.query(
        `UPDATE "WebhookEvent" SET "status" = 'PROCESSED', "processedAt" = NOW(), "processingError" = NULL WHERE "id" = $1`,
        [event.id],
    );
}

function awsEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key, value) {
    return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function storageDeleteRequest(storageKey) {
    const endpointRaw = process.env.TENANT_STORAGE_S3_ENDPOINT?.trim() || "";
    const bucket = process.env.TENANT_STORAGE_S3_BUCKET?.trim() || "";
    const accessKeyId = process.env.TENANT_STORAGE_S3_ACCESS_KEY_ID?.trim() || "";
    const secret = process.env.TENANT_STORAGE_S3_SECRET_ACCESS_KEY?.trim() || "";
    if (!endpointRaw || !bucket || !accessKeyId || !secret) throw new Error("Private storage is not configured for maintenance work.");
    const endpoint = new URL(endpointRaw);
    const pathStyle = process.env.TENANT_STORAGE_S3_FORCE_PATH_STYLE !== "false";
    const basePath = endpoint.pathname.replace(/\/+$/, "");
    if (pathStyle) endpoint.pathname = `${basePath}/${awsEncode(bucket)}/${storageKey.split("/").map(awsEncode).join("/")}`.replace(/\/\/{2,}/g, "/");
    else {
        endpoint.hostname = `${bucket}.${endpoint.hostname}`;
        endpoint.pathname = `${basePath}/${storageKey.split("/").map(awsEncode).join("/")}`.replace(/\/\/{2,}/g, "/");
    }
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const region = process.env.TENANT_STORAGE_S3_REGION?.trim() || "us-east-1";
    const payloadHash = sha256("");
    const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const scope = `${stamp}/${region}/s3/aws4_request`;
    const canonicalRequest = ["DELETE", endpoint.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, stamp), region), "s3"), "aws4_request");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString("hex")}`;
    const sessionToken = process.env.TENANT_STORAGE_S3_SESSION_TOKEN?.trim();
    return { url: endpoint.toString(), headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, Authorization: authorization, ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}) } };
}

async function processMaintenance(work) {
    const payload = work.payload || {};
    if (payload.action !== "delete_private_object" || typeof payload.storageKey !== "string") {
        throw new Error("Unsupported maintenance work item.");
    }
    const request = storageDeleteRequest(payload.storageKey);
    const response = await fetch(request.url, { method: "DELETE", headers: request.headers, cache: "no-store" });
    if (!response.ok && response.status !== 404) throw new Error(`Private storage returned ${response.status} while deleting an object.`);
}

async function processWorkItem(work) {
    await heartbeat(work.id);
    if (work.kind === "WEBHOOK_EVENT") return processWebhookEvent(work);
    if (work.kind === "MAINTENANCE") return processMaintenance(work);
    throw new Error(`No worker handler is registered for ${work.kind}.`);
}

async function run() {
    let processed = 0;
    do {
        const work = await claimNextWorkItem();
        if (!work) break;
        try {
            await processWorkItem(work);
            await markSucceeded(work);
            console.info("[TenantWorker] Work item completed", { workId: work.id, tenantId: work.tenantId, kind: work.kind, attempt: work.attempts });
        } catch (error) {
            await markFailed(work, error);
            console.error("[TenantWorker] Work item failed", { workId: work.id, tenantId: work.tenantId, kind: work.kind, attempt: work.attempts, error: cleanError(error) });
        }
        processed += 1;
    } while (drain && processed < maxClaimBatch);
    return processed;
}

try {
    const processed = await run();
    if (once || drain) console.info("[TenantWorker] Run finished", { workerId, processed });
} finally {
    await control.end();
}
