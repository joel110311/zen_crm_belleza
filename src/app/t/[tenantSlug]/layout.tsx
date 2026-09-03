import { notFound, redirect } from "next/navigation";
import { ApplePageTransition } from "@/components/layout/apple-page-transition";
import { TenantShell } from "@/components/tenant/tenant-shell";
import { auth } from "@/lib/auth";
import { requireTenantContext, TenantAccessDeniedError } from "@/lib/tenant-context";
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
        tenant = await requireTenantContext(userId, tenantSlug, "read");
    } catch (error) {
        if (error instanceof TenantAccessDeniedError) {
            notFound();
        }
        throw error;
    }

    return (
        <div className="apple-workspace min-h-dvh bg-background" data-apple-workspace>
            <TenantShell
                tenantSlug={tenant.slug}
                displayName={tenant.displayName}
                userName={tenant.actor.name || tenant.actor.email}
                role={tenant.role}
            >
                <ApplePageTransition>{children}</ApplePageTransition>
            </TenantShell>
        </div>
    );
}
