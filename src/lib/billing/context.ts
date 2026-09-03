import "server-only";
import { auth } from "@/lib/auth";
import { getControlDb } from "@/lib/control-db";
import { requireTenantContext, TenantAccessDeniedError, type TenantContext } from "@/lib/tenant-context";

export class BillingAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404 = 403) {
        super(message);
        this.name = "BillingAccessError";
    }
}

export type BillingOwnerContext = {
    tenant: TenantContext;
    user: { id: string; email: string };
};

/** Resolves only a tenant owner who may manage the platform subscription. */
export async function requireBillingOwner(tenantSlug: string): Promise<BillingOwnerContext> {
    const session = await auth();
    const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : null;
    const authScope = (session?.user as { authScope?: unknown } | undefined)?.authScope;

    if (!userId || authScope !== "control") {
        throw new BillingAccessError("Debes iniciar sesión.", 401);
    }

    let tenant: TenantContext;
    try {
        tenant = await requireTenantContext(userId, tenantSlug, "billing");
    } catch (error) {
        if (error instanceof TenantAccessDeniedError) {
            throw new BillingAccessError("No tienes acceso a la facturación de este negocio.", 404);
        }
        throw error;
    }

    if (tenant.role !== "OWNER") {
        throw new BillingAccessError("Sólo la persona propietaria puede gestionar la suscripción.");
    }

    const user = await getControlDb().user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
    });
    if (!user) {
        throw new BillingAccessError("Tu cuenta ya no está disponible.", 401);
    }

    return { tenant, user };
}
