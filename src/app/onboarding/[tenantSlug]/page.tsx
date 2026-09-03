import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTenantAccessForUser } from "@/lib/control-plane";
import { TenantProvisioningRefresh } from "./tenant-provisioning-refresh";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
    PROVISIONING: {
        title: "Estamos preparando tu espacio",
        description: "Creamos una base aislada, aplicamos la configuración inicial y comprobamos que todo esté listo.",
    },
    FAILED: {
        title: "No pudimos terminar la preparación",
        description: "El equipo puede revisar el intento y reanudarlo sin que tengas que crear otro negocio.",
    },
    SUSPENDED: {
        title: "Este espacio está suspendido",
        description: "Contacta al equipo de soporte si consideras que se trata de un error.",
    },
    ARCHIVED: {
        title: "Este espacio fue archivado",
        description: "Contacta al equipo de soporte si necesitas recuperarlo.",
    },
} as const;

export default async function TenantOnboardingStatusPage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const session = await auth();
    const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : null;
    const authScope = (session?.user as { authScope?: unknown } | undefined)?.authScope;

    if (!userId || authScope !== "control") {
        redirect("/login");
    }

    let tenant;
    try {
        tenant = await getTenantAccessForUser(userId, tenantSlug);
    } catch {
        notFound();
    }

    if (!tenant) {
        notFound();
    }

    if (tenant.status === "READY") {
        redirect(`/t/${tenant.slug}/onboarding`);
    }

    const content = STATUS_COPY[tenant.status] || STATUS_COPY.PROVISIONING;
    const canRefresh = tenant.status === "PROVISIONING";

    return (
        <main className="mx-auto flex min-h-dvh max-w-xl items-center px-5 py-12">
            <section className="w-full rounded-2xl border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto size-10 rounded-full border-4 border-primary/20 border-t-primary motion-safe:animate-spin" aria-hidden="true" />
                <p className="mt-6 text-sm font-semibold text-primary">{tenant.displayName}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{content.title}</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{content.description}</p>
                {canRefresh ? <TenantProvisioningRefresh /> : null}
            </section>
        </main>
    );
}
