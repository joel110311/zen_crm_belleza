"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, CreditCard, Scissors, Store, UserRound, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HUMAN_ESCALATION_TRIGGERS, PAYMENT_METHODS, type BusinessPolicies, type HumanEscalationTrigger, type PaymentMethod } from "@/lib/ai/business-policies";
import { cn } from "@/lib/utils";

const STEPS = [
    { title: "Identidad", icon: UserRound },
    { title: "Negocio", icon: Store },
    { title: "Agenda", icon: CalendarClock },
    { title: "Servicios", icon: Scissors },
    { title: "Políticas", icon: CreditCard },
    { title: "Ayuda humana", icon: UserRoundCheck },
] as const;

const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", mercado_pago: "Mercado Pago" };
const TRIGGER_LABELS: Record<HumanEscalationTrigger, string> = {
    explicit_request: "La persona pide hablar con alguien",
    custom_quote: "Solicita el precio exacto de un diseño o trabajo personalizado",
    complaint: "Presenta una queja o solicita devolución",
    adverse_reaction: "Reporta alergia, irritación, embarazo o reacción",
    payment_issue: "Tiene un problema de pago",
    missing_critical_information: "Falta información fiable para decidir",
};

type ConfiguratorProps = {
    value: BusinessPolicies;
    onChange: (value: BusinessPolicies) => void;
    agentName?: string;
    onAgentNameChange?: (value: string) => void;
    escalationPhone?: string;
    onEscalationPhoneChange?: (value: string) => void;
    canManageAi?: boolean;
};

export function BusinessPolicyConfigurator({ value, onChange, agentName, onAgentNameChange, escalationPhone, onEscalationPhoneChange, canManageAi = false }: ConfiguratorProps) {
    const [step, setStep] = useState(0);
    const [closedDate, setClosedDate] = useState("");
    const hasLegacyNotes = Object.values(value.legacyNotes).some(Boolean);
    const update = (next: Partial<BusinessPolicies>) => onChange({ ...value, ...next });
    const toggleMethod = (method: PaymentMethod) => update({ deposits: { ...value.deposits, methods: value.deposits.methods.includes(method) ? value.deposits.methods.filter((entry) => entry !== method) : [...value.deposits.methods, method] } });
    const toggleTrigger = (trigger: HumanEscalationTrigger) => update({ humanEscalation: { triggers: value.humanEscalation.triggers.includes(trigger) ? value.humanEscalation.triggers.filter((entry) => entry !== trigger) : [...value.humanEscalation.triggers, trigger] } });
    const addClosedDate = () => {
        if (!closedDate || value.scheduling.closedDates.includes(closedDate)) return;
        update({ scheduling: { ...value.scheduling, closedDates: [...value.scheduling.closedDates, closedDate].sort() } });
        setClosedDate("");
    };

    return <div className="mt-5 rounded-2xl border bg-background p-4 sm:p-6">
        <div><h3 className="text-lg font-semibold">Configura tu asistente</h3></div>
        {hasLegacyNotes ? <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"><p>Hay textos de la configuración anterior. Completa la guía y descártalos para evitar contradicciones.</p><Button type="button" variant="outline" size="sm" onClick={() => update({ legacyNotes: { cancellationAndRescheduling: "", depositsAndPayments: "", preparationInstructions: "", customQuotes: "", humanEscalation: "" } })}>Descartar textos anteriores</Button></div> : null}
        <div className="mt-5 grid grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-6">{STEPS.map((item, index) => { const Icon = item.icon; return <button key={item.title} type="button" onClick={() => setStep(index)} className={cn("relative flex min-w-0 items-center justify-center gap-2 px-2 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground", step === index && "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary")}><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.title}</span></button>; })}</div>
        <div className="min-h-[390px] border-b px-1 py-6 sm:px-2">
            <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Paso {step + 1} de {STEPS.length}</p><h4 className="mt-1 text-lg font-semibold">{STEPS[step].title}</h4></div>
            {step === 0 ? <IdentityStep value={value} update={update} agentName={agentName} onAgentNameChange={onAgentNameChange} canManageAi={canManageAi} /> : null}
            {step === 1 ? <BusinessStep value={value} update={update} toggleMethod={toggleMethod} /> : null}
            {step === 2 ? <SchedulingStep value={value} update={update} closedDate={closedDate} setClosedDate={setClosedDate} addClosedDate={addClosedDate} /> : null}
            {step === 3 ? <ServicesStep /> : null}
            {step === 4 ? <PoliciesStep value={value} update={update} /> : null}
            {step === 5 ? <EscalationStep value={value} toggleTrigger={toggleTrigger} escalationPhone={escalationPhone} onEscalationPhoneChange={onEscalationPhoneChange} canManageAi={canManageAi} /> : null}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button><Button type="button" disabled={step === STEPS.length - 1} onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>Siguiente<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
    </div>;
}

