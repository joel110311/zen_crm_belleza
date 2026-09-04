import "server-only";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/authz";
import type { PermissionKey } from "@/lib/permissions";

/** Enforces the same role check for a typed URL that the sidebar applies visually. */
export async function requireTenantPagePermission(tenantSlug: string, permission: PermissionKey) {
    try {
        await requirePermission(permission);
    } catch {
        redirect(`/t/${encodeURIComponent(tenantSlug)}/dashboard`);
    }
}
