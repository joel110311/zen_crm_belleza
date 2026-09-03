"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, Loader2, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";
import { useTenantRole } from "@/components/tenant/tenant-shell";

type Contact = {
    id: string; name: string | null; lastName: string | null; phone: string; email: string | null;
    company: string | null; status: string; tags: string[]; updatedAt: string;
    _count: { appointments: number; conversations: number; deals: number; patients: number };
    deals: Array<{ stage: { name: string; color: string } }>;
};
type ContactPage = { items: Contact[]; page: number; pageSize: number; total: number };

export function ContactsWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const role = useTenantRole();
    const canManage = role !== "PROFESSIONAL";
    const api = tenantApiBase(tenantSlug);
    const [result, setResult] = useState<ContactPage>({ items: [], page: 1, pageSize: 25, total: 0 });
    const [query, setQuery] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const search = activeQuery ? `?q=${encodeURIComponent(activeQuery)}` : "";
            setResult(await tenantApi<ContactPage>(`${api}/contacts${search}`)); setError(null);
        } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los contactos."); }
        finally { setLoading(false); }
    }, [activeQuery, api]);
    useEffect(() => { void load(); }, [load]);

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/contacts`, { method: "POST", body: JSON.stringify({
                name: form.get("name"), lastName: form.get("lastName"), phone: form.get("phone"),
                email: form.get("email"), company: form.get("company"), status: "customer", tags: ["Cliente"],
            }) });
            formElement.reset(); setShowForm(false); setSuccess("Contacto y ficha de paciente creados."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear el contacto."); }
        finally { setSaving(false); }
    }

    async function archive(contact: Contact) {
        if (!window.confirm(`¿Archivar a ${contact.name || contact.phone}?`)) return;
        try { await tenantApi(`${api}/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) }); setSuccess("Contacto archivado sin perder historial."); await load(); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo archivar."); }
    }

    return (
        <ResourcePage title="Contactos" description="Directorio comercial unificado con su actividad, citas y etapa más reciente." action={canManage ? <Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nuevo contacto</Button> : undefined}>
            <div className="space-y-5">
                <Feedback error={error} success={success} />
                <form onSubmit={(event) => { event.preventDefault(); setLoading(true); setActiveQuery(query.trim()); }} className="flex max-w-xl gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, teléfono, correo o empresa" /><Button type="submit" variant="outline"><Search className="size-4" /><span className="sr-only">Buscar</span></Button></form>
                {showForm ? <form onSubmit={create} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Nombre"><Input required name="name" maxLength={160} /></Field><Field label="Apellidos"><Input name="lastName" maxLength={160} /></Field><Field label="Teléfono"><Input required name="phone" maxLength={40} /></Field><Field label="Correo"><Input name="email" type="email" maxLength={160} /></Field><Field label="Empresa"><Input name="company" maxLength={160} /></Field><div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div>
                </form> : null}
                {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : result.items.length === 0 ? <EmptyState>{activeQuery ? "No encontramos contactos con esa búsqueda." : "Agrega el primer contacto del negocio."}</EmptyState> : (
                    <div className="overflow-hidden rounded-2xl border bg-card"><div className="border-b px-5 py-3 text-xs text-muted-foreground">{result.total} contacto(s)</div><ul className="divide-y">{result.items.map((contact) => <li key={contact.id} className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${contact.status === "archived" ? "opacity-50" : ""}`}>
                        <div className="flex min-w-0 gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="size-4" /></span><div className="min-w-0"><p className="truncate font-medium">{[contact.name, contact.lastName].filter(Boolean).join(" ") || "Sin nombre"}</p><p className="truncate text-sm text-muted-foreground">{contact.phone}{contact.email ? ` · ${contact.email}` : ""}{contact.company ? ` · ${contact.company}` : ""}</p><div className="mt-2 flex flex-wrap gap-1.5">{contact.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{tag}</span>)}{contact.deals[0] ? <span className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ backgroundColor: contact.deals[0].stage.color }}>{contact.deals[0].stage.name}</span> : null}</div></div></div>
                        <div className="flex items-center gap-4"><div className="text-right text-xs text-muted-foreground"><p>{contact._count.appointments} citas</p><p>{contact._count.deals} oportunidades</p></div>{canManage && contact.status !== "archived" ? <Button size="icon" variant="ghost" onClick={() => void archive(contact)} aria-label="Archivar contacto"><Archive className="size-4" /></Button> : null}</div>
                    </li>)}</ul></div>
                )}
            </div>
        </ResourcePage>
    );
}