function IdentityStep({ value, update, agentName, onAgentNameChange, canManageAi }: StepProps & { agentName?: string; onAgentNameChange?: (value: string) => void; canManageAi: boolean }) {
    return <div className="grid gap-5 sm:grid-cols-2">{canManageAi && onAgentNameChange ? <div><Label>Nombre del asistente</Label><Input className="mt-2 placeholder:text-muted-foreground/35" maxLength={80} value={agentName || ""} onChange={(event) => onAgentNameChange(event.target.value)} placeholder="Asistente Glow Up" /></div> : null}<Choice label="Tipo de negocio" value={value.identity.businessType} onChange={(businessType) => update({ identity: { ...value.identity, businessType: businessType as BusinessPolicies["identity"]["businessType"] } })} options={[["integrated_beauty", "Belleza integral"], ["hair_salon", "Peluquería / salón de cabello"], ["barbershop", "Barbería"], ["nails", "Salón de uñas"], ["lashes_brows", "Pestañas y cejas"], ["spa_aesthetics", "Spa / centro de estética"]]} /><div><Label>Responsable principal (opcional)</Label><Input className="mt-2 placeholder:text-muted-foreground/35" maxLength={80} value={value.identity.ownerName} onChange={(event) => update({ identity: { ...value.identity, ownerName: event.target.value } })} placeholder="Joss" /></div><Choice label="Tono de atención" value={value.identity.tone} onChange={(tone) => update({ identity: { ...value.identity, tone: tone as BusinessPolicies["identity"]["tone"] } })} options={[["warm", "Cálido y profesional"], ["elegant", "Elegante y sereno"], ["direct", "Directo y rápido"]]} /><Choice label="Uso de emojis" value={value.identity.emojiLevel} onChange={(emojiLevel) => update({ identity: { ...value.identity, emojiLevel: emojiLevel as BusinessPolicies["identity"]["emojiLevel"] } })} options={[["none", "Ninguno"], ["low", "Ocasional"], ["moderate", "Moderado"]]} /></div>;
}

function BusinessStep({ value, update, toggleMethod }: StepProps & { toggleMethod: (method: PaymentMethod) => void }) {
    return <div className="space-y-6"><div><Label>Enlace público de Google Maps (opcional)</Label><Input className="mt-2 placeholder:text-muted-foreground/35" type="url" maxLength={500} value={value.publicInfo.mapsUrl} onChange={(event) => update({ publicInfo: { mapsUrl: event.target.value } })} placeholder="https://maps.app.goo.gl/..." /></div><CheckGrid title="Métodos de pago aceptados" items={PAYMENT_METHODS.map((method) => ({ id: method, label: PAYMENT_LABELS[method], checked: value.deposits.methods.includes(method), onToggle: () => toggleMethod(method) }))} /></div>;
}

