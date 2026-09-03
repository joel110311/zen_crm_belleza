"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Power, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";
import { useTenantRole } from "@/components/tenant/tenant-shell";

type Specialist = {
    id: string; name: string; displayName: string | null; specialty: string | null; email: string | null;
    phone: string | null; color: string | null; room: string | null; isActive: boolean;
    defaultDurationMinutes: number; _count: { appointments: number; availabilityBlocks: number };
    services: Array<{ service: { id: string; name: string; isActive: boolean } }>;
};

export function SpecialistsWorkspace({ tenantSlug, embedded = false }: { tenantSlug: string; embedded?: boolean }) {
    const role = useTenantRole();
    const canManage = role === "OWNER" || role === "ADMIN";
    const api = tenantApiBase(tenantSlug);
    const [items, setItems] = useState<Specialist[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        try { setItems(await tenantApi<Specialist[]>(`${api}/specialists?includeInactive=true`)); setError(null); }
        catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el equipo."); }
        finally { setLoading(false); }
    }, [api]);
    useEffect(() => { void load(); }, [load]);

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/specialists`, { method: "POST", body: JSON.stringify({
                name: form.get("name"), specialty: form.get("specialty"), email: form.get("email"),
                phone: form.get("phone"), room: form.get("room"), color: form.get("color"),
                defaultDurationMinutes: Number(form.get("defaultDurationMinutes")),
            }) });
            formElement.reset(); setShowForm(false); setSuccess("Profesional agregado."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo guardar."); }
        finally { setSaving(false); }
    }

    async function toggle(item: Specialist) {
        setError(null);
        try { await tenantApi(`${api}/specialists/${item.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !item.isActive }) }); await load(); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar."); }
    }

    const content = (
        <div className="space-y-5">
                {embedded && canManage ? <div className="flex justify-end"><Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nuevo profesional</Button></div> : null}
                <Feedback error={error} success={success} />
                {showForm ? <form onSubmit={create} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Nombre"><Input required name="name" maxLength={160} /></Field>
                    <Field label="Especialidad"><Input name="specialty" maxLength={160} placeholder="Belleza" /></Field>
                    <Field label="Correo"><Input name="email" type="email" maxLength={160} /></Field>
                    <Field label="Teléfono"><Input name="phone" maxLength={40} /></Field>
                    <Field label="Espacio / cabina"><Input name="room" maxLength={100} /></Field>
                    <Field label="Duración base"><Input name="defaultDurationMinutes" type="number" min="15" max="180" step="5" defaultValue="30" /></Field>
                    <Field label="Color"><Input name="color" type="color" defaultValue="#2563EB" className="p-1" /></Field>
                    <div className="flex items-end gap-2 sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div>
                </form> : null}
                {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : items.length === 0 ? <EmptyState>Agrega al primer profesional para habilitar la agenda.</EmptyState> : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className={`rounded-2xl border bg-card p-5 ${item.isActive ? "" : "opacity-55"}`}>
                        <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: item.color || "#2563EB" }}><UserRound className="size-5" /></span><div><h2 className="font-semibold">{item.displayName || item.name}</h2><p className="text-sm text-muted-foreground">{item.specialty || "Profesional"}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.isActive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{item.isActive ? "Activo" : "Inactivo"}</span></div>
                        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Citas</dt><dd className="mt-1 font-semibold">{item._count.appointments}</dd></div><div><dt className="text-muted-foreground">Servicios</dt><dd className="mt-1 font-semibold">{item.services.length}</dd></div><div><dt className="text-muted-foreground">Duración base</dt><dd className="mt-1">{item.defaultDurationMinutes} min</dd></div><div><dt className="text-muted-foreground">Espacio</dt><dd className="mt-1">{item.room || "—"}</dd></div></dl>
                        {canManage ? <Button className="mt-5 w-full" variant="outline" size="sm" onClick={() => void toggle(item)}><Power className="mr-2 size-4" />{item.isActive ? "Desactivar" : "Activar"}</Button> : null}
                    </article>)}</div>
                )}
        </div>
    );

    if (embedded) return content;

    return (
        <ResourcePage title="Equipo" description="Profesionales, especialidades y disponibilidad del negocio." action={canManage ? <Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nuevo profesional</Button> : undefined}>
            {content}
        </ResourcePage>
    );
}
