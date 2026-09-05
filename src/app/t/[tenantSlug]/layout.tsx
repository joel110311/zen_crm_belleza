import { notFound, redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { InboxNotifier } from "@/components/layout/inbox-notifier";
import { Sidebar } from "@/components/layout/sidebar";
import { UnreadTabBadge } from "@/components/layout/unread-tab-badge";
import { WaitingRoomNotifier } from "@/components/layout/waiting-room-notifier";
import { SessionProvider } from "@/components/providers/session-provider";
import { ActiveTenantCookie } from "@/components/tenant/active-tenant-cookie";
import { TenantNavigationBridge } from "@/components/tenant/tenant-navigation-bridge";
import { auth } from "@/lib/auth";
import { requireTenantRuntimeContext, TenantAccessDeniedError } from "@/lib/tenant-context";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default async function TenantLayout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode;
    params: Promise<{ tenantSlug: string }>;
}>) {
    if (!isMultitenantRuntimeEnabled()) {
        notFound();
    }

    const session = await auth();
    const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : null;
    const authScope = (session?.user as { authScope?: unknown } | undefined)?.authScope;

    if (!userId || authScope !== "control") {
        const { tenantSlug } = await params;
        redirect(`/login?redirectTo=${encodeURIComponent(`/t/${tenantSlug}`)}`);
    }

    let tenant;
    try {
        const { tenantSlug } = await params;
        // The shell displays the signed-in member.  Resolve the runtime context here so
        // every tenant page receives both the access grant and the local operational user.
        tenant = await requireTenantRuntimeContext(userId, tenantSlug, "read");
    } catch (error) {
        if (error instanceof TenantAccessDeniedError) {
            notFound();
        }
        throw error;
    }

    return (
        <SessionProvider session={session}>
            <div
                className="apple-workspace flex h-screen w-full overflow-hidden bg-background"
                data-apple-workspace
                data-business={tenant.slug}
            >
                <ActiveTenantCookie tenantSlug={tenant.slug} />
                <TenantNavigationBridge tenantSlug={tenant.slug} />
                <InboxNotifier />
                <WaitingRoomNotifier />
                <UnreadTabBadge />
                <Sidebar />
                <DashboardShell>
                    {children}
                </DashboardShell>
            </div>
        </SessionProvider>
    );
}
