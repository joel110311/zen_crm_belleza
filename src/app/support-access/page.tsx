import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { getControlDb } from "@/lib/control-db";
import { supportWorkspaceReturnPath } from "@/lib/platform-admin-policy";
import { tenantDashboardPath, tenantSlugFromPath, normalizeRequestTenantSlug } from "@/lib/tenant-request-routing";
import { SupportReentry } from "./support-reentry";

export const dynamic = "force-dynamic";

/** A rewrite keeps the original address. No tenant runtime, customer records or auto-redirects. */
export default async function SupportAccessPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
    const { returnTo } = await searchParams;
    let target: { tenantId: string; name: string; returnTo: string; mode: "FULL" | "READ_ONLY" } | null = null;
    let signedIn = false;
    try {
        const admin = await requirePlatformAdmin();
        signedIn = true;
        const db = getControlDb();
        const setting = await db.platformRuntimeSetting.findUnique({ where: { key: `support.workspace.${admin.id}` } });
        const previous = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value) ? setting.value as Record<string, unknown> : {};
        const requested = new URL(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/", "https://support.invalid");
        const slug = tenantSlugFromPath(requested.pathname) || normalizeRequestTenantSlug(requested.pathname.match(/^\/onboarding\/([^/]+)$/)?.[1])
            || ((requested.pathname === "/dashboard" || requested.pathname.startsWith("/dashboard/")) ? normalizeRequestTenantSlug(typeof previous.slug === "string" ? previous.slug : null) : null);
        const tenant = slug ? await db.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, displayName: true, status: true } }) : null;
        if (tenant && tenant.status !== "ARCHIVED") {
            const path = requested.pathname.startsWith("/dashboard") ? `${tenantDashboardPath(tenant.slug, requested.pathname)}${requested.search}` : returnTo;
            target = { tenantId: tenant.id, name: tenant.displayName, returnTo: supportWorkspaceReturnPath(tenant.slug, path) || `/t/${encodeURIComponent(tenant.slug)}/dashboard`, mode: previous.tenantId === tenant.id && previous.mode === "READ_ONLY" ? "READ_ONLY" : "FULL" };
        }
    } catch {
        // Auth/backend failures never disclose a tenant and never send the browser to /control.
    }
    return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12"><section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        <h1 className="text-2xl font-semibold">Esta revisión no está activa</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">La revisión pudo vencer o cambiar de negocio en otra pestaña. No cerramos tu cuenta ni te enviamos al centro de mando. Los datos del cliente permanecen protegidos.</p>
        {target ? <SupportReentry {...target} /> : <p className="mt-4 text-sm">{signedIn ? "No fue posible recuperar esta revisión. Intenta recargar nuevamente." : "Inicia sesión como administrador para continuar."}</p>}
        <div className="mt-6 flex flex-wrap gap-4 text-sm"><Link href="/control/login" className="text-primary">Iniciar sesión administrativa</Link><Link href="/control" className="text-muted-foreground">Ir al centro de mando</Link></div>
    </section></main>;
}
