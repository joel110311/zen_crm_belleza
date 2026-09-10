import { SettingsWorkspace } from "@/app/dashboard/settings/page";
import { auth } from "@/lib/auth";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";
import { requireTenantContext } from "@/lib/tenant-context";

export default async function TenantSettingsPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const session = await auth();
    const sessionUser = session?.user as { id?: unknown; authScope?: unknown } | undefined;
    let billingHref: string | undefined;

    if (typeof sessionUser?.id === "string" && sessionUser.authScope === "control") {
        try {
            const tenant = await requireTenantContext(sessionUser.id, tenantSlug, "billing");
            if (tenant.role === "OWNER") {
                billingHref = `/billing/${encodeURIComponent(tenant.slug)}`;
            }
        } catch {
            // The tenant layout handles unavailable or unauthorized workspaces.
        }
    }

    return (
        <SettingsWorkspace
            billingHref={billingHref}
            channelsEnabled={isMultitenantChannelsEnabled()}
        />
    );
}
