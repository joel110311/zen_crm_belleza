import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import {
    requireTenantRuntimeContext,
    type TenantOperation,
    type TenantRuntimeContext,
} from "@/lib/tenant-context";
import {
    TENANT_SCOPE_HEADER,
    TENANT_SLUG_HEADER,
    TENANT_USER_HEADER,
    normalizeRequestTenantSlug,
} from "@/lib/tenant-request-routing";
import type { AccessSubject } from "@/lib/permissions";

type ActiveTenantIdentity = {
    slug: string;
    userId: string;
};

const readActiveTenantIdentity = cache(async (): Promise<ActiveTenantIdentity | null> => {
    const requestHeaders = await headers();
    if (requestHeaders.get(TENANT_SCOPE_HEADER) !== "control") return null;

    const slug = normalizeRequestTenantSlug(requestHeaders.get(TENANT_SLUG_HEADER));
    const userId = requestHeaders.get(TENANT_USER_HEADER)?.trim() || "";
    if (!slug || !userId) {
        throw new Error("No se pudo resolver de forma segura el negocio activo.");
    }

    return { slug, userId };
});

const resolveReadContext = cache(async () => resolveActiveTenantRuntimeUncached("read"));
const resolveWriteContext = cache(async () => resolveActiveTenantRuntimeUncached("write"));

async function resolveActiveTenantRuntimeUncached(operation: TenantOperation): Promise<TenantRuntimeContext | null> {
    const identity = await readActiveTenantIdentity();
    if (!identity) return null;
    return requireTenantRuntimeContext(identity.userId, identity.slug, operation);
}

export async function getActiveTenantRuntimeContext(
    operation: TenantOperation = "read",
): Promise<TenantRuntimeContext | null> {
    return operation === "write" ? resolveWriteContext() : resolveReadContext();
}

export async function getActiveTenantPrisma(operation: TenantOperation = "read"): Promise<PrismaClient | null> {
    return (await getActiveTenantRuntimeContext(operation))?.db || null;
}

export async function getActiveTenantAccessSubject(): Promise<AccessSubject | null> {
    const context = await getActiveTenantRuntimeContext("read");
    if (!context) return null;

    const role = context.role === "OWNER" || context.role === "ADMIN"
        ? "ADMINISTRADOR"
        : context.role === "PROFESSIONAL"
            ? "PROFESIONAL"
            : "RECEPCION";

    return { role, permissions: context.actor.permissions };
}
