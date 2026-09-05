import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const maxAttempts = Number.parseInt(process.env.LEGACY_MIGRATION_DB_MAX_ATTEMPTS || "40", 10);
const retryMs = Number.parseInt(process.env.LEGACY_MIGRATION_DB_RETRY_MS || "3000", 10);
const migrationsDirectory = path.resolve(process.cwd(), "prisma/legacy-runtime-migrations");

if (!databaseUrl) throw new Error("DATABASE_URL is required to migrate the legacy database.");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatabase(pool) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            console.log(`[Legacy migration] Database ready (attempt ${attempt}/${maxAttempts}).`);
            return;
        } catch (error) {
            lastError = error;
            console.warn(`[Legacy migration] Database unavailable (attempt ${attempt}/${maxAttempts}).`);
            if (attempt < maxAttempts) await sleep(retryMs);
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Legacy database did not become available in time.");
}

async function deploy(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS "_legacy_runtime_migrations" (
            "name" TEXT PRIMARY KEY,
            "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    const names = (await readdir(migrationsDirectory))
        .filter((name) => name.endsWith(".sql"))
        .sort();

    for (const name of names) {
        const applied = await pool.query('SELECT 1 FROM "_legacy_runtime_migrations" WHERE "name"=$1', [name]);
        if (applied.rowCount) continue;

        const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query('INSERT INTO "_legacy_runtime_migrations" ("name") VALUES ($1)', [name]);
            await client.query("COMMIT");
            console.log(`[Legacy migration] Applied ${name}.`);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
}

const pool = new Pool({ connectionString: databaseUrl });
try {
    await waitForDatabase(pool);
    await deploy(pool);
    console.log("[Legacy migration] Legacy database is ready.");
} finally {
    await pool.end();
}
