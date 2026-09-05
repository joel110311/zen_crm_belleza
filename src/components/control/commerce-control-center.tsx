"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Policy = { trialDays: number; warningHours: number; finalWarningHours: number; graceDays: number; version: number };
type Plan = { id: string; slug: string; name: string; monthlyAmountCents: number | null; stripePriceId: string };
type TenantRow = { id: string; displayName: string; slug: string; accessMode: string; billingStatus: string; trialEndsAt: string | null; trialStatus: string | null; selectionStatus: string | null; lastError: string | null };

async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/control/commerce", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "No fue posible guardar el cambio.");
}

export function CommerceControlCenter({ policy, plans, tenants }: { policy: Policy; plans: Plan[]; tenants: TenantRow[] }) {
    const router = useRouter();
    const [pending, setPending] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    async function submit(key: string, body: Record<string, unknown>) {
        setPending(key); setNotice(null);
        try { await mutate(body); setNotice("Cambio guardado y auditado."); router.refresh(); }
        catch (error) { setNotice(error instanceof Error ? error.message : "No fue posible guardar."); }
        finally { setPending(null); }
    }

    return <div className="space-y-6">
        {notice ? <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">{notice}</p> : null}
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Política vigente · v{policy.version}</p><h2 className="mt-1 text-xl font-semibold">Prueba y recuperación de pago</h2></div></div>
            <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit("policy", { action: "policy", trialDays: Number(data.get("trialDays")), warningHours: Number(data.get("warningHours")), finalWarningHours: Number(data.get("finalWarningHours")), graceDays: Number(data.get("graceDays")) }); }}>
                <label className="text-sm font-medium">Duración<select name="trialDays" defaultValue={policy.trialDays} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3"><option value="7">7 días</option><option value="14">14 días</option></select></label>
                <label className="text-sm font-medium">Primer aviso<input name="warningHours" type="number" min="24" max="168" defaultValue={policy.warningHours} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" /><span className="mt-1 block text-xs text-muted-foreground">Horas antes</span></label>
                <label className="text-sm font-medium">Aviso final<input name="finalWarningHours" type="number" min="1" max="48" defaultValue={policy.finalWarningHours} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" /><span className="mt-1 block text-xs text-muted-foreground">Horas antes</span></label>
                <label className="text-sm font-medium">Gracia por pago fallido<input name="graceDays" type="number" min="0" max="30" defaultValue={policy.graceDays} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" /><span className="mt-1 block text-xs text-muted-foreground">Días en solo lectura</span></label>
                <button disabled={pending !== null} className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground sm:col-span-2 lg:col-span-4 lg:w-fit">{pending === "policy" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Publicar nueva versión</button>
            </form>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm"><h2 className="text-xl font-semibold">Planes y precios</h2><p className="mt-1 text-sm text-muted-foreground">El identificador de precio se copia desde Stripe. Vacío mantiene el plan fuera del Checkout.</p><div className="mt-5 grid gap-4 lg:grid-cols-3">{plans.map((plan) => <form key={plan.id} className="rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit(`plan:${plan.id}`, { action: "plan", planId: plan.id, monthlyAmountCents: Math.round(Number(data.get("amount")) * 100), stripePriceId: String(data.get("stripePriceId") || "") }); }}><p className="font-semibold">{plan.name}</p><p className="text-xs text-muted-foreground">{plan.slug}</p><label className="mt-4 block text-sm font-medium">Precio mensual MXN<input name="amount" type="number" min="0" step="1" defaultValue={(plan.monthlyAmountCents || 0) / 100} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3" /></label><label className="mt-3 block text-sm font-medium">Stripe Price ID<input name="stripePriceId" defaultValue={plan.stripePriceId} placeholder="price_..." className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 font-mono text-xs" /></label><button disabled={pending !== null} className="mt-4 inline-flex h-9 items-center justify-center rounded-full border px-4 text-sm font-semibold">{pending === `plan:${plan.id}` ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar plan</button></form>)}</div></section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm"><h2 className="text-xl font-semibold">Pruebas y activaciones</h2><p className="mt-1 text-sm text-muted-foreground">Las extensiones y reintentos requieren un motivo y quedan en auditoría.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Negocio</th><th className="px-3 py-2">Prueba</th><th className="px-3 py-2">Acceso</th><th className="px-3 py-2">Activación</th><th className="px-3 py-2">Acciones</th></tr></thead><tbody>{tenants.map((tenant) => <tr key={tenant.id} className="border-b last:border-0"><td className="px-3 py-3"><p className="font-medium">{tenant.displayName}</p><p className="text-xs text-muted-foreground">/{tenant.slug}</p></td><td className="px-3 py-3">{tenant.trialEndsAt ? <><p>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(tenant.trialEndsAt))}</p><p className="text-xs text-muted-foreground">{tenant.trialStatus}</p></> : "Sin prueba"}</td><td className="px-3 py-3"><p>{tenant.billingStatus}</p><p className="text-xs text-muted-foreground">{tenant.accessMode}</p></td><td className="max-w-56 px-3 py-3"><p>{tenant.selectionStatus || "—"}</p>{tenant.lastError ? <p className="truncate text-xs text-destructive" title={tenant.lastError}>{tenant.lastError}</p> : null}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{tenant.trialEndsAt ? <button type="button" disabled={pending !== null} onClick={() => { const reason = window.prompt("Motivo de la extensión"); if (reason) void submit(`extend:${tenant.id}`, { action: "extend-trial", tenantId: tenant.id, days: 7, reason }); }} className="rounded-full border px-3 py-1.5 text-xs font-semibold">+7 días</button> : null}{tenant.selectionStatus === "FAILED" ? <button type="button" disabled={pending !== null} onClick={() => { const reason = window.prompt("Motivo del reintento"); if (reason) void submit(`retry:${tenant.id}`, { action: "retry-selection", tenantId: tenant.id, reason }); }} className="rounded-full border px-3 py-1.5 text-xs font-semibold">Reintentar cobro</button> : null}</div></td></tr>)}</tbody></table></div></section>
    </div>;
}
