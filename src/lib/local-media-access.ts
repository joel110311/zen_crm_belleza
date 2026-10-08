import "server-only";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getScopedTenantId } from "@/lib/routed-prisma";
import { mediaOwnedByTenant } from "@/lib/chat-media-policy";

export async function assertLocalMediaOwnership(filename: string) {
    // Public legacy images may be reused by catalogs. Tenant-owned files may not.
    const scoped = getScopedTenantId();
    const tenantId = scoped && scoped !== "legacy" ? scoped : (await getActiveTenantRuntimeContext("read"))?.tenantId || null;
    if (!mediaOwnedByTenant(filename, tenantId)) throw new Error("El archivo pertenece a otro negocio.");
}
