"use client";
/* eslint-disable @next/next/no-img-element -- tenant branding URLs are user-provided and cannot be allowlisted at build time. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PortalSocialLinks } from "@/components/portal/portal-social-links";
import type { PortalSocialLink } from "@/lib/portal-social-links";
import { CalendarDays, CheckCircle2, Clock3, Loader2, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOperationTodayKey, timeToOperationInputValue } from "@/lib/operation-dates";

export type TenantPortalData = {
    slug: string;
    clinicName: string;
    subtitle: string;
    intro: string;
    primaryColor: string;
    socialLinks?: PortalSocialLink[];
    paymentInstructions: string | null;
    logoUrl: string | null;
    logoScale: number;
    address: string | null;
    operationContext: { locale: string; timeZone: string; phoneDefaultCountry: string; callingCode: string };
    scheduleSummary: string;
    specialists: Array<{ id: string; name: string; displayName: string | null; specialty: string | null; color: string | null; room: string | null; bio: string | null }>;
    services: Array<{ id: string; name: string; description: string | null; price: number; currency: string; durationMinutes: number; imageUrl: string | null; showPrice: boolean; specialists: Array<{ specialistId: string }> }>;
};

type Props = { data: TenantPortalData };

function money(value: number, currency: string, locale: string) {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function errorMessage(payload: unknown, fallback: string) {
    const message = payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { message?: unknown } }).error?.message
        : null;
    return typeof message === "string" ? message : fallback;
}

export function TenantPortalBooking({ data }: Props) {
    const initialService = data.services[0] || null;
    const initialSpecialistId = initialService?.specialists[0]?.specialistId || data.specialists[0]?.id || "";
    const [serviceId, setServiceId] = useState(initialService?.id || "");
    const [specialistId, setSpecialistId] = useState(initialSpecialistId);
    const [date, setDate] = useState(() => getOperationTodayKey(data.operationContext.timeZone));
    const [slots, setSlots] = useState<string[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [holdingSlot, setHoldingSlot] = useState<string | null>(null);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [holdToken, setHoldToken] = useState<string | null>(null);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [booking, setBooking] = useState<{ token: string; startsAt: string; serviceName: string; specialistName: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const endpoint = `/api/public/t/${encodeURIComponent(data.slug)}/v1`;
    const selectedService = useMemo(() => data.services.find((service) => service.id === serviceId) || null, [data.services, serviceId]);
    const eligibleSpecialists = useMemo(() => {
        const assigned = selectedService?.specialists.map((item) => item.specialistId) || [];
        return assigned.length ? data.specialists.filter((specialist) => assigned.includes(specialist.id)) : data.specialists;
    }, [data.specialists, selectedService]);
    const selectedSpecialist = eligibleSpecialists.find((specialist) => specialist.id === specialistId) || eligibleSpecialists[0] || null;

    useEffect(() => {
        if (selectedSpecialist && selectedSpecialist.id !== specialistId) setSpecialistId(selectedSpecialist.id);
    }, [selectedSpecialist, specialistId]);

    useEffect(() => {
        setSelectedSlot(null);
        setHoldToken(null);
        setError(null);
        if (!serviceId || !specialistId || !date) {
            setSlots([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            setLoadingSlots(true);
            try {
                const query = new URLSearchParams({ serviceId, specialistId, date });
                const response = await fetch(`${endpoint}/availability?${query.toString()}`, { cache: "no-store" });
                const payload = await response.json().catch(() => null) as { data?: { slots?: string[] }; error?: { message?: string } } | null;
                if (!response.ok) throw new Error(errorMessage(payload, "No fue posible consultar los horarios."));
                if (!cancelled) setSlots(payload?.data?.slots || []);
            } catch (cause) {
                if (!cancelled) {
                    setSlots([]);
                    setError(cause instanceof Error ? cause.message : "No fue posible consultar los horarios.");
                }
            } finally {
                if (!cancelled) setLoadingSlots(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [date, endpoint, serviceId, specialistId]);

    async function selectSlot(slot: string) {
        if (!selectedService || !selectedSpecialist) return;
        setHoldingSlot(slot);
        setError(null);
        try {
            const holdKey = crypto.randomUUID();
            const response = await fetch(`${endpoint}/slot-holds`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": holdKey },
                body: JSON.stringify({
                    serviceId: selectedService.id,
                    specialistId: selectedSpecialist.id,
                    date,
                    time: timeToOperationInputValue(slot, data.operationContext.timeZone),
                }),
            });
            const payload = await response.json().catch(() => null) as { data?: { holdToken?: string }; error?: { message?: string } } | null;
            if (!response.ok || !payload?.data?.holdToken) throw new Error(errorMessage(payload, "Ese horario ya no está disponible."));
            setSelectedSlot(slot);
            setHoldToken(payload.data.holdToken);
        } catch (cause) {
            setSelectedSlot(null);
            setHoldToken(null);
            setError(cause instanceof Error ? cause.message : "Ese horario ya no está disponible.");
            setSlots((items) => items.filter((item) => item !== slot));
        } finally {
            setHoldingSlot(null);
        }
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedService || !selectedSpecialist || !selectedSlot || !holdToken) return;
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch(`${endpoint}/bookings`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({
                    holdToken,
                    serviceId: selectedService.id,
                    specialistId: selectedSpecialist.id,
                    date,
                    time: timeToOperationInputValue(selectedSlot, data.operationContext.timeZone),
                    firstName,
                    lastName,
                    phone,
                    email,
                    paymentMethod: "efectivo",
                }),
            });
            const payload = await response.json().catch(() => null) as {
                data?: { bookingToken?: string; booking?: { startsAt?: string; serviceName?: string; specialistName?: string } };
                error?: { message?: string };
            } | null;
            if (!response.ok || !payload?.data?.bookingToken || !payload.data.booking?.startsAt) {
                throw new Error(errorMessage(payload, "No fue posible confirmar la reservación."));
            }
            setBooking({
                token: payload.data.bookingToken,
                startsAt: payload.data.booking.startsAt,
                serviceName: payload.data.booking.serviceName || selectedService.name,
                specialistName: payload.data.booking.specialistName || selectedSpecialist.displayName || selectedSpecialist.name,
            });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible confirmar la reservación.");
        } finally {
            setSubmitting(false);
        }
    }

    if (booking) {
        return <main className="flex min-h-dvh items-center justify-center bg-[#f4f4ef] px-4 py-10 text-foreground"><section className="w-full max-w-xl rounded-3xl border bg-background p-7 text-center shadow-xl shadow-black/5 sm:p-9">
            <CheckCircle2 className="mx-auto size-14" style={{ color: data.primaryColor }} />
            <p className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Solicitud recibida</p>
            <h1 className="mt-2 text-3xl font-semibold">Tu horario quedó apartado</h1>
            <p className="mt-3 text-muted-foreground">El negocio confirmará tu cita. Nadie más puede tomar este horario mientras se procesa tu solicitud.</p>
            <div className="mt-6 rounded-2xl border bg-muted/25 p-4 text-left text-sm"><p className="font-semibold">{booking.serviceName}</p><p className="mt-1 text-muted-foreground">{booking.specialistName} · {new Intl.DateTimeFormat(data.operationContext.locale, { dateStyle: "full", timeStyle: "short", timeZone: data.operationContext.timeZone }).format(new Date(booking.startsAt))}</p></div>
            <Button className="mt-6 w-full" style={{ backgroundColor: data.primaryColor }} asChild><Link href={`/portal/${data.slug}/turno/${booking.token}`}>Ver o cancelar mi cita</Link></Button>
        </section></main>;
    }

    return <main className="min-h-dvh bg-[#f4f4ef] text-foreground">
        <header className="border-b bg-background/95 backdrop-blur"><div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white" style={{ backgroundColor: data.primaryColor }}>{data.logoUrl ? <img src={data.logoUrl} alt="" className="size-full object-contain p-1" style={{ transform: `scale(${Math.max(0.6, Math.min(1.6, data.logoScale / 100))})` }} /> : <Sparkles className="size-5" />}</div><div className="min-w-0"><p className="truncate font-semibold">{data.clinicName}</p><p className="truncate text-xs text-muted-foreground">{data.subtitle}</p></div></div>
            {data.address ? <p className="flex max-w-full items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-4 shrink-0" style={{ color: data.primaryColor }} /><span className="truncate">{data.address}</span></p> : null}
        </div></header>
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-12">
            <section><p className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: data.primaryColor }}>Reservas en línea</p><h1 className="mt-2 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{data.intro}</h1><p className="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground"><Clock3 className="mt-0.5 size-4 shrink-0" />{data.scheduleSummary}</p>
                <PortalSocialLinks links={data.socialLinks} />
                <div className="mt-7 rounded-3xl border bg-background p-4 shadow-sm sm:p-6">
                    <div className="grid gap-5 sm:grid-cols-2"><Field label="Servicio"><select className="h-11 w-full rounded-xl border bg-background px-3" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{data.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min{service.showPrice ? ` · ${money(service.price, service.currency, data.operationContext.locale)}` : ""}</option>)}</select></Field><Field label="Profesional"><select className="h-11 w-full rounded-xl border bg-background px-3" value={selectedSpecialist?.id || ""} onChange={(event) => setSpecialistId(event.target.value)}>{eligibleSpecialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.displayName || specialist.name}{specialist.specialty ? ` · ${specialist.specialty}` : ""}</option>)}</select></Field><Field label="Fecha"><Input type="date" min={getOperationTodayKey(data.operationContext.timeZone)} value={date} onChange={(event) => setDate(event.target.value)} /></Field></div>
                    <div className="mt-6"><p className="text-sm font-medium">Horarios disponibles</p>{loadingSlots ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Consultando agenda…</p> : slots.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <button key={slot} type="button" disabled={holdingSlot !== null} onClick={() => void selectSlot(slot)} className={`h-11 rounded-xl border text-sm font-medium transition ${selectedSlot === slot ? "border-transparent text-white" : "bg-background hover:border-primary/50"}`} style={selectedSlot === slot ? { backgroundColor: data.primaryColor } : undefined}>{holdingSlot === slot ? <Loader2 className="mx-auto size-4 animate-spin" /> : timeToOperationInputValue(slot, data.operationContext.timeZone)}</button>)}</div> : <p className="mt-3 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">No hay horarios libres para esta selección.</p>}</div>
                </div>
            </section>
            <aside className="self-start rounded-3xl border bg-background p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2"><CalendarDays className="size-5" style={{ color: data.primaryColor }} /><h2 className="font-semibold">Tus datos</h2></div>{selectedSlot ? <p className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">{selectedService?.name}<br /><span className="text-muted-foreground">{selectedSpecialist?.displayName || selectedSpecialist?.name} · {timeToOperationInputValue(selectedSlot, data.operationContext.timeZone)}</span></p> : <p className="mt-3 text-sm text-muted-foreground">Elige un horario para continuar.</p>}
                <form className="mt-5 space-y-4" onSubmit={submit}><Field label="Nombre"><Input required value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={80} autoComplete="given-name" /></Field><Field label="Apellido (opcional)"><Input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={100} autoComplete="family-name" /></Field><Field label="Teléfono"><Input required value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} inputMode="tel" placeholder={`${data.operationContext.callingCode} 000 000 0000`} autoComplete="tel" /></Field><Field label="Correo (opcional)"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" /></Field>{data.paymentInstructions ? <p className="rounded-xl bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{data.paymentInstructions}</p> : null}{error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}<Button type="submit" disabled={!holdToken || submitting} className="h-11 w-full" style={{ backgroundColor: holdToken ? data.primaryColor : undefined }}>{submitting ? <><Loader2 className="mr-2 size-4 animate-spin" />Confirmando…</> : "Confirmar solicitud"}</Button></form>
            </aside>
        </div>
    </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block space-y-2"><Label>{label}</Label>{children}</label>;
}
