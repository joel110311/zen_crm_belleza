import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { createRoutedPrismaClient } from "@/lib/routed-prisma";

const globalForPrisma = globalThis as unknown as {
    legacyPrisma: PrismaClient | undefined;
};
const prismaLogLevels: Prisma.LogLevel[] =
    process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"];

// Safe Prisma client initialization to prevent build-time crashes
let prismaInstance: PrismaClient;

try {
    if (globalForPrisma.legacyPrisma) {
        prismaInstance = globalForPrisma.legacyPrisma;
    } else {
        const connectionString = process.env.DATABASE_URL?.trim();
        if (!connectionString) {
            // The multitenant runtime deliberately has no legacy DATABASE_URL. Keep imports and
            // static generation side-effect free; actual legacy data access still fails clearly.
            prismaInstance = new Proxy({} as PrismaClient, {
                get(_target, property) {
                    throw new Error(`DATABASE_URL is required for legacy Prisma access (${String(property)}).`);
                },
            });
        } else {
            const pool = new Pool({ connectionString });
            const adapter = new PrismaPg(pool);
            prismaInstance = new PrismaClient({ adapter, log: prismaLogLevels });
        }
    }
} catch (error) {
    console.warn("Failed to initialize Prisma Client (this is expected during build):", error);
    // Return a proxy or mock to prevent import crashes, but usages will fail if not handled
    prismaInstance = {} as PrismaClient;
}

export const prisma = createRoutedPrismaClient(prismaInstance);

if (process.env.NODE_ENV !== "production") globalForPrisma.legacyPrisma = prismaInstance;
