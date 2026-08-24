"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, CreditCard, Sparkles, UserRoundCheck, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    HUMAN_ESCALATION_TRIGGERS,
    PAYMENT_METHODS,
    type BusinessPolicies,
    type HumanEscalationTrigger,
    type PaymentMethod,
} from "@/lib/ai/business-policies";
import { cn } from "@/lib/utils";

const STEPS = [
    { title: "Cancelaciones", icon: CalendarClock },
    { title: "Anticipos", icon: CreditCard },
    { title: "Preparación", icon: WandSparkles },
    { title: "Cotizaciones", icon: Sparkles },
    { title: "Ayuda humana", icon: UserRoundCheck },
] as const;

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
    cash: "Efectivo",
    transfer: "Transferencia",
    card: "Tarjeta",
    mercado_pago: "Mercado Pago",
};

const TRIGGER_LABELS: Record<HumanEscalationTrigger, string> = {
    explicit_request: "La persona pide hablar con alguien",
    custom_quote: "Solicita una cotización personalizada",
    complaint: "Presenta una queja o solicita devolución",
    adverse_reaction: "Reporta alergia, irritación, embarazo o reacción",
    payment_issue: "Tiene un problema de pago",
    missing_critical_information: "Falta información fiable para decidir",
};

export function BusinessPolicyConfigurator({ value, onChange }: { value: BusinessPolicies; onChange: (value: BusinessPolicies) => void }) {
    const [step, setStep] = useState(0);
    const hasLegacyNotes = Object.values(value.legacyNotes).some(Boolean);

    const update = (next: Partial<BusinessPolicies>) => onChange({ ...value, ...next });
    const toggleMethod = (method: PaymentMethod) => update({
        deposits: {
            ...value.deposits,
            methods: value.deposits.methods.includes(method)
                ? value.deposits.methods.filter((entry) => entry !== method)
                : [...value.deposits.methods, method],
        },
    });
    const toggleTrigger = (trigger: HumanEscalationTrigger) => update({
        humanEscalation: {
            triggers: value.humanEscalation.triggers.includes(trigger)
                ? value.humanEscalation.triggers.filter((entry) => entry !== trigger)
                : [...value.humanEscalation.triggers, trigger],
        },
    });

    return (
        <div className="mt-5 rounded-2xl border bg-background p-4 sm:p-5">
            <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
                <div>
                    <h3 className="font-semibold">Asistente guiado de políticas</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Responde opciones concretas. El CRM genera internamente las reglas para la IA; no necesitas redactar prompts.</p>
                </div>
            </div>

            {hasLegacyNotes ? (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                    <p>Conservamos políticas escritas con la versión anterior. Configura estos pasos y después descártalas para evitar reglas duplicadas.</p>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => update({ legacyNotes: { cancellationAndRescheduling: "", depositsAndPayments: "", preparationInstructions: "", customQuotes: "", humanEscalation: "" } })}>Descartar notas anteriores</Button>
                </div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-muted/45 p-1 sm:grid-cols-5">
                {STEPS.map((item, index) => {
                    const Icon = item.icon;
                    return (
                        <button key={item.title} type="button" onClick={() => setStep(index)} className={cn("flex min-w-0 items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors sm:justify-center sm:px-1 sm:py-2", index === STEPS.length - 1 && "col-span-2 sm:col-span-1", step === index && "bg-background text-foreground shadow-sm")}>
                            <Icon className="h-4 w-4 shrink-0" /><span>{item.title}</span>
                        </button>
                    );
                })}
            </div>

            <div className="mt-5 min-h-[330px] rounded-2xl border bg-muted/10 p-4 sm:p-5">
                <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Paso {step + 1} de {STEPS.length}</p><h4 className="mt-1 text-lg font-semibold">{STEPS[step].title}</h4></div>

                {step === 0 ? (
                    <div className="space-y-5">
                        <ToggleRow title="Gestionar cancelaciones y cambios por chat" description="El CRM sólo confirmará la operación si el calendario la guardó." checked={value.cancellation.manageByChat} onCheckedChange={(manageByChat) => update({ cancellation: { ...value.cancellation, manageByChat } })} />
                        {value.cancellation.manageByChat ? <div className="grid gap-4 sm:grid-cols-2">
                            <Choice label="Anticipación mínima" value={String(value.cancellation.minimumNoticeHours)} onChange={(minimumNoticeHours) => update({ cancellation: { ...value.cancellation, minimumNoticeHours: Number(minimumNoticeHours) } })} options={[["0", "Sin mínimo"], ["2", "2 horas"], ["6", "6 horas"], ["12", "12 horas"], ["24", "24 horas"], ["48", "48 horas"]]} />
                            <Choice label="Tolerancia de retraso" value={value.cancellation.lateArrivalToleranceMinutes === null ? "unset" : String(value.cancellation.lateArrivalToleranceMinutes)} onChange={(lateArrivalToleranceMinutes) => update({ cancellation: { ...value.cancellation, lateArrivalToleranceMinutes: lateArrivalToleranceMinutes === "unset" ? null : Number(lateArrivalToleranceMinutes) } })} options={[["unset", "No definida"], ["0", "Sin tolerancia"], ["5", "5 minutos"], ["10", "10 minutos"], ["15", "15 minutos"], ["20", "20 minutos"]]} />
                            <div className="sm:col-span-2"><Choice label="Si avisa fuera del plazo" value={value.cancellation.lateChangeConsequence} onChange={(lateChangeConsequence) => update({ cancellation: { ...value.cancellation, lateChangeConsequence: lateChangeConsequence as BusinessPolicies["cancellation"]["lateChangeConsequence"] } })} options={[["none", "Sin penalización"], ["may_charge", "Puede aplicarse un cargo; confirmar con el equipo"], ["deposit_lost", "Pierde el anticipo"], ["human_review", "El equipo revisa cada caso"]]} /></div>
                        </div> : <InfoText>Cuando alguien solicite cancelar o cambiar, el bot lo canalizará con el equipo en lugar de decidir.</InfoText>}
                    </div>
                ) : null}

                {step === 1 ? (
                    <div className="space-y-5">
                        <ToggleRow title="Solicitar anticipo para reservar" description={value.deposits.required ? "Define a quién aplica y cuánto solicitar." : "El bot no pedirá pagos previos para confirmar una cita."} checked={value.deposits.required} onCheckedChange={(required) => update({ deposits: { ...value.deposits, required } })} />
                        {value.deposits.required ? <div className="grid gap-4 sm:grid-cols-2">
                            <Choice label="Aplicar a" value={value.deposits.appliesTo} onChange={(appliesTo) => update({ deposits: { ...value.deposits, appliesTo: appliesTo as BusinessPolicies["deposits"]["appliesTo"] } })} options={[["all", "Todas las reservas"], ["above_amount", "Servicios desde cierto precio"], ["new_clients", "Sólo clientes nuevos"]]} />
                            {value.deposits.appliesTo === "above_amount" ? <NumberField label="Precio mínimo del servicio" value={value.deposits.thresholdAmount} onChange={(thresholdAmount) => update({ deposits: { ...value.deposits, thresholdAmount } })} /> : <div />}
                            <Choice label="Tipo de anticipo" value={value.deposits.valueType} onChange={(valueType) => update({ deposits: { ...value.deposits, valueType: valueType as "fixed" | "percentage" } })} options={[["fixed", "Monto fijo"], ["percentage", "Porcentaje"]]} />
                            <NumberField label={value.deposits.valueType === "percentage" ? "Porcentaje" : "Monto"} value={value.deposits.value} onChange={(depositValue) => update({ deposits: { ...value.deposits, value: depositValue } })} />
                            <div className="sm:col-span-2"><Choice label="Reembolso" value={value.deposits.refundable} onChange={(refundable) => update({ deposits: { ...value.deposits, refundable: refundable as BusinessPolicies["deposits"]["refundable"] } })} options={[["yes", "Sí es reembolsable"], ["no", "No es reembolsable"], ["according_to_notice", "Depende del plazo de cancelación"]]} /></div>
                        </div> : null}
                        <CheckGrid title="Métodos aceptados" items={PAYMENT_METHODS.map((method) => ({ id: method, label: PAYMENT_LABELS[method], checked: value.deposits.methods.includes(method), onToggle: () => toggleMethod(method) }))} />
                    </div>
                ) : null}

                {step === 2 ? (
                    <div className="space-y-5">
                        <InfoText>Las indicaciones previas pertenecen a cada servicio, no a un prompt general. En Servicios → Editar encontrarás opciones como “sin esmalte”, “sin maquillaje”, “cabello limpio” y una instrucción breve adicional.</InfoText>
                        <Button asChild><Link href="/dashboard/services">Configurar requisitos por servicio <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                        <p className="text-xs leading-5 text-muted-foreground">Si un servicio no tiene requisitos seleccionados, el asistente confirma la cita sin inventar advertencias.</p>
                    </div>
                ) : null}

                {step === 3 ? (
                    <div className="space-y-5">
                        <Choice label="¿Cómo manejas trabajos personalizados?" value={value.customWork.mode} onChange={(mode) => update({ customWork: { ...value.customWork, mode: mode as BusinessPolicies["customWork"]["mode"] } })} options={[["photo_quote", "El cliente envía foto y el equipo cotiza"], ["in_person_assessment", "Requiere valoración presencial"], ["fixed_catalog", "Todos tienen precio fijo en el catálogo"], ["not_offered", "No se ofrecen trabajos personalizados"]]} />
                        {value.customWork.mode === "photo_quote" ? <div><Label>¿Quién confirma la cotización?</Label><Input className="mt-2" maxLength={80} value={value.customWork.reviewerName} onChange={(event) => update({ customWork: { ...value.customWork, reviewerName: event.target.value } })} placeholder="Ej. Joss o el equipo" /></div> : null}
                        {value.customWork.mode === "photo_quote" || value.customWork.mode === "in_person_assessment" ? <ToggleRow title="Permitir agendar el servicio base antes de cotizar" description="Útil cuando el cliente quiere reservar y no necesita conocer aún el total." checked={value.customWork.allowBookingBeforeQuote} onCheckedChange={(allowBookingBeforeQuote) => update({ customWork: { ...value.customWork, allowBookingBeforeQuote } })} /> : null}
                    </div>
                ) : null}

                {step === 4 ? (
                    <div className="space-y-5">
                        <CheckGrid title="Transferir a una persona cuando" items={HUMAN_ESCALATION_TRIGGERS.map((trigger) => ({ id: trigger, label: TRIGGER_LABELS[trigger], checked: value.humanEscalation.triggers.includes(trigger), onToggle: () => toggleTrigger(trigger) }))} />
                        <InfoText>El teléfono o canal que recibe la alerta se configura en Asistente IA → Escalación humana. El cliente nunca verá ese número interno.</InfoText>
                    </div>
                ) : null}
            </div>

            <div className="mt-4 grid grid-cols-2 items-center gap-3 sm:grid-cols-[auto_1fr_auto]">
                <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button>
                <span className="order-last col-span-2 text-center text-xs leading-5 text-muted-foreground sm:order-none sm:col-span-1">Los cambios se aplican al guardar Mi Negocio.</span>
                <Button type="button" disabled={step === STEPS.length - 1} className="justify-self-stretch sm:justify-self-auto" onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>Siguiente<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
        </div>
    );
}

function ToggleRow({ title, description, checked, onCheckedChange }: { title: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
    return <div className="flex items-start justify-between gap-4 rounded-xl border bg-background p-4"><div><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>;
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
    return <div><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent></Select></div>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return <div><Label>{label}</Label><Input className="mt-2" type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value || 0))} /></div>;
}

function CheckGrid({ title, items }: { title: string; items: Array<{ id: string; label: string; checked: boolean; onToggle: () => void }> }) {
    return <div><Label>{title}</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3 text-sm"><Checkbox checked={item.checked} onCheckedChange={item.onToggle} className="mt-0.5" /><span>{item.label}</span></label>)}</div></div>;
}

function InfoText({ children }: { children: ReactNode }) {
    return <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">{children}</div>;
}
