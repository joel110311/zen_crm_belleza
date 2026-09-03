import "dotenv/config";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const maxAttempts = Number.parseInt(process.env.TENANT_MIGRATION_DB_MAX_ATTEMPTS || "40", 10);
const retryMs = Number.parseInt(process.env.TENANT_MIGRATION_DB_RETRY_MS || "3000", 10);

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to migrate a tenant database.");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(pool) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            console.log(`[Tenant migration] Database ready (attempt ${attempt}/${maxAttempts}).`);
            return;
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Tenant migration] Database unavailable (attempt ${attempt}/${maxAttempts}): ${message}`);

            if (attempt < maxAttempts) {
                await sleep(retryMs);
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error("Tenant database did not become available in time.");
}

async function migrate() {
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "./node_modules/prisma/build/index.js",
                "migrate",
                "deploy",
                "--config",
                "./prisma.tenant.config.ts",
            ],
            {
                stdio: "inherit",
                env: process.env,
            },
        );

        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(undefined);
                return;
            }
            reject(new Error(`Prisma tenant migration failed with exit code ${code}`));
        });
    });
}

const pool = new Pool({ connectionString: databaseUrl });

try {
    await waitForDatabase(pool);
    console.log("[Tenant migration] Applying immutable tenant migrations...");
    await migrate();
    console.log("[Tenant migration] Tenant database is ready.");
} finally {
    await pool.end();
}
