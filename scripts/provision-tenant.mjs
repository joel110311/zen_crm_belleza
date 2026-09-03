import "dotenv/config";
import crypto from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const controlDatabaseUrl = process.env.CONTROL_DATABASE_URL?.trim();
const tenantAdminUrl = process.env.TENANT_POSTGRES_ADMIN_URL?.trim();
const clusterKey = process.env.TENANT_POSTGRES_CLUSTER_KEY?.trim() || "primary";
const encryptionKey = readEncryptionKey(process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY);
const encryptionKeyVersion = readPositiveInteger(process.env.TENANT_CREDENTIALS_KEY_VERSION, 1);
const staleLockSeconds = readPositiveInteger(process.env.PROVISIONER_STALE_LOCK_SECONDS, 900);
const trialDays = readPositiveInteger(process.env.TENANT_TRIAL_DAYS, 7);
const drainQueue = process.argv.includes("--drain");
const workerId = process.env.PROVISIONER_ID?.trim() || `${os.hostname()}:${process.pid}`;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

if (!controlDatabaseUrl) {
    throw new Error("CONTROL_DATABASE_URL is required by the provisioner.");
}

if (!tenantAdminUrl) {
    throw new Error("TENANT_POSTGRES_ADMIN_URL is required by the provisioner.");
}

function readEncryptionKey(value) {
    if (!value?.trim()) {
        throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY is required by the provisioner.");
    }

    const key = Buffer.from(value.trim(), "base64");
    if (key.length !== 32) {
        throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }

    return key;
}

function readPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

function assertSafeIdentifier(value, label) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
        throw new Error(`${label} is not a safe PostgreSQL identifier.`);
    }
}

function quoteIdentifier(identifier) {
    assertSafeIdentifier(identifier, "PostgreSQL identifier");
    return `"${identifier}"`;
}

function quoteLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function redactError(value) {
    return String(value)
        .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://***@")
        .slice(0, 2_000);
}

function buildDatabaseIdentifiers(tenantId) {
    const suffix = tenantId.toLowerCase();
    assertSafeIdentifier(`t_${suffix}`, "Tenant id");

    const databaseName = `zencrm_t_${suffix}`;
    const migrationRole = `zencrm_m_${suffix}`;
    const runtimeRole = `zencrm_r_${suffix}`;

    assertSafeIdentifier(databaseName, "Tenant database name");
    assertSafeIdentifier(migrationRole, "Tenant migration role");
    assertSafeIdentifier(runtimeRole, "Tenant runtime role");

    return { databaseName, migrationRole, runtimeRole };
}

function buildConnectionUrl(baseUrl, databaseName, username, password) {
    const url = new URL(baseUrl);
    url.pathname = `/${databaseName}`;
    url.username = username;
    url.password = password;
    return url.toString();
}

function buildAdminDatabaseUrl(baseUrl, databaseName) {
    const url = new URL(baseUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

function encryptRuntimeUrl(runtimeUrl) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(runtimeUrl, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, ciphertext]);
}

async function runNodeScript(scriptPath, databaseUrl) {
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], {
            stdio: "inherit",
            env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
            },
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(undefined);
                return;
            }
            reject(new Error(`${scriptPath} failed with exit code ${code}`));
        });
    });
}

