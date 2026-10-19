"use client";
import { PortalSocialLinks } from "@/components/portal/portal-social-links";
import type { PortalSocialLink } from "@/lib/portal-social-links";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { PortalFrame } from "./portal-frame";
import styles from "./portal-workspace.module.css";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/components/ui/use-toast";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { bookPortalAppointment, getPortalAvailability } from "@/app/actions/portal";
import { getOperationTodayKey, timeToOperationInputValue } from "@/lib/operation-dates";

export type PortalBookingData = {
    enabled: boolean;
    slug: string;
    clinicName: string;
    subtitle: string;
    intro?: string;
    scheduleSummary?: string;
    primaryColor: string;
    socialLinks?: PortalSocialLink[];
    logoUrl: string | null;
    logoScale: number;
    address: string | null;
    remindersEnabled?: boolean;
    operationContext: { locale: string; timeZone: string; phoneDefaultCountry: string; callingCode: string };
    specialists: Array<{
        id: string;
        name: string;
        displayName: string | null;
        specialty: string | null;
        color: string | null;
        room: string | null;
        bio: string | null;
    }>;
    services: Array<{
        id: string;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        durationMinutes: number;
        imageUrl: string | null;
        showPrice: boolean;
        specialists: Array<{ specialistId: string }>;
    }>;
};

type Props = {
    data: PortalBookingData;
    mode?: "legacy" | "tenant";
};

function dateKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, Math.max(0, month - 1), day, 12, 0, 0);
}

function money(amount: number, currency: string, locale: string) {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(amount);
}

function publicApiError(payload: unknown, fallback: string) {
    const message = payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { message?: unknown } }).error?.message
        : null;
    return typeof message === "string" ? message : fallback;
}