function SchedulingStep({ value, update, closedDate, setClosedDate, addClosedDate }: StepProps & { closedDate: string; setClosedDate: (value: string) => void; addClosedDate: () => void }) {
    return <div className="space-y-6"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><Choice label="Anticipación mínima" value={String(value.scheduling.minimumLeadHours)} onChange={(minimumLeadHours) => update({ scheduling: { ...value.scheduling, minimumLeadHours: Number(minimumLeadHours) } })} options={[["0", "Sin mínimo"], ["1", "1 hora"], ["2", "2 horas"], ["4", "4 horas"], ["12", "12 horas"], ["24", "24 horas"]]} /><Choice label="Reservar con hasta" value={String(value.scheduling.maximumAdvanceDays)} onChange={(maximumAdvanceDays) => update({ scheduling: { ...value.scheduling, maximumAdvanceDays: Number(maximumAdvanceDays) } })} options={[["30", "30 días"], ["60", "60 días"], ["90", "90 días"], ["180", "6 meses"], ["365", "1 año"]]} /><Choice label="Tiempo entre citas" value={String(value.scheduling.bufferMinutes)} onChange={(bufferMinutes) => update({ scheduling: { ...value.scheduling, bufferMinutes: Number(bufferMinutes) } })} options={[["0", "Sin espacio adicional"], ["5", "5 minutos"], ["10", "10 minutos"], ["15", "15 minutos"], ["30", "30 minutos"]]} /></div><div className="grid gap-3 sm:grid-cols-2"><ToggleRow title="Permitir citas el mismo día" description="Respeta la anticipación configurada." checked={value.scheduling.allowSameDay} onCheckedChange={(allowSameDay) => update({ scheduling: { ...value.scheduling, allowSameDay } })} /><ToggleRow title="Preguntar mañana o tarde" description="Cuando aún no indicaron una hora." checked={value.scheduling.askTimePreference} onCheckedChange={(askTimePreference) => update({ scheduling: { ...value.scheduling, askTimePreference } })} /></div><div><Label>Días inhábiles adicionales</Label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Input type="date" value={closedDate} onChange={(event) => setClosedDate(event.target.value)} /><Button type="button" variant="outline" onClick={addClosedDate}>Agregar día</Button></div>{value.scheduling.closedDates.length ? <div className="mt-3 flex flex-wrap gap-2">{value.scheduling.closedDates.map((date) => <button key={date} type="button" className="rounded-full border bg-background px-3 py-1.5 text-xs hover:border-destructive hover:text-destructive" onClick={() => update({ scheduling: { ...value.scheduling, closedDates: value.scheduling.closedDates.filter((item) => item !== date) } })}>{date} ×</button>)}</div> : null}</div></div>;
}

function ServicesStep() {
    return <div className="space-y-6"><p className="max-w-3xl text-sm leading-6 text-muted-foreground">La información de cada servicio se administra directamente en el catálogo.</p><div className="grid gap-3 sm:grid-cols-3"><Feature title="Preguntas previas" text="Diseño, retiro, alergias, estilo o estado del cabello." /><Feature title="Preparación" text="Sin esmalte, cabello limpio, sin maquillaje u otra indicación." /><Feature title="Cuidados posteriores" text="Recomendaciones específicas del servicio." /></div><Button asChild><Link href="/dashboard/services">Configurar servicios <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>;
}

