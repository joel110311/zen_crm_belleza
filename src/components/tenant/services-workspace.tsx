"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Power, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";
import { useTenantRole } from "@/components/tenant/tenant-shell";

type SpecialistOption = { id: string; name: string; displayName: string | null; isActive: boolean };
type Service = {
    id: string; name: string; description: string | null; price: number; currency: string;
    durationMinutes: number; isActive: boolean; isFeatured: boolean;
    _count: { appointments: number };
    specialists: Array<{ specialistId: string; specialist: SpecialistOption }>;
};
type Category = { id: string; name: string; description: string | null; color: string | null; isActive: boolean; services: Service[] };
type Catalog = { categories: Category[]; specialists: SpecialistOption[] };

export function ServicesWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const role = useTenantRole();
    const canManage = role === "OWNER" || role === "ADMIN";
    const api = tenantApiBase(tenantSlug);
    const [catalog, setCatalog] = useState<Catalog>({ categories: [], specialists: [] });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [categoryName, setCategoryName] = useState("");

    const load = useCallback(async () => {
        try {
            setCatalog(await tenantApi<Catalog>(`${api}/services`));
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el catálogo.");
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => { void load(); }, [load]);

    const activeCategories = useMemo(() => catalog.categories.filter((category) => category.isActive), [catalog.categories]);

    async function createCategory(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/service-categories`, { method: "POST", body: JSON.stringify({ name: categoryName }) });
            setCategoryName(""); setSuccess("Categoría creada."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear la categoría."); }
        finally { setSaving(false); }
    }

    async function createService(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/services`, {
                method: "POST",
                body: JSON.stringify({
                    name: form.get("name"), categoryId: form.get("categoryId"),
                    price: Number(form.get("price")), durationMinutes: Number(form.get("durationMinutes")),
                    description: form.get("description"), specialistIds: form.getAll("specialistIds"),
                }),
            });
            formElement.reset(); setShowForm(false); setSuccess("Servicio creado."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear el servicio."); }
        finally { setSaving(false); }
    }

    async function toggleService(service: Service) {
        setError(null);
        try {
            await tenantApi(`${api}/services/${service.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !service.isActive }) });
            await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar."); }
    }

    async function removeService(service: Service) {
        if (!window.confirm(`¿Eliminar “${service.name}”?`)) return;
        setError(null);
        try {
            await tenantApi(`${api}/services/${service.id}`, { method: "DELETE" });
            setSuccess("Servicio eliminado."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo eliminar."); }
    }

    return (
        <ResourcePage title="Servicios" description="Catálogo, precios, duración y profesionales disponibles dentro de este negocio." action={canManage ? <Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nuevo servicio</Button> : undefined}>
            <div className="space-y-5">
                <Feedback error={error} success={success} />
                {canManage ? <form onSubmit={createCategory} className="flex max-w-xl gap-2 rounded-2xl border bg-card p-4">
                    <Input required maxLength={160} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Nueva categoría" aria-label="Nueva categoría" />
                    <Button type="submit" variant="outline" disabled={saving}>Agregar</Button>
                </form> : null}
                {showForm ? (
                    <form onSubmit={createService} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Nombre"><Input required name="name" maxLength={160} /></Field>
                        <Field label="Categoría"><select required name="categoryId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
                        <Field label="Precio"><Input required name="price" type="number" min="0" step="0.01" defaultValue="0" /></Field>
                        <Field label="Duración (min)"><Input required name="durationMinutes" type="number" min="5" max="480" step="5" defaultValue="30" /></Field>
                        <Field label="Descripción" className="sm:col-span-2"><Input name="description" maxLength={1000} /></Field>
                        <Field label="Profesionales" className="sm:col-span-2"><select multiple name="specialistIds" className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm">{catalog.specialists.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name}</option>)}</select></Field>
                        <div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={saving || activeCategories.length === 0}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar servicio</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div>
                    </form>
                ) : null}
                {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : catalog.categories.length === 0 ? <EmptyState>Crea una categoría y después tu primer servicio.</EmptyState> : (
                    <div className="space-y-6">
                        {catalog.categories.map((category) => (
                            <section key={category.id} className="overflow-hidden rounded-2xl border bg-card">
                                <header className="flex items-center gap-3 border-b px-5 py-4"><span className="size-3 rounded-full" style={{ backgroundColor: category.color || "#B7923A" }} /><div><h2 className="font-semibold">{category.name}</h2><p className="text-xs text-muted-foreground">{category.services.length} servicio(s)</p></div></header>
                                {category.services.length === 0 ? <p className="px-5 py-7 text-sm text-muted-foreground">Sin servicios en esta categoría.</p> : <ul className="divide-y">{category.services.map((service) => (
                                    <li key={service.id} className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${service.isActive ? "" : "opacity-55"}`}>
                                        <div className="flex gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Scissors className="size-4" /></span><div><p className="font-medium">{service.name}</p><p className="mt-1 text-sm text-muted-foreground">{service.durationMinutes} min · {new Intl.NumberFormat("es-MX", { style: "currency", currency: service.currency }).format(service.price)} · {service.specialists.length} profesional(es)</p></div></div>
                                        {canManage ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void toggleService(service)}><Power className="mr-1.5 size-3.5" />{service.isActive ? "Desactivar" : "Activar"}</Button><Button size="icon" variant="ghost" onClick={() => void removeService(service)} aria-label={`Eliminar ${service.name}`}><Trash2 className="size-4" /></Button></div> : null}
                                    </li>
                                ))}</ul>}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </ResourcePage>
    );
}
