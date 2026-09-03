"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ClipboardPlus, Loader2, Plus, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Feedback, Field, ResourcePage } from "@/components/tenant/resource-ui";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";

type Patient = {
    id: string; patientNumber: string; firstName: string; lastName: string; phone: string | null; email: string | null;
    dob: string | null; allergies: string | null; notes: string | null; lastVisitAt: string | null;
    _count: { consultations: number; appointments: number };
};
type PatientPage = { items: Patient[]; page: number; pageSize: number; total: number };
type PatientDetail = Patient & { pathologicalHistory: string | null; currentMedications: string | null; consultations: unknown[]; appointments: unknown[]; budgets: unknown[]; clinicalAnalyses: unknown[] };

export function PatientsWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const api = tenantApiBase(tenantSlug);
    const [result, setResult] = useState<PatientPage>({ items: [], page: 1, pageSize: 25, total: 0 });
    const [selected, setSelected] = useState<PatientDetail | null>(null);
    const [query, setQuery] = useState(""); const [activeQuery, setActiveQuery] = useState("");
    const [showForm, setShowForm] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);

    const load = useCallback(async () => {
        try { const suffix = activeQuery ? `?q=${encodeURIComponent(activeQuery)}` : ""; setResult(await tenantApi<PatientPage>(`${api}/patients${suffix}`)); setError(null); }
        catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los pacientes."); }
        finally { setLoading(false); }
    }, [activeQuery, api]);
    useEffect(() => { void load(); }, [load]);

    async function openPatient(id: string) {
        try { setSelected(await tenantApi<PatientDetail>(`${api}/patients/${id}`)); }
        catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo abrir el expediente."); }
    }

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
        setSaving(true); setError(null); setSuccess(null);
        try {
            await tenantApi(`${api}/patients`, { method: "POST", body: JSON.stringify({ firstName: form.get("firstName"), lastName: form.get("lastName"), phone: form.get("phone"), email: form.get("email"), dob: form.get("dob"), allergies: form.get("allergies"), notes: form.get("notes") }) });
            formElement.reset(); setShowForm(false); setSuccess("Paciente creado y vinculado a contactos."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo crear el paciente."); }
        finally { setSaving(false); }
    }

    async function saveHistory(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selected) return;
        const form = new FormData(event.currentTarget);
        setSaving(true); setError(null); setSuccess(null);
        try {
            const updated = await tenantApi<PatientDetail>(`${api}/patients/${selected.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    allergies: form.get("allergies"),
                    currentMedications: form.get("currentMedications"),
                    pathologicalHistory: form.get("pathologicalHistory"),
                    notes: form.get("notes"),
                }),
            });
            setSelected(updated); setSuccess("Antecedentes actualizados."); await load();
        } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar el expediente."); }
        finally { setSaving(false); }
    }

    return <ResourcePage title="Pacientes" description="Expedientes clínicos separados por negocio, con historial de citas y consultas." action={<Button onClick={() => setShowForm((value) => !value)}><Plus className="mr-2 size-4" />Nuevo paciente</Button>}>
        <div className="space-y-5"><Feedback error={error} success={success} />
            <form onSubmit={(event) => { event.preventDefault(); setLoading(true); setActiveQuery(query.trim()); }} className="flex max-w-xl gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente o número de expediente" /><Button type="submit" variant="outline"><Search className="size-4" /><span className="sr-only">Buscar</span></Button></form>
            {showForm ? <form onSubmit={create} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3"><Field label="Nombre"><Input required name="firstName" maxLength={160} /></Field><Field label="Apellidos"><Input name="lastName" maxLength={160} /></Field><Field label="Teléfono"><Input required name="phone" maxLength={40} /></Field><Field label="Correo"><Input name="email" type="email" maxLength={160} /></Field><Field label="Fecha de nacimiento"><Input name="dob" type="date" /></Field><Field label="Alergias"><Input name="allergies" maxLength={5000} /></Field><Field label="Notas" className="sm:col-span-2"><Input name="notes" maxLength={10000} /></Field><div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div></form> : null}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                {loading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : result.items.length === 0 ? <EmptyState>Agrega el primer paciente para iniciar su expediente.</EmptyState> : <div className="overflow-hidden rounded-2xl border bg-card"><div className="border-b px-5 py-3 text-xs text-muted-foreground">{result.total} paciente(s)</div><ul className="divide-y">{result.items.map((patient) => <li key={patient.id}><button type="button" onClick={() => void openPatient(patient.id)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50"><div className="flex min-w-0 gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Stethoscope className="size-4" /></span><div className="min-w-0"><p className="truncate font-medium">{patient.firstName} {patient.lastName}</p><p className="text-sm text-muted-foreground">{patient.patientNumber} · {patient.phone || "Sin teléfono"}</p></div></div><div className="shrink-0 text-right text-xs text-muted-foreground"><p>{patient._count.appointments} citas</p><p>{patient._count.consultations} consultas</p></div></button></li>)}</ul></div>}
                <aside className="rounded-2xl border bg-card p-5">{selected ? <div><div className="flex items-center gap-3"><ClipboardPlus className="size-5 text-primary" /><div><h2 className="font-semibold">{selected.firstName} {selected.lastName}</h2><p className="text-xs text-muted-foreground">{selected.patientNumber}</p></div></div><p className="mt-4 text-sm text-muted-foreground">{selected.phone || "—"}{selected.email ? ` · ${selected.email}` : ""}</p><p className="mt-2 text-xs text-muted-foreground">{selected.consultations.length} consultas · {selected.appointments.length} citas · {selected.budgets.length} presupuestos</p><form key={selected.id} onSubmit={saveHistory} className="mt-5 space-y-4"><Field label="Alergias"><textarea name="allergies" defaultValue={selected.allergies || ""} maxLength={5000} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field><Field label="Medicamentos actuales"><textarea name="currentMedications" defaultValue={selected.currentMedications || ""} maxLength={5000} rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field><Field label="Antecedentes patológicos"><textarea name="pathologicalHistory" defaultValue={selected.pathologicalHistory || ""} maxLength={10000} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field><Field label="Notas"><textarea name="notes" defaultValue={selected.notes || ""} maxLength={10000} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></Field><Button type="submit" className="w-full" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Guardar antecedentes</Button></form></div> : <p className="py-8 text-center text-sm text-muted-foreground">Selecciona un paciente para revisar su expediente.</p>}</aside>
            </div>
        </div>
    </ResourcePage>;
}
