import "server-only";

import { auth } from "@/lib/auth";
import { getControlDb } from "@/lib/control-db";

export class PlatformAdminAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 = 403) {
        super(message);
        this.name = "PlatformAdminAccessError";
    }
}

function configuredAdminEmails() {
    return new Set(
        `${process.env.PLATFORM_ADMIN_EMAILS || ""},${process.env.INITIAL_ADMIN_EMAIL || ""}`
            .split(",")
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
    );
}

export async function requirePlatformAdmin() {
    const session = await auth();
    const sessionUser = session?.user as { id?: unknown; email?: unknown; authScope?: unknown } | undefined;
    if (typeof sessionUser?.id !== "string" || sessionUser.authScope !== "control") {
        throw new PlatformAdminAccessError("Debes iniciar sesión.", 401);
    }
    const user = await getControlDb().user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, email: true, name: true, isPlatformAdmin: true },
    });
    if (!user) throw new PlatformAdminAccessError("La cuenta no está disponible.", 401);

    const configured = configuredAdminEmails().has(user.email.toLowerCase());
    if (!user.isPlatformAdmin && configured) {
        await getControlDb().user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } });
        return { ...user, isPlatformAdmin: true };
    }
    if (!user.isPlatformAdmin) throw new PlatformAdminAccessError("No tienes acceso al centro de mando.");
    return user;
}
