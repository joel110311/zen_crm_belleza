import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DATABASE_CHECK_TIMEOUT_MS = 2000;

type HealthDatabaseState = {
    ok: boolean;
    latencyMs: number;
    error?: string;
};

async function checkDatabaseHealth(): Promise<HealthDatabaseState> {
    const startedAt = Date.now();
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
        await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error("Database healthcheck timed out"));
                }, DATABASE_CHECK_TIMEOUT_MS);
            }),
        ]);

        return {
            ok: true,
            latencyMs: Date.now() - startedAt,
        };
    } catch (error) {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const strict = scope === "ready" || searchParams.get("strict") === "1";
    const mode = strict ? "readiness" : "liveness";

    const database = await checkDatabaseHealth();
    const status = strict && !database.ok ? 503 : 200;

    return NextResponse.json(
        {
            ok: status < 400,
            mode,
            service: "zen-crm-go",
            timestamp: new Date().toISOString(),
            database,
        },
        { status },
    );
}
