import "server-only";
import type { PrismaClient } from "@prisma/client";
import { getTenantAccessForUser, normalizeTenantSlug, type TenantAccess } from "@/lib/control-plane";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";
import { ensureTenantActor, type TenantActor } from "@/lib/tenant-actor";

export type TenantOperation = "read" | "write" | "billing";
export type TenantContext = TenantAccess;
export type TenantRuntimeContext = TenantContext & {
    db: PrismaClient;
    actor: TenantActor;
};

export type TenantAccessDeniedReason =
    | "TENANT_NOT_FOUND"
    | "TENANT_NOT_READY"
    | "TENANT_SUSPENDED"
    | "BILLING_REQUIRED"
    | "READ_ONLY";

export class TenantAccessDeniedError extends Error {
    constructor(
        message: string,
        public readonly reason: TenantAccessDeniedReason = "TENANT_NOT_FOUND",
    ) {
        super(message);
        this.name = "TenantAccessDeniedError";
    }
}

/**
 * Resolves the URL slug through the control plane and fails closed before any tenant database
 * credential is loaded. Call this in a server route, action, or layout — never in Edge middleware.
 */
export async function requireTenantContext(
    userId: string,
    tenantSlug: string,
    operation: TenantOperation = "read",
): Promise<TenantContext> {
    let normalizedSlug: string;
    try {
        normalizedSlug = normalizeTenantSlug(tenantSlug);
    } catch {
        throw new TenantAccessDeniedError("No tienes acceso a este negocio.", "TENANT_NOT_FOUND");
    }

    const context = await getTenantAccessForUser(userId, normalizedSlug);
    if (!context) {
        throw new TenantAccessDeniedError("No tienes acceso a este negocio.", "TENANT_NOT_FOUND");
    }

    if (context.status === "SUSPENDED" || context.accessMode === "SUSPENDED") {
        throw new TenantAccessDeniedError("El acceso a este negocio está suspendido.", "TENANT_SUSPENDED");
    }

    if (context.status !== "READY") {
        throw new TenantAccessDeniedError("Este negocio todavía no está listo para usarse.", "TENANT_NOT_READY");
    }

    if (context.accessMode === "BILLING_ONLY" && operation !== "billing") {
        throw new TenantAccessDeniedError("Este negocio requiere atención de facturación.", "BILLING_REQUIRED");
    }

    if (context.accessMode === "READ_ONLY" && operation === "write") {
        throw new TenantAccessDeniedError("Este negocio está disponible sólo para lectura.", "READ_ONLY");
    }

    return context;
}

export async function getTenantDb(context: TenantContext): Promise<PrismaClient> {
    return getTenantPrismaManager().getForTenant(context.tenantId);
}

/**
 * Resolves access, opens the isolated database and projects the global user into a local
 * operational actor. Migrated services should receive this context instead of importing db.ts.
 */
export async function requireTenantRuntimeContext(
    userId: string,
    tenantSlug: string,
    operation: TenantOperation = "read",
): Promise<TenantRuntimeContext> {
    const context = await requireTenantContext(userId, tenantSlug, operation);
    const db = await getTenantDb(context);
    const actor = await ensureTenantActor(db, context, userId);
    return { ...context, db, actor };
}
