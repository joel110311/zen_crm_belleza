"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";
import { useTenantRole } from "@/components/tenant/tenant-shell";

type Appointment = {
    id: string; title: string; startTime: string; endTime: string; status: string; confirmationStatus: string;
    notes: string | null; isOverbook: boolean;
    contact: { id: string; name: string | null; lastName: string | null } | null;
    specialist: { id: string; name: string; displayName: string | null; color: string | null } | null;
    service: { id: string; name: string; price: number; currency: string } | null;
};
type CalendarSnapshot = {
    appointments: Appointment[];
    availabilityBlocks: Array<{ id: string; title: string; startTime: string; endTime: string }>;
    options: {
        contacts: Array<{ id: string; name: string | null; lastName: string | null; phone: string }>;
        specialists: Array<{ id: string; name: string; displayName: string | null; color: string | null }>;
        services: Array<{ id: string; name: string; durationMinutes: number; specialists: Array<{ specialistId: string }> }>;
    };
    businessHours: { timeZone: string; start: string; end: string };
};

function localInputDefault(offsetHours: number) {
    const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return shifted.toISOString().slice(0, 16);
}

export function CalendarWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const role = useTenantRole();
    const canOverbook = role === "OWNER" || role === "ADMIN";
    const api = tenantApiBase(tenantSlug);
    const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null);
    const [showForm, setShowForm] = useState(false); const [showBlockForm, setShowBlockForm] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);
    const [selectedService, setSelectedService] = useState("");

    const load = useCallback(async () => {
        try { setSnapshot(await tenantApi<CalendarSnapshot>(`${api}/calendar`)); setError(null); }
        catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la agenda."); }
        finally { setLoading(false); }
    }, [api]);
    useEffect(() => { void load(); }, [load]);

    const availableSpecialists = useMemo(() => {
        if (!snapshot) return [];
        const service = snapshot.options.services.find((item) => item.id === selectedService);
        if (!service?.specialists.length) return snapshot.options.specialists;
        const ids = new Set(service.specialists.map((item) => item.specialistId));
        return snapshot.options.specialists.filter((item) => ids.has(item.id));
    }, [selectedService, snapshot]);

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/calendar`, { method: "POST", body: JSON.stringify({
                contactId: form.get("contactId"), specialistId: form.get("specialistId"), serviceId: form.get("serviceId"),
                startTime: new Date(String(form.get("startTime"))).toISOString(), notes: form.get("notes"),
                isFirstVisit: form.get("isFirstVisit") === "on", isOverbook: form.get("isOverbook") === "on",
            }) });
            formElement.reset(); setSelectedService(""); setShowForm(false); setSuccess("Cita creada."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear la cita."); }
        finally { setSaving(false); }
    }

    async function updateStatus(appointment: Appointment, status: "completed" | "cancelled") {
        if (status === "cancelled" && !window.confirm(`¿Cancelar “${appointment.title}”?`)) return;
        setError(null);
        try {
            if (status === "cancelled") await tenantApi(`${api}/calendar/${appointment.id}`, { method: "DELETE" });
            else await tenantApi(`${api}/calendar/${appointment.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
            setSuccess(status === "cancelled" ? "Cita cancelada; el historial se conservó." : "Cita completada."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar la cita."); }
    }

    async function createBlock(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            const specialistId = String(form.get("specialistId") || "");
            await tenantApi(`${api}/specialists/${specialistId}/availability-blocks`, {
                method: "POST",
                body: JSON.stringify({
                    title: form.get("title"),
                    startTime: new Date(String(form.get("startTime"))).toISOString(),
                    endTime: new Date(String(form.get("endTime"))).toISOString(),
                    type: "block",
                }),
            });
            formElement.reset(); setShowBlockForm(false); setSuccess("Horario bloqueado."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo bloquear el horario."); }
        finally { setSaving(false); }
    }

    const formatter = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: snapshot?.businessHours.timeZone });
    const visible = snapshot?.appointments.filter((item) => item.status !== "cancelled") || [];

    return <ResourcePage title="Agenda" description={snapshot ? `Horario ${snapshot.businessHours.start}–${snapshot.businessHours.end} · ${snapshot.businessHours.timeZone}` : "Citas y disponibilidad por profesional."} action={<div className="flex gap-2"><Button variant="outline" onClick={() => setShowBlockForm((value) => !value)}>Bloquear horario</Button><Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nueva cita</Button></div>}>
        <div className="space-y-5"><Feedback error={error} success={success} />
            {showForm ? <form onSubmit={create} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3"><Field label="Cliente"><select required name="contactId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{snapshot?.options.contacts.map((item) => <option key={item.id} value={item.id}>{[item.name, item.lastName].filter(Boolean).join(" ") || item.phone} · {item.phone}</option>)}</select></Field><Field label="Servicio"><select required name="serviceId" value={selectedService} onChange={(event) => setSelectedService(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{snapshot?.options.services.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.durationMinutes} min</option>)}</select></Field><Field label="Profesional"><select required name="specialistId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{availableSpecialists.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name}</option>)}</select></Field><Field label="Inicio"><Input required name="startTime" type="datetime-local" defaultValue={localInputDefault(1)} /></Field><Field label="Notas"><Input name="notes" maxLength={3000} /></Field><div className="flex items-end gap-4 pb-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="isFirstVisit" />Primera visita</label>{canOverbook ? <label className="flex items-center gap-2"><input type="checkbox" name="isOverbook" />Sobrecita</label> : null}</div><div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar cita</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div></form> : null}
            {showBlockForm ? <form onSubmit={createBlock} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4"><Field label="Profesional"><select required name="specialistId" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona</option>{snapshot?.options.specialists.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name}</option>)}</select></Field><Field label="Motivo"><Input required name="title" maxLength={160} placeholder="Descanso, vacaciones…" /></Field><Field label="Inicio"><Input required name="startTime" type="datetime-local" defaultValue={localInputDefault(24)} /></Field><Field label="Fin"><Input required name="endTime" type="datetime-local" defaultValue={localInputDefault(25)} /></Field><div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar bloqueo</Button><Button type="button" variant="ghost" onClick={() => setShowBlockForm(false)}>Cancelar</Button></div></form> : null}
            {snapshot?.availabilityBlocks.length ? <section className="rounded-2xl border bg-card p-4"><h2 className="text-sm font-semibold">Disponibilidad bloqueada</h2><div className="mt-3 flex flex-wrap gap-2">{snapshot.availabilityBlocks.map((block) => <span key={block.id} className="rounded-full bg-muted px-3 py-1.5 text-xs">{block.title} · {formatter.format(new Date(block.startTime))}</span>)}</div></section> : null}
            {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : !snapshot || visible.length === 0 ? <EmptyState>No hay citas en el rango actual.</EmptyState> : <div className="overflow-hidden rounded-2xl border bg-card"><ul className="divide-y">{visible.map((appointment) => { const client = [appointment.contact?.name, appointment.contact?.lastName].filter(Boolean).join(" "); return <li key={appointment.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: appointment.specialist?.color || "#2563EB" }}><CalendarDays className="size-4" /></span><div><p className="font-medium">{appointment.title}</p><p className="text-sm text-muted-foreground">{formatter.format(new Date(appointment.startTime))} · {client || "Cliente"}</p><p className="mt-1 text-xs text-muted-foreground">{appointment.specialist?.displayName || appointment.specialist?.name || "Sin profesional"}{appointment.service ? ` · ${appointment.service.name}` : ""}{appointment.isOverbook ? " · Sobrecita" : ""}</p></div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void updateStatus(appointment, "completed")}><Check className="mr-1.5 size-4" />Completar</Button><Button size="icon" variant="ghost" onClick={() => void updateStatus(appointment, "cancelled")} aria-label="Cancelar cita"><X className="size-4" /></Button></div></li>; })}</ul></div>}
        </div>
    </ResourcePage>;
}
