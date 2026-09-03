import "server-only";
import { Prisma, PrismaClient } from "@/generated/control-plane";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type ControlPlaneGlobals = {
    controlPrisma?: PrismaClient;
    controlPool?: Pool;
};

const globalForControlPlane = globalThis as typeof globalThis & ControlPlaneGlobals;
const prismaLogLevels: Prisma.LogLevel[] =
    process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"];

/**
 * Returns the server-only Prisma client for the platform control plane.
 * Tenant data must never be queried through this client.
 */
export function getControlDb(): PrismaClient {
    if (globalForControlPlane.controlPrisma) {
        return globalForControlPlane.controlPrisma;
    }

    const connectionString = process.env.CONTROL_DATABASE_URL?.trim();
    if (!connectionString) {
        throw new Error("CONTROL_DATABASE_URL is required to access the platform control plane.");
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({ adapter, log: prismaLogLevels });

    globalForControlPlane.controlPool = pool;
    globalForControlPlane.controlPrisma = client;

    return client;
}

export async function disconnectControlDb(): Promise<void> {
    await globalForControlPlane.controlPrisma?.$disconnect();
    await globalForControlPlane.controlPool?.end();
    globalForControlPlane.controlPrisma = undefined;
    globalForControlPlane.controlPool = undefined;
}
