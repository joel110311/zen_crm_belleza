export type TenantUserLookupClient = {
    user: {
        findUnique: (args: {
            where: { id?: string; email?: string };
            select?: { id?: boolean; controlUserId?: boolean; email?: boolean };
        }) => Promise<{ id: string; controlUserId?: string | null; email?: string | null } | null>;
        findFirst: (args: {
            where: { controlUserId?: string | null; email?: string | null };
            select?: { id?: boolean; controlUserId?: boolean; email?: boolean };
        }) => Promise<{ id: string; controlUserId?: string | null; email?: string | null } | null>;
    };
};

let defaultDbPromise: Promise<TenantUserLookupClient | null> | null = null;

async function getDefaultDb(): Promise<TenantUserLookupClient | null> {
    if (!defaultDbPromise) {
        defaultDbPromise = (async () => {
            try {
                const dbModule = await import("./db.ts").catch(() => import("@/lib/db"));
                return (dbModule as unknown as { prisma: TenantUserLookupClient }).prisma;
            } catch {
                return null;
            }
        })();
    }
    return defaultDbPromise;
}

/**
 * Resolves an incoming user ID (which could be a tenant User.id, a control-plane User.id / controlUserId,
 * or null/undefined) to a valid User.id existing within the current tenant database.
 * If the user cannot be found in the current tenant database, returns null.
 * This prevents foreign key constraint violations on Conversation.assignedUserId.
 */
export async function resolveAssignableTenantUserId(
    rawUserId?: string | null,
    dbClient?: TenantUserLookupClient | null,
): Promise<string | null> {
    if (!rawUserId || typeof rawUserId !== "string") return null;
    const trimmed = rawUserId.trim();
    if (!trimmed) return null;

    const db = dbClient || (await getDefaultDb());
    if (!db) return null;

    try {
        // 1. Direct match with tenant User.id
        const directUser = await db.user.findUnique({
            where: { id: trimmed },
            select: { id: true },
        });
        if (directUser) return directUser.id;

        // 2. Match with tenant User.controlUserId (central/control plane ID mapped to tenant user)
        const linkedUser = await db.user.findFirst({
            where: { controlUserId: trimmed },
            select: { id: true },
        });
        if (linkedUser) return linkedUser.id;

        // 3. Fallback match if trimmed looks like an email
        if (trimmed.includes("@")) {
            const userByEmail = await db.user.findUnique({
                where: { email: trimmed },
                select: { id: true },
            });
            if (userByEmail) return userByEmail.id;
        }

        // 4. If control-plane DB is reachable and configured, resolve controlUserId -> email -> tenant user
        if (process.env.CONTROL_DATABASE_URL) {
            try {
                const controlDbModule = await import("./control-db.ts").catch(() => import("@/lib/control-db"));
                const controlUser = await controlDbModule.getControlDb().user.findUnique({
                    where: { id: trimmed },
                    select: { id: true, email: true },
                });
                if (controlUser?.email) {
                    const userByEmail = await db.user.findUnique({
                        where: { email: controlUser.email },
                        select: { id: true },
                    });
                    if (userByEmail) return userByEmail.id;
                }
            } catch {
                // Control plane DB not reachable or not configured
            }
        }
    } catch {
        return null;
    }

    return null;
}
