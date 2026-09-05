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
import { getControlDb } from "@/lib/control-db";

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
            if (error.reason === "BILLING_REQUIRED") {
                const { tenantSlug } = await params;
                redirect(`/billing/${encodeURIComponent(tenantSlug)}`);
            }
            notFound();
        }
        throw error;
    }

    const billingSnapshot = await getControlDb().tenant.findUnique({
        where: { id: tenant.tenantId },
        select: {
            trial: { select: { id: true, endsAt: true, status: true, warningHours: true } },
            billingSelection: {
                select: { status: true, plan: { select: { name: true, monthlyAmountCents: true, currency: true } } },
            },
            subscriptions: {
                where: { provider: "STRIPE", status: "TRIALING" },
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { plan: { select: { name: true, monthlyAmountCents: true, currency: true } } },
            },
        },
    });
    const selectedPlan = billingSnapshot?.billingSelection && ["PENDING_SETUP", "SCHEDULED", "PROCESSING"].includes(billingSnapshot.billingSelection.status)
        ? billingSnapshot.billingSelection.plan
        : billingSnapshot?.subscriptions[0]?.plan || null;
    const trialNotice = billingSnapshot?.trial && ["ACTIVE", "ENDING"].includes(billingSnapshot.trial.status)
        ? {
            id: billingSnapshot.trial.id,
            tenantSlug: tenant.slug,
            endsAt: billingSnapshot.trial.endsAt.toISOString(),
            warningHours: billingSnapshot.trial.warningHours,
            selectedPlanName: selectedPlan?.name || null,
            selectedPlanAmountCents: selectedPlan?.monthlyAmountCents || null,
            currency: selectedPlan?.currency || "MXN",
            canManage: tenant.role === "OWNER",
        }
        : null;

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
                <DashboardShell trialNotice={trialNotice}>
                    {children}
                </DashboardShell>
            </div>
        </SessionProvider>
    );
}
