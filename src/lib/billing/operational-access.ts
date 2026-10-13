import "server-only";
import { getControlDb } from "@/lib/control-db";
import { workspaceBillingSelection, workspaceBillingState } from "@/lib/billing/workspace-access";

export async function isTenantOperational(tenantId: string) {
    const tenant = await getControlDb().tenant.findUnique({
        where: { id: tenantId }, select: { status: true, accessMode: true, timeZone: true, ...workspaceBillingSelection },
    });
    return Boolean(tenant && tenant.status === "READY" && workspaceBillingState(tenant).accessMode === "FULL");
}
