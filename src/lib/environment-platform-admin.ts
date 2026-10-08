import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getControlDb } from "@/lib/control-db";
import { ENVIRONMENT_ADMIN_ID } from "@/lib/platform-admin-policy";

export { ENVIRONMENT_ADMIN_ID } from "@/lib/platform-admin-policy";
const INTERNAL_ADMIN_EMAIL = "platform-env-admin@platform.invalid";

function configuration() {
    const username = (process.env.ADMIN_USERNAME || "adminjoel").trim();
    const password = process.env.ADMIN_PASSWORD || "";
    const sessionSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username) || password.length < 20 || password.length > 128 || !sessionSecret) return null;
    return { username, password, sessionSecret };
}

export function environmentAdminCredentialVersion(): string | null {
    const config = configuration();
    return config ? createHmac("sha256", config.sessionSecret).update(JSON.stringify([config.username, config.password])).digest("hex") : null;
}

/** Dedicated platform login, not a tenant role, and never a public signup path. */
export async function authorizeEnvironmentPlatformAdmin(username: unknown, password: unknown) {
    const config = configuration();
    if (!config || typeof username !== "string" || typeof password !== "string" || password.length > 128) return null;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    const validPassword = timingSafeEqual(digest(password), digest(config.password));
    if (username.trim() !== config.username || !validPassword) return null;

    // A fixed reserved ID cannot collide with the CUIDs allocated to ordinary registrations.
    // The password stays in Portainer; there is no email/password or Google login for this user.
    const db = getControlDb();
    const user = await db.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { id: ENVIRONMENT_ADMIN_ID } });
        if (existing) return existing;
        const created = await tx.user.upsert({
            where: { id: ENVIRONMENT_ADMIN_ID },
            create: { id: ENVIRONMENT_ADMIN_ID, email: INTERNAL_ADMIN_EMAIL, name: "Administrador de plataforma", passwordHash: null, isPlatformAdmin: true },
            update: {},
        });
        await tx.auditLog.create({ data: {
            actorUserId: created.id,
            action: "platform_admin.environment_initialized",
            resourceType: "User", resourceId: created.id,
            metadata: { method: "environment_credentials" },
        } });
        return created;
    });
    // An explicit DB revocation is authoritative; login must not silently undo it.
    if (!user.isPlatformAdmin || user.email !== INTERNAL_ADMIN_EMAIL || user.passwordHash) return null;
    if (await db.accountDeletion.findUnique({ where: { userId: user.id } })) return null;
    return {
        id: user.id, email: user.email, name: config.username,
        role: "RECEPCION", permissions: [], authScope: "control" as const,
        securityVersion: user.securityVersion, isPlatformAdmin: true,
        platformAdminCredentialVersion: environmentAdminCredentialVersion(),
    };
}
