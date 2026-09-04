import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
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
        const pool = new Pool({ connectionString: runtimeUrl, max: this.poolMax });
        const adapter = new PrismaPg(pool);
        const client = new PrismaClient({ adapter, log: this.logLevels });

        try {
            await client.$queryRaw`SELECT 1`;
            await this.evictToLimit();
            this.entries.set(record.tenantId, {
                client,
                pool,
                expiresAt: Date.now() + this.idleTtlMs,
            });
            return client;
        } catch (error) {
            await client.$disconnect().catch(() => {});
            await pool.end().catch(() => {});
            throw error;
        }
    }

    private async evictExpiredEntries(): Promise<void> {
        const now = Date.now();
        const expired = [...this.entries.entries()].filter(([, entry]) => entry.expiresAt <= now);

        for (const [tenantId, entry] of expired) {
            this.entries.delete(tenantId);
            await this.disconnectEntry(entry);
        }
    }

    private async evictToLimit(): Promise<void> {
        while (this.entries.size >= this.maxClients) {
            const oldest = this.entries.entries().next().value as
                | [string, CachedTenantClient]
                | undefined;

            if (!oldest) {
                return;
            }

            this.entries.delete(oldest[0]);
            await this.disconnectEntry(oldest[1]);
        }
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
