import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";
import { createRuntimePool } from "@/lib/runtime-pool";
import { getControlDb } from "@/lib/control-db";
import { decryptTenantRuntimeUrl } from "@/lib/tenant-credentials";

type TenantDatabaseRecord = {
    tenantId: string;
    status: "ALLOCATED" | "CREATING" | "MIGRATING" | "READY" | "FAILED" | "DECOMMISSIONED";
    runtimeUrlCiphertext: Uint8Array;
    runtimeSecretKeyVersion: number;
};

type CachedTenantClient = {
    client: PrismaClient;
    pool: Pool;
    expiresAt: number;
};

type TenantPrismaManagerGlobals = {
    tenantPrismaManager?: TenantPrismaManager;
};

const globalForTenantPrismaManager = globalThis as typeof globalThis & TenantPrismaManagerGlobals;

function readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export class TenantDatabaseUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TenantDatabaseUnavailableError";
    }
}

/**
 * Keeps a bounded LRU cache of runtime clients. Each client always points to one isolated
 * tenant database, never to the control plane or the legacy DATABASE_URL.
 */
export class TenantPrismaManager {
    private readonly entries = new Map<string, CachedTenantClient>();
    private readonly pendingClients = new Map<string, Promise<PrismaClient>>();
    private readonly reservedClients = new Set<string>();
    private readonly maxClients = readBoundedInteger("TENANT_PRISMA_MAX_CLIENTS", 20, 1, 100);
    private readonly idleTtlMs = readBoundedInteger("TENANT_PRISMA_IDLE_TTL_MS", 300_000, 1_000, 3_600_000);
    private readonly poolMax = readBoundedInteger("TENANT_PRISMA_POOL_MAX", 5, 1, 20);
    private readonly logLevels: Prisma.LogLevel[] =
        process.env.PRISMA_LOG_QUERIES === "true"
            ? ["query", "warn", "error"]
            : ["warn", "error"];

    async getForTenant(tenantId: string): Promise<PrismaClient> {
        const record = await getControlDb().tenantDatabase.findUnique({
            where: { tenantId },
            select: {
                tenantId: true,
                status: true,
                runtimeUrlCiphertext: true,
                runtimeSecretKeyVersion: true,
            },
        });

        if (!record || record.status !== "READY") {
            throw new TenantDatabaseUnavailableError("La base del negocio todavía no está disponible.");
        }

        return this.getOrCreate(record);
    }

    async disconnectAll(): Promise<void> {
        const entries = [...this.entries.values()];
        this.entries.clear();
        await Promise.all(entries.map((entry) => this.disconnectEntry(entry)));
    }

    private async getOrCreate(record: TenantDatabaseRecord): Promise<PrismaClient> {
        await this.evictExpiredEntries();
        const existing = this.entries.get(record.tenantId);

        if (existing) {
            existing.expiresAt = Date.now() + this.idleTtlMs;
            this.entries.delete(record.tenantId);
            this.entries.set(record.tenantId, existing);
            return existing.client;
        }

        const pending = this.pendingClients.get(record.tenantId);
        if (pending) {
            return pending;
        }

        const creation = this.createClient(record);
        this.pendingClients.set(record.tenantId, creation);

        try {
            return await creation;
        } finally {
            this.pendingClients.delete(record.tenantId);
        }
    }

    private async createClient(record: TenantDatabaseRecord): Promise<PrismaClient> {
        const runtimeUrl = decryptTenantRuntimeUrl(
            record.runtimeUrlCiphertext,
            record.runtimeSecretKeyVersion,
        );
        // Reserve before network I/O, so simultaneous workspace startups cannot exceed the cap.
        await this.reserveClient(record.tenantId);
        let pool: Pool | undefined;
        let client: PrismaClient | undefined;
        try {
            pool = createRuntimePool(runtimeUrl, "tenant", this.poolMax);
            const adapter = new PrismaPg(pool);
            client = new PrismaClient({ adapter, log: this.logLevels });
            await client.$queryRaw`SELECT 1`;
            this.entries.set(record.tenantId, {
                client,
                pool,
                expiresAt: Date.now() + this.idleTtlMs,
            });
            return client;
        } catch (error) {
            await client?.$disconnect().catch(() => {});
            await pool?.end().catch(() => {});
            const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
            console.error("[TenantDatabase] Connection failed", { tenantId: record.tenantId, code: typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? code : "DATABASE_ERROR" });
            throw new TenantDatabaseUnavailableError("La base del negocio no está disponible temporalmente. Vuelve a intentarlo.");
        } finally {
            this.reservedClients.delete(record.tenantId);
        }
    }

    private async evictExpiredEntries(): Promise<void> {
        const now = Date.now();
        const expired = [...this.entries.entries()].filter(([, entry]) => entry.expiresAt <= now && this.isIdle(entry));

        for (const [tenantId, entry] of expired) {
            // Closing a previous pool yields: another request may have refreshed this one.
            if (this.entries.get(tenantId) !== entry || entry.expiresAt > Date.now() || !this.isIdle(entry)) continue;
            this.entries.delete(tenantId);
            await this.disconnectEntry(entry);
        }
    }

    private async reserveClient(tenantId: string): Promise<void> {
        if (this.entries.size + this.reservedClients.size >= this.maxClients) {
            // Do not kill another workspace's connection/transaction to make room.
            const idle = [...this.entries.entries()].find(([, entry]) => this.isIdle(entry));
            if (!idle) throw new TenantDatabaseUnavailableError("El negocio está ocupado temporalmente. Vuelve a intentarlo en unos momentos.");
            this.entries.delete(idle[0]);
            this.reservedClients.add(tenantId);
            await this.disconnectEntry(idle[1]);
            return;
        }
        this.reservedClients.add(tenantId);
    }

    private isIdle(entry: CachedTenantClient): boolean {
        return entry.pool.waitingCount === 0 && entry.pool.totalCount === entry.pool.idleCount;
    }

    private async disconnectEntry(entry: CachedTenantClient): Promise<void> {
        await entry.client.$disconnect().catch(() => {});
        await entry.pool.end().catch(() => {});
    }
}

export function getTenantPrismaManager(): TenantPrismaManager {
    if (!globalForTenantPrismaManager.tenantPrismaManager) {
        globalForTenantPrismaManager.tenantPrismaManager = new TenantPrismaManager();
    }

    return globalForTenantPrismaManager.tenantPrismaManager;
}
