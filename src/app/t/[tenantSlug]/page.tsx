import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantContext } from "@/lib/tenant-context";

export default async function TenantHomePage({
    params,
}: {
    params: Promise<{ tenantSlug: string }>;
}) {
    const { tenantSlug } = await params;
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;

    if (!userId) {
        return null;
    }

    const tenant = await requireTenantContext(userId, tenantSlug, "read");

    return (
        <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
            <section className="w-full rounded-xl border bg-card p-8 shadow-sm">
                <p className="text-sm text-muted-foreground">Entorno de negocio</p>
                <h1 className="mt-2 text-2xl font-semibold">{tenant.displayName}</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                    Tu entorno está listo. Configura los datos iniciales antes de abrir el primer panel.
                </p>
                <Link
                    className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                    href={`/t/${tenant.slug}/onboarding`}
                >
                    Configurar negocio
                </Link>
            </section>
        </main>
    );
}