function PoliciesStep({ value, update }: StepProps) {
    return <div className="space-y-5"><ToggleRow title="Gestionar cancelaciones y cambios por chat" description="Sólo se confirma cuando el CRM guardó la operación." checked={value.cancellation.manageByChat} onCheckedChange={(manageByChat) => update({ cancellation: { ...value.cancellation, manageByChat } })} />{value.cancellation.manageByChat ? <div className="grid gap-4 sm:grid-cols-2"><Choice label="Anticipación mínima para cancelar" value={String(value.cancellation.minimumNoticeHours)} onChange={(minimumNoticeHours) => update({ cancellation: { ...value.cancellation, minimumNoticeHours: Number(minimumNoticeHours) } })} options={[["0", "Sin mínimo"], ["2", "2 horas"], ["6", "6 horas"], ["12", "12 horas"], ["24", "24 horas"], ["48", "48 horas"]]} /><Choice label="Tolerancia de retraso" value={value.cancellation.lateArrivalToleranceMinutes === null ? "unset" : String(value.cancellation.lateArrivalToleranceMinutes)} onChange={(minutes) => update({ cancellation: { ...value.cancellation, lateArrivalToleranceMinutes: minutes === "unset" ? null : Number(minutes) } })} options={[["unset", "No definida"], ["0", "Sin tolerancia"], ["5", "5 minutos"], ["10", "10 minutos"], ["15", "15 minutos"], ["20", "20 minutos"]]} /><div className="sm:col-span-2"><Choice label="Si avisa fuera del plazo" value={value.cancellation.lateChangeConsequence} onChange={(lateChangeConsequence) => update({ cancellation: { ...value.cancellation, lateChangeConsequence: lateChangeConsequence as BusinessPolicies["cancellation"]["lateChangeConsequence"] } })} options={[["none", "Sin penalización"], ["may_charge", "Puede aplicarse cargo; revisar"], ["deposit_lost", "Pierde el anticipo"], ["human_review", "El equipo decide"]]} /></div></div> : null}<Choice label="Acompañantes" value={value.companions.policy} onChange={(policy) => update({ companions: { policy: policy as BusinessPolicies["companions"]["policy"] } })} options={[["not_defined", "Sin política definida"], ["allowed", "Sí se permiten"], ["one_only", "Máximo un acompañante"], ["not_allowed", "No se permiten acompañantes ni niños"]]} /><ToggleRow title="Solicitar anticipo para reservar" description={value.deposits.required ? "Configura monto y aplicación." : "El asistente no pedirá pagos previos."} checked={value.deposits.required} onCheckedChange={(required) => update({ deposits: { ...value.deposits, required } })} />{value.deposits.required ? <div className="grid gap-4 sm:grid-cols-2"><Choice label="Aplicar a" value={value.deposits.appliesTo} onChange={(appliesTo) => update({ deposits: { ...value.deposits, appliesTo: appliesTo as BusinessPolicies["deposits"]["appliesTo"] } })} options={[["all", "Todas las reservas"], ["above_amount", "Servicios desde cierto precio"], ["new_clients", "Sólo clientes nuevos"]]} />{value.deposits.appliesTo === "above_amount" ? <NumberField label="Precio mínimo" value={value.deposits.thresholdAmount} onChange={(thresholdAmount) => update({ deposits: { ...value.deposits, thresholdAmount } })} /> : <div />}<Choice label="Tipo" value={value.deposits.valueType} onChange={(valueType) => update({ deposits: { ...value.deposits, valueType: valueType as "fixed" | "percentage" } })} options={[["fixed", "Monto fijo"], ["percentage", "Porcentaje"]]} /><NumberField label={value.deposits.valueType === "percentage" ? "Porcentaje" : "Monto"} value={value.deposits.value} onChange={(depositValue) => update({ deposits: { ...value.deposits, value: depositValue } })} /></div> : null}<Choice label="Trabajos personalizados" value={value.customWork.mode} onChange={(mode) => update({ customWork: { ...value.customWork, mode: mode as BusinessPolicies["customWork"]["mode"] } })} options={[["photo_quote", "Enviar foto y el equipo cotiza"], ["in_person_assessment", "Valoración presencial"], ["fixed_catalog", "Precio fijo en catálogo"], ["not_offered", "No se ofrecen"]]} />{value.customWork.mode === "photo_quote" ? <div><Label>Quién confirma el precio</Label><Input className="mt-2 placeholder:text-muted-foreground/35" maxLength={80} value={value.customWork.reviewerName} onChange={(event) => update({ customWork: { ...value.customWork, reviewerName: event.target.value } })} placeholder="Joss o el equipo" /></div> : null}</div>;
}

function EscalationStep({ value, toggleTrigger, escalationPhone, onEscalationPhoneChange, canManageAi }: { value: BusinessPolicies; toggleTrigger: (trigger: HumanEscalationTrigger) => void; escalationPhone?: string; onEscalationPhoneChange?: (value: string) => void; canManageAi: boolean }) {
    return <div className="space-y-6">{canManageAi && onEscalationPhoneChange ? <div><Label>WhatsApp interno para recibir alertas</Label><Input className="mt-2 placeholder:text-muted-foreground/35" inputMode="tel" maxLength={24} value={escalationPhone || ""} onChange={(event) => onEscalationPhoneChange(event.target.value)} placeholder="+52 477 123 4567" /></div> : null}<CheckGrid title="Pedir ayuda humana cuando" items={HUMAN_ESCALATION_TRIGGERS.map((trigger) => ({ id: trigger, label: TRIGGER_LABELS[trigger], checked: value.humanEscalation.triggers.includes(trigger), onToggle: () => toggleTrigger(trigger) }))} /></div>;
}

type StepProps = { value: BusinessPolicies; update: (next: Partial<BusinessPolicies>) => void };
function ToggleRow({ title, description, checked, onCheckedChange }: { title: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) { return <div className="flex items-start justify-between gap-4 rounded-xl border bg-background p-4"><div><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>; }
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <div><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent></Select></div>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <div><Label>{label}</Label><Input className="mt-2" type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value || 0))} /></div>; }
function CheckGrid({ title, items }: { title: string; items: Array<{ id: string; label: string; checked: boolean; onToggle: () => void }> }) { return <div><Label>{title}</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3 text-sm"><Checkbox checked={item.checked} onCheckedChange={item.onToggle} className="mt-0.5" /><span>{item.label}</span></label>)}</div></div>; }
function Feature({ title, text }: { title: string; text: string }) { return <div className="rounded-xl border bg-background p-4"><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>; }
