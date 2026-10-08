import "server-only";
import { Pool } from "pg";

export function boundedDatabaseInteger(name: string, fallback: number, minimum: number, maximum: number) {
    const raw = process.env[name]?.trim() || "";
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

/** Runtime only: migrations keep their own unrestricted administrative connections. */
export function createRuntimePool(connectionString: string, scope: "control" | "tenant" | "legacy", max: number) {
    const pool = new Pool({
        connectionString,
        max,
        connectionTimeoutMillis: boundedDatabaseInteger("DATABASE_CONNECTION_TIMEOUT_MS", 5_000, 500, 30_000),
        statement_timeout: boundedDatabaseInteger("DATABASE_STATEMENT_TIMEOUT_MS", 60_000, 5_000, 300_000),
        idle_in_transaction_session_timeout: 60_000,
        idleTimeoutMillis: 30_000,
    });
    // pg discards failed idle connections; report safely without crashing the shared process.
    // Never print the Error object: messages can contain credentials/connection details.
    pool.on("error", (error: unknown) => {
        const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
        console.error("[DatabasePool] Idle connection failed", {
            scope,
            code: typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? code : "DATABASE_ERROR",
        });
    });
    return pool;
}