export function PortalBooking({ data, mode = "legacy" }: Props) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const operationContext = data.operationContext;
    const [selectedServiceId, setSelectedServiceId] = useState(data.services[0]?.id || "none");
    const initialAssignedIds = data.services[0]?.specialists.map((entry) => entry.specialistId) || [];
    const initialSpecialist = initialAssignedIds.length > 0
        ? data.specialists.find((entry) => initialAssignedIds.includes(entry.id))
        : data.specialists[0];
    const [selectedSpecialistId, setSelectedSpecialistId] = useState(initialSpecialist?.id || "");
    const [date, setDate] = useState(() => getOperationTodayKey(operationContext.timeZone));
    const [slots, setSlots] = useState<string[]>([]);
    const [selectedSlot, setSelectedSlot] = useState("");
    const [slotHoldToken, setSlotHoldToken] = useState("");
    const [holdingSlot, setHoldingSlot] = useState("");
    const [isLoadingSlots, setIsLoadingSlots] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phone, setPhone] = useState("");
    const [reason, setReason] = useState(data.services[0]?.name || "Servicio de cuidado personal");
    const [sendReminders, setSendReminders] = useState(Boolean(data.remindersEnabled));
    const [step, setStep] = useState<"service" | "time" | "details">("service");
    const [availabilityError, setAvailabilityError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
    const holdBusy = useRef(false);
    const bookingKey = useRef("");
    const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
    const [confirmedClientName, setConfirmedClientName] = useState("");
    const remindersGloballyEnabled = Boolean(data.remindersEnabled);
    const tenantEndpoint = `/api/public/t/${encodeURIComponent(data.slug)}/v1`;

    const selectedService = useMemo(
        () => data.services.find((entry) => entry.id === selectedServiceId),
        [data.services, selectedServiceId],
    );
    const availableSpecialists = useMemo(() => {
        const ids = selectedService?.specialists.map((entry) => entry.specialistId) || [];
        return ids.length > 0 ? data.specialists.filter((entry) => ids.includes(entry.id)) : data.specialists;
    }, [data.specialists, selectedService]);
    const specialist = useMemo(
        () => availableSpecialists.find((entry) => entry.id === selectedSpecialistId) || availableSpecialists[0],
        [availableSpecialists, selectedSpecialistId],
    );
    const selectedDate = useMemo(() => dateFromKey(date), [date]);
    const groupedSlots = useMemo(() => {
        const morning: string[] = [];
        const afternoon: string[] = [];

        slots.forEach((slot) => {
            const time = timeToOperationInputValue(slot, operationContext.timeZone);
            const hour = Number(time.split(":")[0]);
            (hour < 12 ? morning : afternoon).push(slot);
        });

        return [
            { key: "morning", label: "Mañana", slots: morning },
            { key: "afternoon", label: "Tarde", slots: afternoon },
        ].filter((group) => group.slots.length > 0);
    }, [operationContext.timeZone, slots]);

    useEffect(() => {
        setSendReminders(remindersGloballyEnabled);
    }, [remindersGloballyEnabled]);

    useEffect(() => {
        if (!data.enabled || !selectedSpecialistId || !date) return;
        let active = true;
        const load = async () => {
            setIsLoadingSlots(true);
            setAvailabilityError(null);
            setSlots([]);
            setSelectedSlot("");
            setSlotHoldToken("");
            setStep(current => current === "details" ? "time" : current);
            try {
                if (mode === "tenant") {
                    const query = new URLSearchParams({ serviceId: selectedServiceId, specialistId: selectedSpecialistId, date });
                    const response = await fetch(`${tenantEndpoint}/availability?${query}`, { cache: "no-store" });
                    const payload = await response.json().catch(() => null) as { data?: { slots?: string[] }; error?: { message?: string } } | null;
                    if (!response.ok) throw new Error(publicApiError(payload, "No fue posible consultar los horarios."));
                    if (active) setSlots(payload?.data?.slots || []);
                } else {
                    const result = await getPortalAvailability(data.slug, selectedSpecialistId, date, selectedServiceId);
                    if (!result.success) throw new Error(result.error);
                    if (active) setSlots(result.slots);
                }
            } catch (cause) {
                if (active) setAvailabilityError(cause instanceof Error ? cause.message : "No fue posible consultar los horarios. Inténtalo de nuevo.");
            } finally {
                if (active) setIsLoadingSlots(false);
            }
        };
        void load();
        return () => { active = false; };
    }, [data.enabled, data.slug, date, mode, selectedServiceId, selectedSpecialistId, tenantEndpoint, availabilityAttempt]);

    const selectService = (serviceId: string) => {
        if (isPending || holdingSlot) return;
        setFormError(null);
        setSelectedServiceId(serviceId);
        const service = data.services.find((entry) => entry.id === serviceId);
        if (!service) return;
        setReason(service.name);
        const assignedIds = service.specialists.map((entry) => entry.specialistId);
        if (assignedIds.length > 0 && !assignedIds.includes(selectedSpecialistId)) {
            setSelectedSpecialistId(data.specialists.find((entry) => assignedIds.includes(entry.id))?.id || "");
        }
    };

    const selectSlot = async (slot: string) => {
        if (holdBusy.current || isPending || isLoadingSlots) return;
        setFormError(null);
        if (mode === "legacy") {
            setSelectedSlot(slot);
            return;
        }
        if (!selectedService || !specialist) return;

        holdBusy.current = true;
        setHoldingSlot(slot);
        setSelectedSlot("");
        setSlotHoldToken("");
        try {
            const response = await fetch(`${tenantEndpoint}/slot-holds`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({
                    serviceId: selectedService.id,
                    specialistId: specialist.id,
                    date,
                    time: timeToOperationInputValue(slot, operationContext.timeZone),
                }),
            });
            const payload = await response.json().catch(() => null) as { data?: { holdToken?: string }; error?: { message?: string } } | null;
            if (!response.ok || !payload?.data?.holdToken) {
                throw new Error(publicApiError(payload, "Ese horario ya no está disponible."));
            }
            setSelectedSlot(slot);
            setSlotHoldToken(payload.data.holdToken);
            bookingKey.current = crypto.randomUUID();
        } catch (cause) {
            setSlots((current) => current.filter((entry) => entry !== slot));
            setFormError(cause instanceof Error ? cause.message : "Selecciona otro horario.");
            toast({
                title: "Horario no disponible",
                description: cause instanceof Error ? cause.message : "Selecciona otro horario.",
                variant: "destructive",
            });
        } finally {
            holdBusy.current = false;
            setHoldingSlot("");
        }
    };

    const handleSubmit = () => {
        if (isPending || holdingSlot || step !== "details") return;
        setFormError(null);
        if (!selectedSpecialistId || !date || !selectedSlot || !firstName.trim() || !phone) {
            setFormError("Completa servicio, profesional, horario, nombre y teléfono.");
            toast({
                title: "Faltan datos",
                description: "Completa servicio, profesional, horario, nombre y teléfono.",
                variant: "destructive",
            });
            return;
        }

        startTransition(async () => {
            try {
            if (mode === "tenant") {
                if (!slotHoldToken || !selectedService || !specialist) {
                    setFormError("Vuelve a elegir el horario: el apartado temporal ya no está disponible.");
                    toast({ title: "Vuelve a elegir el horario", description: "El apartado temporal ya no está disponible.", variant: "destructive" });
                    return;
                }
                bookingKey.current ||= crypto.randomUUID();
                const response = await fetch(`${tenantEndpoint}/bookings`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Idempotency-Key": bookingKey.current },
                    body: JSON.stringify({
                        holdToken: slotHoldToken,
                        serviceId: selectedService.id,
                        specialistId: specialist.id,
                        date,
                        time: timeToOperationInputValue(selectedSlot, operationContext.timeZone),
                        firstName: firstName.trim(),
                        lastName: lastName.trim(),
                        phone,
                    }),
                });
                const payload = await response.json().catch(() => null) as {
                    data?: { bookingToken?: string };
                    error?: { message?: string };
                } | null;
                if (!response.ok || !payload?.data?.bookingToken) {
                    setFormError(publicApiError(payload, "No fue posible confirmar la reservación. Inténtalo de nuevo."));
                    return;
                }
                setConfirmedClientName(firstName.trim());
                setConfirmationToken(payload.data.bookingToken);
                toast({ title: "Horario apartado", description: "El negocio recibió tu solicitud para confirmarla." });
                return;
            }

            const slotDate = new Date(selectedSlot);
            const result = await bookPortalAppointment({
                slug: data.slug,
                specialistId: selectedSpecialistId,
                serviceId: selectedServiceId !== "none" ? selectedServiceId : undefined,
                date,
                time: timeToOperationInputValue(slotDate, operationContext.timeZone),
                firstName: firstName.trim(),
                lastName: "",
                phone,
                reason,
                isFirstVisit: false,
                sendReminders,
            });

            if (!result.success) {
                setFormError(result.error || "No se pudo reservar.");
                return;
            }

            setConfirmedClientName(result.clientName || firstName.trim());
            setConfirmationToken(result.token || null);
            toast({ title: "Horario apartado", description: "El negocio recibió tu solicitud para confirmarla." });
            } catch {
                setFormError("No se pudo enviar la solicitud. Revisa tu conexión e inténtalo de nuevo.");
            }
        });
    };

    const busy = isPending || Boolean(holdingSlot);
    const serviceReady = mode === "tenant" ? Boolean(selectedService && specialist) : Boolean(reason.trim() && specialist);
    const timeReady = Boolean(selectedSlot && !isLoadingSlots && (mode !== "tenant" || slotHoldToken));
    const details = <dl className={styles.details}>
        <div><dt>Servicio</dt><dd>{selectedService?.name || reason}</dd></div>
        <div><dt>Profesional</dt><dd>{specialist?.displayName || specialist?.name || "Sin profesional disponible"}</dd></div>
        {selectedService && <div><dt>Duración{selectedService.showPrice ? " y precio" : ""}</dt><dd>{selectedService.durationMinutes} min{selectedService.showPrice ? ` · ${money(selectedService.price, selectedService.currency, operationContext.locale)}` : ""}</dd></div>}
        <div><dt>Fecha y hora · horario del negocio</dt><dd>{format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}{selectedSlot ? ` · ${timeToOperationInputValue(selectedSlot, operationContext.timeZone)}` : " · Elige una hora"}</dd></div>
    </dl>;
    const frameProps = { name: data.clinicName, subtitle: data.subtitle, logoUrl: data.logoUrl, logoScale: data.logoScale, primaryColor: data.primaryColor };
    if (!data.enabled) return <PortalFrame {...frameProps}><section className={styles.statusPanel}><h1>Reservas no disponibles</h1><p>Por el momento este negocio no recibe solicitudes desde el portal.</p>{data.address && <p>{data.address}</p>}<PortalSocialLinks links={data.socialLinks} /></section></PortalFrame>;
    if (confirmationToken) return <PortalFrame {...frameProps}><section className={styles.statusPanel}>
        <CheckCircle2 className="mb-4 size-8" aria-hidden="true" /><h1>Solicitud recibida</h1>
        <p>{confirmedClientName ? `${confirmedClientName}, ` : ""}el negocio recibió tu solicitud. La cita queda pendiente de su confirmación.</p>
        {details}<div className={styles.actions}><a className={styles.primary} href={mode === "tenant" ? `/portal/${data.slug}/turno/${confirmationToken}` : `/portal/turno/${confirmationToken}`}>Ver estado de mi cita</a></div>
    </section></PortalFrame>;

    return <PortalFrame {...frameProps}>
        <div className={styles.heading}><h1>Reserva tu cita</h1><p>{data.intro || "Elige un servicio y encuentra un horario para ti."}</p></div>
        <nav className={styles.progress} aria-label="Pasos de la reserva">
            {([{ id: "service", label: "Servicio" }, { id: "time", label: "Horario" }, { id: "details", label: "Tus datos" }] as const).map(item => <button type="button" key={item.id} aria-current={step === item.id ? "step" : undefined} disabled={busy || (item.id === "time" && !serviceReady) || (item.id === "details" && !timeReady)} onClick={() => { setStep(item.id); setFormError(null); }}>{item.label}</button>)}
        </nav>
        <div className={styles.layout}>
            <section className={styles.panel} aria-label={step === "service" ? "Selecciona un servicio" : step === "time" ? "Elige tu horario" : "Datos de contacto"}>
                {step === "service" && <>
                    <h2>¿Qué servicio buscas?</h2>
                    <div className={styles.catalog}>{data.services.map(service => <button type="button" className={styles.service} key={service.id} aria-pressed={selectedServiceId === service.id} onClick={() => selectService(service.id)} disabled={busy}>
                        {service.imageUrl && <Image src={service.imageUrl} alt="" width={56} height={56} unoptimized />}
                        <span><strong>{service.name}</strong>{service.description && <small>{service.description}</small>}<span className={styles.serviceMeta}><span>{service.durationMinutes} min</span>{service.showPrice && <span>{money(service.price, service.currency, operationContext.locale)}</span>}</span></span>
                        <span className={styles.selectionMark} aria-hidden="true">{selectedServiceId === service.id && <Check className="size-4" />}</span>
                    </button>)}</div>
                    {!data.services.length && (mode === "legacy" ? <div className={styles.field}><label htmlFor="portal-reason">Servicio o motivo</label><input id="portal-reason" value={reason} onChange={event => setReason(event.target.value)} /></div> : <p className={styles.notice}>El negocio aún no tiene servicios disponibles para reservar.</p>)}
                    {!specialist && <p className={styles.notice}>No hay profesionales disponibles para este servicio.</p>}
                    <div className={styles.actions}><button type="button" className={styles.primary} disabled={!serviceReady || busy} onClick={() => setStep("time")}>Elegir horario <ArrowRight className="size-4" aria-hidden="true" /></button></div>
                </>}
                {step === "time" && <>
                    <h2>Elige tu horario</h2>
                    <p className={styles.hint}>{selectedService?.name || reason} · {selectedService?.durationMinutes || ""} min</p>
                    <div className={styles.timeLayout}><div>
                    <div className={`${styles.field} mt-5`}><label htmlFor="portal-specialist">Profesional</label><select id="portal-specialist" value={selectedSpecialistId} onChange={event => setSelectedSpecialistId(event.target.value)} disabled={busy}>{availableSpecialists.map(person => <option value={person.id} key={person.id}>{person.displayName || person.name}</option>)}</select></div>
                    <div className={`${styles.field} ${styles.dateMobile}`}><label htmlFor="portal-date">Fecha</label><input id="portal-date" type="date" min={getOperationTodayKey(operationContext.timeZone)} value={date} onChange={event => event.target.value && setDate(event.target.value)} disabled={busy} /></div>
                    <div className={styles.calendar}><Calendar mode="single" selected={selectedDate} onSelect={value => value && setDate(dateKey(value))} disabled={busy ? true : { before: dateFromKey(getOperationTodayKey(operationContext.timeZone)) }} locale={es} /></div>
                    </div><section className={styles.times} aria-label="Horarios disponibles" aria-busy={isLoadingSlots}>
                        <div><h2>Horarios disponibles</h2><p className={styles.hint}>{format(selectedDate, "EEEE d 'de' MMMM", { locale: es })} · {operationContext.timeZone}</p></div>
                        {isLoadingSlots ? <p role="status" className={styles.notice}>Consultando horarios…</p> : availabilityError ? <div role="alert" className={styles.error}><p>{availabilityError}</p><button className={`${styles.secondary} mt-3`} onClick={() => setAvailabilityAttempt(value => value + 1)}>Reintentar consulta</button></div> : groupedSlots.length ? groupedSlots.map(group => <div key={group.key}><h3>{group.label}</h3><div className={styles.slotGrid}>{group.slots.map(slot => <button type="button" key={slot} aria-pressed={selectedSlot === slot} className={styles.slot} disabled={busy} onClick={() => void selectSlot(slot)}>{holdingSlot === slot ? <Loader2 className="mx-auto size-5 animate-spin" aria-label="Apartando horario" /> : timeToOperationInputValue(slot, operationContext.timeZone)}</button>)}</div></div>) : <p role="status" className={styles.notice}>No hay horarios para este día. Elige otra fecha o profesional.</p>}
                    </section></div>
                    {formError && <p role="alert" className={`${styles.error} mt-5`}>{formError}</p>}
                    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setStep("service")}><ArrowLeft className="size-4" aria-hidden="true" />Servicio</button><button type="button" className={styles.primary} disabled={!timeReady || busy} onClick={() => { setFormError(null); setStep("details"); }}>Continuar <ArrowRight className="size-4" aria-hidden="true" /></button></div>
                </>}
                {step === "details" && <>
                    <h2>Tus datos de contacto</h2>
                    <form onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
                        <fieldset className={styles.fields} disabled={busy}>
                            <div className={styles.twoFields}><div className={styles.field}><label htmlFor="portal-first-name">{mode === "tenant" ? "Nombre" : "Nombre completo"}</label><input id="portal-first-name" autoComplete={mode === "tenant" ? "given-name" : "name"} required value={firstName} onChange={event => setFirstName(event.target.value)} /></div>{mode === "tenant" && <div className={styles.field}><label htmlFor="portal-last-name">Apellidos (opcional)</label><input id="portal-last-name" autoComplete="family-name" value={lastName} onChange={event => setLastName(event.target.value)} /></div>}</div>
                            <div className={`${styles.field} ${styles.phone}`}><label htmlFor="portal-phone">Teléfono de WhatsApp</label><PhonePrefixInput inputId="portal-phone" required value={phone} onChange={setPhone} defaultCountry={operationContext.phoneDefaultCountry} disabled={busy} /><p className={styles.hint}>Selecciona el país y escribe tu número.</p></div>
                            {mode === "legacy" && remindersGloballyEnabled && <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={sendReminders} onChange={event => setSendReminders(event.target.checked)} className="mt-1 size-5 shrink-0" /><span>Recibir recordatorios por WhatsApp</span></label>}
                            {formError && <p role="alert" className={styles.error}>{formError}</p>}
                            <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setStep("time")} disabled={busy}><ArrowLeft className="size-4" aria-hidden="true" />Horario</button><button type="submit" className={styles.primary} disabled={busy}>{isPending ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Enviando…</> : "Solicitar cita"}</button></div>
                        </fieldset>
                    </form>
                    <p className={styles.hint}>Tu cita quedará pendiente de confirmación del negocio.</p>
                </>}
            </section>
            <aside className={styles.summary} data-step={step} aria-label="Resumen de tu cita"><div className={styles.desktopSummary}><h2>Tu cita</h2>{details}</div><details className={styles.mobileSummary}><summary><strong>Resumen de tu cita</strong><span>{selectedService?.name || reason}{selectedSlot ? ` · ${format(selectedDate, "d MMM", { locale: es })} · ${timeToOperationInputValue(selectedSlot, operationContext.timeZone)}` : ""}</span></summary>{details}</details></aside>
        </div>
        <section className={styles.businessInfo} aria-label="Información del negocio">{data.address && <p>{data.address}</p>}{data.scheduleSummary && <p>{data.scheduleSummary}</p>}<PortalSocialLinks links={data.socialLinks} /></section>
    </PortalFrame>;
}
