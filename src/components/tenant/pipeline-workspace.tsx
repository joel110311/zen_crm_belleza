"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BriefcaseBusiness, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";

type Deal = { id: string; title: string; value: number; stageId: string; priority: string; source: string; contact: { id: string; name: string | null; lastName: string | null } | null };
type Stage = { id: string; name: string; color: string; order: number; isIncoming: boolean; isClosedWon: boolean; isClosedLost: boolean; deals: Deal[] };
type Pipeline = { stages: Stage[]; contacts: Array<{ id: string; name: string | null; lastName: string | null; phone: string }> };

export function PipelineWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const api = tenantApiBase(tenantSlug);
    const [pipeline, setPipeline] = useState<Pipeline>({ stages: [], contacts: [] });
    const [showDealForm, setShowDealForm] = useState(false); const [showStageForm, setShowStageForm] = useState(false);
    const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        try { setPipeline(await tenantApi<Pipeline>(`${api}/pipeline`)); setError(null); }
        catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el pipeline."); }
        finally { setLoading(false); }
    }, [api]);
    useEffect(() => { void load(); }, [load]);

    async function createDeal(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try { await tenantApi(`${api}/pipeline/deals`, { method: "POST", body: JSON.stringify({ title: form.get("title"), value: Number(form.get("value")), stageId: form.get("stageId"), contactId: form.get("contactId"), priority: form.get("priority"), source: "manual" }) }); formElement.reset(); setShowDealForm(false); setSuccess("Oportunidad creada."); await load(); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo guardar."); }
        finally { setSaving(false); }
    }

    async function createStage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try { await tenantApi(`${api}/pipeline/stages`, { method: "POST", body: JSON.stringify({ name: form.get("name"), color: form.get("color") }) }); formElement.reset(); setShowStageForm(false); setSuccess("Etapa creada."); await load(); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear la etapa."); }
        finally { setSaving(false); }
    }

    async function move(deal: Deal, stageId: string) {
        try { await tenantApi(`${api}/pipeline/deals/${deal.id}`, { method: "PATCH", body: JSON.stringify({ stageId }) }); await load(); }
        catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo mover la oportunidad."); }
    }

    const total = pipeline.stages.filter((stage) => !stage.isClosedWon && !stage.isClosedLost).reduce((sum, stage) => sum + stage.deals.reduce((stageSum, deal) => stageSum + deal.value, 0), 0);
    return <ResourcePage title="Pipeline" description={`Oportunidades del negocio · valor abierto ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(total)}`} action={<div className="flex gap-2"><Button variant="outline" onClick={() => setShowStageForm((value) => !value)}>Nueva etapa</Button><Button onClick={() => setShowDealForm((value) => !value)}><Plus className="mr-2 size-4" />Nueva oportunidad</Button></div>}>
        <div className="space-y-5"><Feedback error={error} success={success} />
            {showStageForm ? <form onSubmit={createStage} className="flex max-w-xl gap-3 rounded-2xl border bg-card p-4"><Input required name="name" placeholder="Nombre de la etapa" maxLength={100} /><Input name="color" type="color" defaultValue="#64748B" className="w-14 p-1" /><Button type="submit" disabled={saving}>Crear</Button></form> : null}
            {showDealForm ? <form onSubmit={createDeal} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4"><Field label="Título"><Input required name="title" maxLength={200} /></Field><Field label="Valor"><Input required name="value" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="Etapa"><select required name="stageId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></Field><Field label="Contacto"><select name="contactId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Sin contacto</option>{pipeline.contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.name, contact.lastName].filter(Boolean).join(" ") || contact.phone}</option>)}</select></Field><Field label="Prioridad"><select name="priority" defaultValue="medium" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></Field><div className="flex items-end gap-2 lg:col-span-3"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar</Button><Button type="button" variant="ghost" onClick={() => setShowDealForm(false)}>Cancelar</Button></div></form> : null}
            {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : pipeline.stages.length === 0 ? <EmptyState>El negocio no tiene etapas configuradas. Crea la primera para comenzar.</EmptyState> : <div className="grid items-start gap-4 overflow-x-auto pb-3" style={{ gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(270px, 1fr))` }}>{pipeline.stages.map((stage) => <section key={stage.id} className="rounded-2xl border bg-card"><header className="flex items-center justify-between border-b px-4 py-3"><div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} /><h2 className="font-semibold">{stage.name}</h2></div><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{stage.deals.length}</span></header><div className="space-y-3 p-3">{stage.deals.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">Sin oportunidades</p> : stage.deals.map((deal) => <article key={deal.id} className="rounded-xl border bg-background p-4 shadow-sm"><div className="flex items-start gap-2"><BriefcaseBusiness className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0"><h3 className="font-medium">{deal.title}</h3><p className="mt-1 text-sm font-semibold">{new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(deal.value)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{deal.contact ? [deal.contact.name, deal.contact.lastName].filter(Boolean).join(" ") : "Sin contacto"} · prioridad {deal.priority}</p></div></div><select value={deal.stageId} onChange={(event) => void move(deal, event.target.value)} className="mt-3 h-9 w-full rounded-md border bg-background px-2 text-xs" aria-label={`Mover ${deal.title}`}>{pipeline.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></article>)}</div></section>)}</div>}
        </div>
    </ResourcePage>;
}
