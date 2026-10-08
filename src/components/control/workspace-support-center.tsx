"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ShieldCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Workspace = { id: string; displayName: string; slug: string; status: string; accessMode: string; createdAt: string };
type Listing = { tenants: Workspace[]; total: number; page: number; pageSize: number };

export function WorkspaceSupportCenter() {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(0);
    const [listing, setListing] = useState<Listing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState<{ tenant: Workspace; destination: "dashboard" | "onboarding" } | null>(null);
    const [pending, setPending] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        async function load() {
            setLoading(true); setError("");
            try {
                const response = await fetch(`/api/control/support?q=${encodeURIComponent(query)}&page=${page}`, { cache: "no-store", signal: abort.signal });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "No fue posible cargar los negocios.");
                if (!abort.signal.aborted) setListing(payload);
            } catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Error al cargar."); }
            finally { if (!abort.signal.aborted) setLoading(false); }
        }
        void load();
        return () => abort.abort();
    }, [query, page]);

    async function enter(form: HTMLFormElement) {
        if (!selected) return;
        setPending(true); setError("");
        try {
            const data = new FormData(form);
            const response = await fetch("/api/control/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
                tenantId: selected.tenant.id, destination: selected.destination,
                mode: data.get("mode"), reason: data.get("reason"),
            }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No fue posible abrir el negocio.");
            router.push(payload.destination);
        } catch (err) { setError(err instanceof Error ? err.message : "Error al abrir."); }
        finally { setPending(false); }
    }

    return <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-1 size-6 shrink-0 text-primary" /><div>
            <h2 className="text-xl font-semibold">Revisar negocios</h2>
            <p className="mt-1 text-sm text-muted-foreground">Acceso administrativo a todos los espacios, incluidos los recién creados. Los cambios se realizan en el negocio seleccionado; cada acceso queda registrado.</p>
        </div></div>
        <form className="mt-5 flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(0); setQuery(search.trim()); }}>
            <label htmlFor="support-search" className="sr-only">Buscar negocio por nombre o identificador</label>
            <input id="support-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="Buscar cualquier negocio…" className="min-w-0 flex-1 rounded-xl border bg-background px-4 py-2" />
            <button className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"><Search className="size-4" />Buscar</button>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando negocios…</p> : <>
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="p-3">Negocio</th><th className="p-3">Estado</th><th className="p-3">Creado</th><th className="p-3">Revisar</th></tr></thead><tbody>
                {listing?.tenants.map((tenant) => <tr key={tenant.id} className="border-b last:border-0"><td className="p-3"><p className="font-medium">{tenant.displayName}</p><p className="text-xs text-muted-foreground">/{tenant.slug}</p></td><td className="p-3">{tenant.status}<p className="text-xs text-muted-foreground">{tenant.accessMode}</p></td><td className="p-3">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(tenant.createdAt))}</td><td className="p-3"><div className="flex flex-wrap gap-2">
                    <button type="button" disabled={tenant.status !== "READY"} onClick={() => { setError(""); setSelected({ tenant, destination: "dashboard" }); }} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">Abrir CRM</button>
                    <button type="button" disabled={tenant.status === "ARCHIVED"} onClick={() => { setError(""); setSelected({ tenant, destination: "onboarding" }); }} className="rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-40">{tenant.status === "READY" ? "Revisar alta" : "Ver preparación"}</button>
                </div></td></tr>)}
            </tbody></table>{listing?.total === 0 ? <p className="p-4 text-sm text-muted-foreground">No se encontraron negocios.</p> : null}</div>
            <div className="mt-4 flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{listing?.total || 0} negocios · Página {page + 1}</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full border px-3 py-1.5 disabled:opacity-40">Anterior</button><button type="button" disabled={!listing || (page + 1) * listing.pageSize >= listing.total} onClick={() => setPage(page + 1)} className="rounded-full border px-3 py-1.5 disabled:opacity-40">Siguiente</button></div></div>
        </>}
        <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !pending) setSelected(null); }}>
            <DialogContent showCloseButton={!pending}>
            {selected ? <form onSubmit={(event) => { event.preventDefault(); void enter(event.currentTarget); }}>
                <DialogHeader><DialogTitle>Abrir {selected.tenant.displayName}</DialogTitle>
                <DialogDescription>Sesión de 30 minutos. Abrir otro negocio sustituye esta sesión. Regresa mediante Centro de mando.</DialogDescription></DialogHeader>
                <label className="mt-5 block text-sm font-medium">Acceso<select name="mode" defaultValue="FULL" className="mt-2 w-full rounded-xl border bg-background px-3 py-2"><option value="FULL">Completo: consultar y editar</option><option value="READ_ONLY">Solo consultar</option></select></label>
                <label className="mt-4 block text-sm font-medium">Motivo de la revisión<textarea name="reason" required minLength={5} maxLength={500} defaultValue="Verificar el alta y funcionamiento del CRM" rows={3} className="mt-2 w-full rounded-xl border bg-background px-3 py-2" /></label>
                {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
                <button disabled={pending} className="mt-5 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "Abriendo…" : "Entrar al negocio"}</button>
            </form> : null}
            </DialogContent>
        </Dialog>
    </section>;
}
