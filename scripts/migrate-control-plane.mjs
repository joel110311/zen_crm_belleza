import "dotenv/config";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const databaseUrl = process.env.CONTROL_DATABASE_URL?.trim();
const adminDatabaseUrl = process.env.TENANT_POSTGRES_ADMIN_URL?.trim();
const requireLeastPrivilege = process.env.CONTROL_DATABASE_REQUIRE_LEAST_PRIVILEGE === "true";
const maxAttempts = Number.parseInt(process.env.CONTROL_MIGRATION_DB_MAX_ATTEMPTS || "40", 10);
const retryMs = Number.parseInt(process.env.CONTROL_MIGRATION_DB_RETRY_MS || "3000", 10);

if (!databaseUrl) {
    throw new Error("CONTROL_DATABASE_URL is required to migrate the control plane database.");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteIdentifier(identifier) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
        throw new Error("The control-plane database name is not a safe PostgreSQL identifier.");
    }
    return `"${identifier}"`;
}

function quoteLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function targetConfig() {
    const url = new URL(databaseUrl);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const runtimeRole = decodeURIComponent(url.username);
    const runtimePassword = decodeURIComponent(url.password);

    if (!databaseName) {
        throw new Error("CONTROL_DATABASE_URL must include a database name.");
    }
    quoteIdentifier(databaseName);

    if (adminDatabaseUrl && (!runtimeRole || !runtimePassword)) {
        throw new Error("CONTROL_DATABASE_URL must include a dedicated runtime username and password.");
    }
    if (runtimeRole) quoteIdentifier(runtimeRole);

    return { databaseName, runtimeRole, runtimePassword };
}

function adminTargetUrl(databaseName) {
    const url = new URL(adminDatabaseUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
}

async function ensureControlDatabase() {
    const target = targetConfig();
    if (!adminDatabaseUrl) {
        if (requireLeastPrivilege) {
            throw new Error("TENANT_POSTGRES_ADMIN_URL is required to enforce a least-privilege control-plane role.");
        }
        return { ...target, migrationUrl: databaseUrl, hasDedicatedRuntimeRole: false };
    }

    const adminUrl = new URL(adminDatabaseUrl);
    const adminRole = decodeURIComponent(adminUrl.username);
    quoteIdentifier(adminRole);
    const hasDedicatedRuntimeRole = target.runtimeRole !== adminRole;
    if (requireLeastPrivilege && !hasDedicatedRuntimeRole) {
        throw new Error("CONTROL_DATABASE_URL must use a non-administrative runtime role.");
    }

    const adminPool = new Pool({ connectionString: adminDatabaseUrl });
    try {
        if (hasDedicatedRuntimeRole) {
            const role = await adminPool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [target.runtimeRole]);
            if (role.rowCount === 0) {
                await adminPool.query(
                    `CREATE ROLE ${quoteIdentifier(target.runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(target.runtimePassword)}`,
                );
            } else {
                await adminPool.query(
                    `ALTER ROLE ${quoteIdentifier(target.runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(target.runtimePassword)}`,
                );
            }
        }

        const existing = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [target.databaseName]);
        if (existing.rowCount === 0) {
            await adminPool.query(`CREATE DATABASE ${quoteIdentifier(target.databaseName)} OWNER ${quoteIdentifier(adminRole)}`);
            console.log(`[Control migration] Created control-plane database ${target.databaseName}.`);
        }
        // Prisma serializes DateTime values as UTC while PostgreSQL TIMESTAMP columns
        // interpret NOW() in the session timezone. Pinning each platform database to UTC
        // keeps SQL queue/expiry comparisons consistent with Prisma-created timestamps.
        await adminPool.query(`ALTER DATABASE ${quoteIdentifier(target.databaseName)} SET timezone TO 'UTC'`);
    } finally {
        await adminPool.end();
    }

    return {
        ...target,
        migrationUrl: adminTargetUrl(target.databaseName),
        hasDedicatedRuntimeRole,
    };
}

async function waitForDatabase(pool) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            console.log(`[Control migration] Database ready (attempt ${attempt}/${maxAttempts}).`);
            return;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Control migration] Database unavailable (attempt ${attempt}/${maxAttempts}): ${message}`);

            if (attempt < maxAttempts) {
                await sleep(retryMs);
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error("Control plane database did not become available in time.");
}

async function migrate(connectionString) {
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "./node_modules/prisma/build/index.js",
                "migrate",
                "deploy",
                "--config",
                "./prisma.control.config.ts",
            ],
            {
                stdio: "inherit",
                env: { ...process.env, CONTROL_DATABASE_URL: connectionString },
            },
        );

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(undefined);
                return;
            }
            reject(new Error(`Prisma control-plane migration failed with exit code ${code}`));
        });
    });
}

async function grantRuntimeAccess(connectionString, target) {
    if (!target.hasDedicatedRuntimeRole) return;

    const pool = new Pool({ connectionString });
    const database = quoteIdentifier(target.databaseName);
    const role = quoteIdentifier(target.runtimeRole);
    try {
        await pool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
        await pool.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
        await pool.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
        await pool.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
    } finally {
        await pool.end();
    }
}

try {
    const target = await ensureControlDatabase();
    const migrationPool = new Pool({ connectionString: target.migrationUrl });
    try {
        await waitForDatabase(migrationPool);
        console.log("[Control migration] Applying immutable control-plane migrations...");
        await migrate(target.migrationUrl);
    } finally {
        await migrationPool.end();
    }

    await grantRuntimeAccess(target.migrationUrl, target);
    const runtimePool = new Pool({ connectionString: databaseUrl });
    try {
        await waitForDatabase(runtimePool);
        await runtimePool.query('SELECT 1 FROM "Tenant" LIMIT 1');
        console.log("[Control migration] Control plane database is ready for the runtime role.");
    } finally {
        await runtimePool.end();
    }
} catch (error) {
    console.error("[Control migration] Fatal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
