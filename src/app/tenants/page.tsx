import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getControlDb } from "@/lib/control-db";

export const dynamic = "force-dynamic";

const MEMBERSHIP_LABELS = {
    OWNER: "Propietario",
    ADMIN: "Administrador",
    PROFESSIONAL: "Profesional",
    RECEPTION: "Recepción",
} as const;

export default async function TenantPickerPage() {
    const session = await auth();
    const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
        ? (session?.user as { id: string }).id
        : null;
    const authScope = (session?.user as { authScope?: unknown } | undefined)?.authScope;

    if (!userId || authScope !== "control") {
        redirect("/login");
    }

    const memberships = await getControlDb().tenantMembership.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: {
            role: true,
            tenant: { select: { slug: true, displayName: true, status: true } },
        },
    });

    if (memberships.length === 1) {
        const tenant = memberships[0].tenant;
        redirect(tenant.status === "READY" ? `/t/${tenant.slug}` : `/onboarding/${tenant.slug}`);
    }

    return (
        <main className="mx-auto flex min-h-dvh max-w-3xl items-center px-5 py-12">
            <section className="w-full rounded-2xl border bg-card p-7 shadow-sm">
                <h1 className="text-2xl font-semibold">Elige un negocio</h1>
                <p className="mt-2 text-sm text-muted-foreground">Tu cuenta puede pertenecer a más de un espacio de trabajo.</p>
                {memberships.length === 0 ? (
                    <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">Aún no tienes un negocio asignado.</p>
                ) : (
                    <ul className="mt-6 grid gap-3">
                        {memberships.map(({ role, tenant }) => {
                            const href = tenant.status === "READY" ? `/t/${tenant.slug}` : `/onboarding/${tenant.slug}`;
                            return <li key={tenant.slug}><Link href={href} className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"><p className="font-semibold">{tenant.displayName}</p><p className="mt-1 text-sm text-muted-foreground">{MEMBERSHIP_LABELS[role]} · {tenant.status === "READY" ? "Disponible" : "En preparación"}</p></Link></li>;
                        })}
                    </ul>
                )}
            </section>
        </main>
    );
}