async function claimNextJob(controlPool) {
    const client = await controlPool.connect();

    try {
        await client.query("BEGIN");
        const claim = await client.query(
            `
            WITH candidate AS (
                SELECT id
                FROM "ProvisioningJob"
                WHERE kind = 'CREATE_TENANT_DATABASE'
                  AND attempts < "maxAttempts"
                  AND "nextRunAt" <= NOW()
                  AND (
                    status IN ('PENDING', 'RETRY_WAIT')
                    OR (status = 'RUNNING' AND "lockedAt" < NOW() - ($1 * INTERVAL '1 second'))
                  )
                ORDER BY "createdAt" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE "ProvisioningJob" AS job
            SET status = 'RUNNING',
                "lockedAt" = NOW(),
                "lockedBy" = $2,
                attempts = attempts + 1,
                "updatedAt" = NOW()
            FROM candidate
            WHERE job.id = candidate.id
            RETURNING job.id, job."tenantId", job.attempts, job."maxAttempts"
            `,
            [staleLockSeconds, workerId],
        );

        if (claim.rowCount === 0) {
            await client.query("COMMIT");
            return null;
        }

        const job = claim.rows[0];
        const details = await client.query(
            `
            SELECT
                job.id,
                job."tenantId",
                job.attempts,
                job."maxAttempts",
                tenant.slug,
                tenant."displayName",
                tenant."timeZone"
            FROM "ProvisioningJob" AS job
            INNER JOIN "Tenant" AS tenant ON tenant.id = job."tenantId"
            WHERE job.id = $1 AND job."lockedBy" = $2
            `,
            [job.id, workerId],
        );

        await client.query(
            `
            UPDATE "Tenant"
            SET status = 'PROVISIONING',
                "provisioningStatus" = 'RUNNING',
                "updatedAt" = NOW()
            WHERE id = $1
            `,
            [job.tenantId],
        );
        await client.query("COMMIT");

        return details.rows[0];
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function updateStep(controlPool, jobId, step) {
    await controlPool.query(
        `
        UPDATE "ProvisioningJob"
        SET step = $2, "updatedAt" = NOW()
        WHERE id = $1 AND status = 'RUNNING' AND "lockedBy" = $3
        `,
        [jobId, step, workerId],
    );
}

async function upsertTenantDatabase(controlPool, tenantId, databaseName, runtimeUrl, status, schemaVersion = null, lastError = null) {
    await controlPool.query(
        `
        INSERT INTO "TenantDatabase" (
            id,
            "tenantId",
            "clusterKey",
            "databaseName",
            "runtimeUrlCiphertext",
            "runtimeSecretKeyVersion",
            status,
            "schemaVersion",
            "lastMigratedAt",
            "lastError",
            "createdAt",
            "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::"TenantDatabaseStatus", $8, NULL, $9, NOW(), NOW())
        ON CONFLICT ("tenantId") DO UPDATE SET
            "clusterKey" = EXCLUDED."clusterKey",
            "databaseName" = EXCLUDED."databaseName",
            "runtimeUrlCiphertext" = EXCLUDED."runtimeUrlCiphertext",
            "runtimeSecretKeyVersion" = EXCLUDED."runtimeSecretKeyVersion",
            status = EXCLUDED.status,
            "schemaVersion" = EXCLUDED."schemaVersion",
            "lastError" = EXCLUDED."lastError",
            "updatedAt" = NOW()
        `,
        [
            createId(),
            tenantId,
            clusterKey,
            databaseName,
            encryptRuntimeUrl(runtimeUrl),
            encryptionKeyVersion,
            status,
            schemaVersion,
            lastError,
        ],
    );
}

async function setTenantDatabaseMigrated(controlPool, tenantId, schemaVersion) {
    await controlPool.query(
        `
        UPDATE "TenantDatabase"
        SET status = 'READY',
            "schemaVersion" = $2,
            "lastMigratedAt" = NOW(),
            "lastError" = NULL,
            "updatedAt" = NOW()
        WHERE "tenantId" = $1
        `,
        [tenantId, schemaVersion],
    );
}

async function ensureRole(adminPool, roleName, password) {
    const quotedRole = quoteIdentifier(roleName);
    const existing = await adminPool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);

    if (existing.rowCount === 0) {
        await adminPool.query(
            `CREATE ROLE ${quotedRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
        );
        return;
    }

    await adminPool.query(
        `ALTER ROLE ${quotedRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
    );
}

async function ensureDatabase(adminPool, databaseName, migrationRole) {
    const existing = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount === 0) {
        await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(migrationRole)}`);
    }
    await adminPool.query(`ALTER DATABASE ${quoteIdentifier(databaseName)} SET timezone TO 'UTC'`);
}

async function configureTenantDatabase(tenantAdminPool, databaseName, migrationRole, runtimeRole) {
    const quotedDatabase = quoteIdentifier(databaseName);
    const quotedMigrationRole = quoteIdentifier(migrationRole);
    const quotedRuntimeRole = quoteIdentifier(runtimeRole);

    await tenantAdminPool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await tenantAdminPool.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await tenantAdminPool.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedMigrationRole}, ${quotedRuntimeRole}`);
    await tenantAdminPool.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await tenantAdminPool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRuntimeRole}`);
    await tenantAdminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRuntimeRole}`);
    await tenantAdminPool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quotedRuntimeRole}`);
}

async function configureMigrationRoleDefaultPrivileges(migrationUrl, runtimeRole) {
    const migrationPool = new Pool({ connectionString: migrationUrl });
    const quotedRuntimeRole = quoteIdentifier(runtimeRole);

    try {
        await migrationPool.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntimeRole}`,
        );
        await migrationPool.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedRuntimeRole}`,
        );
    } finally {
        await migrationPool.end();
    }
}

async function readSchemaVersion(runtimeUrl) {
    const pool = new Pool({ connectionString: runtimeUrl });

    try {
        const result = await pool.query(
            `
            SELECT migration_name
            FROM _prisma_migrations
            WHERE finished_at IS NOT NULL
            ORDER BY finished_at DESC
            LIMIT 1
            `,
        );
        return result.rows[0]?.migration_name || null;
    } finally {
        await pool.end();
    }
}

async function markSucceeded(controlPool, job, databaseName, schemaVersion) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1_000);
    const client = await controlPool.connect();

    try {
        await client.query("BEGIN");
        await client.query(
            `
            UPDATE "Tenant"
            SET status = 'READY',
                "provisioningStatus" = 'SUCCEEDED',
                "updatedAt" = NOW()
            WHERE id = $1
            `,
            [job.tenantId],
        );
        await client.query(
            `
            INSERT INTO "Trial" (id, "tenantId", "startsAt", "endsAt", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT ("tenantId") DO NOTHING
            `,
            [createId(), job.tenantId, now, trialEndsAt],
        );
        await client.query(
            `
            UPDATE "ProvisioningJob"
            SET status = 'SUCCEEDED',
                step = 'complete',
                result = $2::jsonb,
                error = NULL,
                "lockedAt" = NULL,
                "lockedBy" = NULL,
                "updatedAt" = NOW()
            WHERE id = $1 AND "lockedBy" = $3
            `,
            [
                job.id,
                JSON.stringify({
                    clusterKey,
                    databaseName,
                    schemaVersion,
                }),
                workerId,
            ],
        );
        await client.query(
            `
            INSERT INTO "AuditLog" (id, "tenantId", action, "resourceType", "resourceId", metadata, "createdAt")
            VALUES ($1, $2, 'tenant.provisioned', 'TenantDatabase', $3, $4::jsonb, NOW())
            `,
            [createId(), job.tenantId, databaseName, JSON.stringify({ clusterKey, schemaVersion })],
        );
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function markFailed(controlPool, job, message) {
    const finalAttempt = job.attempts >= job.maxAttempts;
    const retryDelaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, job.attempts - 1));
    const status = finalAttempt ? "FAILED" : "RETRY_WAIT";

    await controlPool.query(
        `
        UPDATE "ProvisioningJob"
        SET status = $2::"ProvisioningStatus",
            error = $3,
            "nextRunAt" = CASE WHEN $4 THEN NOW() ELSE NOW() + ($5 * INTERVAL '1 second') END,
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "updatedAt" = NOW()
        WHERE id = $1 AND "lockedBy" = $6
        `,
        [job.id, status, message, finalAttempt, retryDelaySeconds, workerId],
    );
    await controlPool.query(
        `
        UPDATE "Tenant"
        SET status = CASE WHEN $2 THEN 'FAILED'::"TenantStatus" ELSE 'PROVISIONING'::"TenantStatus" END,
            "provisioningStatus" = $3::"ProvisioningStatus",
            "updatedAt" = NOW()
        WHERE id = $1
        `,
        [job.tenantId, finalAttempt, status],
    );
    await controlPool.query(
        `
        UPDATE "TenantDatabase"
        SET status = 'FAILED', "lastError" = $2, "updatedAt" = NOW()
        WHERE "tenantId" = $1
        `,
        [job.tenantId, message],
    );
}

async function provisionJob(controlPool, adminPool, job) {
    const { databaseName, migrationRole, runtimeRole } = buildDatabaseIdentifiers(job.tenantId);
    const migrationPassword = crypto.randomBytes(32).toString("base64url");
    const runtimePassword = crypto.randomBytes(32).toString("base64url");
    const migrationUrl = buildConnectionUrl(tenantAdminUrl, databaseName, migrationRole, migrationPassword);
    const runtimeUrl = buildConnectionUrl(tenantAdminUrl, databaseName, runtimeRole, runtimePassword);
    let tenantAdminPool;

    try {
        await updateStep(controlPool, job.id, "creating_roles");
        await ensureRole(adminPool, migrationRole, migrationPassword);
        await ensureRole(adminPool, runtimeRole, runtimePassword);

        await updateStep(controlPool, job.id, "creating_database");
        await ensureDatabase(adminPool, databaseName, migrationRole);
        await upsertTenantDatabase(controlPool, job.tenantId, databaseName, runtimeUrl, "CREATING");

        tenantAdminPool = new Pool({ connectionString: buildAdminDatabaseUrl(tenantAdminUrl, databaseName) });
        await configureTenantDatabase(tenantAdminPool, databaseName, migrationRole, runtimeRole);
        await configureMigrationRoleDefaultPrivileges(migrationUrl, runtimeRole);

        await updateStep(controlPool, job.id, "migrating_schema");
        await upsertTenantDatabase(controlPool, job.tenantId, databaseName, runtimeUrl, "MIGRATING");
        await runNodeScript(path.join(scriptDirectory, "migrate-tenant.mjs"), migrationUrl);

        await updateStep(controlPool, job.id, "seeding_defaults");
        await runNodeScript(path.join(scriptDirectory, "seed-tenant.mjs"), runtimeUrl);

        await updateStep(controlPool, job.id, "verifying_runtime");
        const schemaVersion = await readSchemaVersion(runtimeUrl);
        if (!schemaVersion) {
            throw new Error("No completed Prisma migration was found in the tenant database.");
        }

        await setTenantDatabaseMigrated(controlPool, job.tenantId, schemaVersion);
        await markSucceeded(controlPool, job, databaseName, schemaVersion);
        console.log(`[Provisioner] Tenant ${job.slug} is READY.`);
        return true;
    } catch (error) {
        const message = redactError(error instanceof Error ? error.message : error);
        console.error(`[Provisioner] Tenant ${job.slug} failed: ${message}`);
        await markFailed(controlPool, job, message);
        return false;
    } finally {
        await tenantAdminPool?.end();
    }
}

const controlPool = new Pool({ connectionString: controlDatabaseUrl });
const adminPool = new Pool({ connectionString: tenantAdminUrl });
let didFail = false;

try {
    do {
        const job = await claimNextJob(controlPool);
        if (!job) {
            console.log("[Provisioner] No eligible tenant provisioning jobs.");
            break;
        }

        const succeeded = await provisionJob(controlPool, adminPool, job);
        didFail ||= !succeeded;
    } while (drainQueue);
} finally {
    await adminPool.end();
    await controlPool.end();
}

if (didFail) {
    process.exitCode = 1;
}
