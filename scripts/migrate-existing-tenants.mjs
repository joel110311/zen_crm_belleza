import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const controlDatabaseUrl = process.env.CONTROL_DATABASE_URL?.trim();
const tenantAdminUrl = process.env.TENANT_POSTGRES_ADMIN_URL?.trim();
const clusterKey = process.env.TENANT_POSTGRES_CLUSTER_KEY?.trim() || "primary";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

if (!controlDatabaseUrl) {
    throw new Error("CONTROL_DATABASE_URL is required to migrate existing tenant databases.");
}

if (!tenantAdminUrl) {
    throw new Error("TENANT_POSTGRES_ADMIN_URL is required to migrate existing tenant databases.");
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

function redactError(value) {
    return String(value)
        .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://***@")
        .slice(0, 2_000);
}

function adminDatabaseUrl(databaseName) {
    assertSafeIdentifier(databaseName, "Tenant database name");
    const url = new URL(tenantAdminUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

function runtimeRoleForTenant(tenantId) {
    const role = `zencrm_r_${String(tenantId).toLowerCase()}`;
    assertSafeIdentifier(role, "Tenant runtime role");
    return role;
}

function assertRegisteredDatabase(tenantId, databaseName) {
    const expected = `zencrm_t_${String(tenantId).toLowerCase()}`;
    assertSafeIdentifier(expected, "Expected tenant database name");
    if (databaseName !== expected) {
        throw new Error("Registered tenant database does not match its deterministic name.");
    }
}

async function runTenantMigrations(databaseUrl) {
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(scriptDirectory, "migrate-tenant.mjs")], {
            stdio: "inherit",
            env: { ...process.env, DATABASE_URL: databaseUrl },
        });

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(undefined);
                return;
            }
            reject(new Error(`Tenant migration process failed with exit code ${code}`));
        });
    });
}

async function grantRuntimeAccess(databaseUrl, runtimeRole) {
    const pool = new Pool({ connectionString: databaseUrl });
    const role = quoteIdentifier(runtimeRole);

    try {
        const existingRole = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [runtimeRole]);
        if (existingRole.rowCount === 0) {
            throw new Error(`Runtime role ${runtimeRole} does not exist.`);
        }

        await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
        await pool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
    } finally {
        await pool.end();
    }
}

async function readSchemaVersion(databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
        const result = await pool.query(`
            SELECT migration_name
            FROM _prisma_migrations
            WHERE finished_at IS NOT NULL
            ORDER BY finished_at DESC
            LIMIT 1
        `);
        return result.rows[0]?.migration_name || null;
    } finally {
        await pool.end();
    }
}

const controlPool = new Pool({ connectionString: controlDatabaseUrl });
let failed = false;

try {
    const databases = await controlPool.query(`
        SELECT "tenantId", "databaseName"
        FROM "TenantDatabase"
        WHERE "clusterKey" = $1
          AND status = 'READY'
        ORDER BY "createdAt" ASC
    `, [clusterKey]);

    if (databases.rowCount === 0) {
        console.log(`[Tenant fleet migration] No READY databases found for cluster ${clusterKey}.`);
    }

    for (const database of databases.rows) {
        assertRegisteredDatabase(database.tenantId, database.databaseName);
        const databaseUrl = adminDatabaseUrl(database.databaseName);
        const runtimeRole = runtimeRoleForTenant(database.tenantId);

        try {
            console.log(`[Tenant fleet migration] Migrating ${database.databaseName}...`);
            await runTenantMigrations(databaseUrl);
            await grantRuntimeAccess(databaseUrl, runtimeRole);
            const schemaVersion = await readSchemaVersion(databaseUrl);
            if (!schemaVersion) throw new Error("No completed tenant migration was found.");

            await controlPool.query(`
                UPDATE "TenantDatabase"
                SET "schemaVersion" = $2,
                    "lastMigratedAt" = NOW(),
                    "lastError" = NULL,
                    "updatedAt" = NOW()
                WHERE "tenantId" = $1
            `, [database.tenantId, schemaVersion]);
            console.log(`[Tenant fleet migration] ${database.databaseName} is at ${schemaVersion}.`);
        } catch (error) {
            failed = true;
            const message = redactError(error instanceof Error ? error.message : error);
            await controlPool.query(`
                UPDATE "TenantDatabase"
                SET "lastError" = $2, "updatedAt" = NOW()
                WHERE "tenantId" = $1
            `, [database.tenantId, message]).catch(() => {});
            console.error(`[Tenant fleet migration] ${database.databaseName} failed: ${message}`);
        }
    }
} finally {
    await controlPool.end();
}

if (failed) process.exitCode = 1;
