"use client";

import { useEffect, useMemo, useState, useTransition, type ComponentType } from "react";
import {
    ArrowLeft,
    ArrowRight,
    Bell,
    CalendarDays,
    Check,
    CheckCircle2,
    Clock,
    CreditCard,
    Droplets,
    Loader2,
    MapPin,
    Scissors,
    Sparkles,
    Sun,
    Sunrise,
    UserRound,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { bookPortalAppointment, getPortalAvailability } from "@/app/actions/portal";
import { getOperationTodayKey, timeToOperationInputValue } from "@/lib/operation-dates";
import { cn } from "@/lib/utils";

type PortalData = NonNullable<Awaited<ReturnType<typeof import("@/app/actions/portal").getPortalData>>>;

type Props = {
    data: PortalData;
};

const SERVICE_ICONS: ComponentType<{ className?: string }>[] = [Scissors, Sparkles, Droplets];

const PAYMENT_METHODS = [
    { value: "efectivo", label: "Efectivo" },
    { value: "tarjeta", label: "Tarjeta" },
    { value: "transferencia", label: "Transferencia" },
] as const;

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

export function PortalBooking({ data }: Props) {
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
    const [isLoadingSlots, setIsLoadingSlots] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [phone, setPhone] = useState("");
    const [reason, setReason] = useState(data.services[0]?.name || "Servicio de belleza");
    const [paymentMethod, setPaymentMethod] = useState("efectivo");
    const [sendReminders, setSendReminders] = useState(Boolean(data.remindersEnabled));
    const [showCustomerForm, setShowCustomerForm] = useState(false);
    const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
    const [confirmedClientName, setConfirmedClientName] = useState("");
    const remindersGloballyEnabled = Boolean(data.remindersEnabled);

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
    const chosenPaymentLabel = PAYMENT_METHODS.find((entry) => entry.value === paymentMethod)?.label || "Efectivo";
    const groupedSlots = useMemo(() => {
        const morning: string[] = [];
        const afternoon: string[] = [];

        slots.forEach((slot) => {
            const time = timeToOperationInputValue(slot, operationContext.timeZone);
            const hour = Number(time.split(":")[0]);
            (hour < 12 ? morning : afternoon).push(slot);
        });

        return [
            { key: "morning", label: "Mañana", icon: Sunrise, slots: morning },
            { key: "afternoon", label: "Tarde", icon: Sun, slots: afternoon },
        ].filter((group) => group.slots.length > 0);
    }, [operationContext.timeZone, slots]);

    useEffect(() => {
        setSendReminders(remindersGloballyEnabled);
    }, [remindersGloballyEnabled]);

    useEffect(() => {
        if (!data.enabled || !selectedSpecialistId || !date) return;

        const load = async () => {
            setIsLoadingSlots(true);
            setSelectedSlot("");
            setShowCustomerForm(false);
            try {
                const result = await getPortalAvailability(
                    data.slug,
                    selectedSpecialistId,
                    date,
                    selectedService?.durationMinutes,
                );
                if (!result.success) {
                    setSlots([]);
                    toast({ title: "Sin disponibilidad", description: result.error, variant: "destructive" });
                    return;
                }
                setSlots(result.slots);
            } finally {
                setIsLoadingSlots(false);
            }
        };

        void load();
    }, [data.enabled, data.slug, date, selectedService?.durationMinutes, selectedSpecialistId, toast]);

    const selectService = (serviceId: string) => {
        setSelectedServiceId(serviceId);
        const service = data.services.find((entry) => entry.id === serviceId);
        if (!service) return;
        setReason(service.name);
        const assignedIds = service.specialists.map((entry) => entry.specialistId);
        if (assignedIds.length > 0 && !assignedIds.includes(selectedSpecialistId)) {
            setSelectedSpecialistId(data.specialists.find((entry) => assignedIds.includes(entry.id))?.id || "");
        }
    };

    const handleSubmit = () => {
        if (!selectedSpecialistId || !date || !selectedSlot || !firstName.trim() || !phone) {
            toast({
                title: "Faltan datos",
                description: "Completa servicio, profesional, horario, nombre y teléfono.",
                variant: "destructive",
            });
            return;
        }

        startTransition(async () => {
            const slotDate = new Date(selectedSlot);
            const result = await bookPortalAppointment({
                slug: data.slug,
                specialistId: selectedSpecialistId,
                serviceId: selectedServiceId !== "none" ? selectedServiceId : undefined,
                date,
                time: timeToOperationInputValue(slotDate, operationContext.timeZone),
                durationMinutes: selectedService?.durationMinutes || specialist?.defaultDurationMinutes || data.defaultDurationMinutes,
                firstName: firstName.trim(),
                lastName: "",
                phone,
                reason,
                isFirstVisit: false,
                sendReminders,
                paymentMethod,
            });

            if (!result.success) {
                toast({ title: "No se pudo reservar", description: result.error, variant: "destructive" });
                return;
            }

            setConfirmedClientName(result.clientName || firstName.trim());
            setConfirmationToken(result.token || null);
            toast({ title: "Horario apartado", description: "El negocio recibió tu solicitud para confirmarla." });
        });
    };

    if (!data.enabled) {
        return (
            <div className="flex min-h-screen flex-col bg-[#f4f4ef] text-foreground">
                <header className="border-b bg-white">
                    <div className="flex min-h-16 w-full items-center gap-3 px-4 py-3 sm:px-6 xl:px-8">
                        <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white"
                            style={{ backgroundColor: data.primaryColor }}
                        >
                            {data.logoUrl ? (
                                <img
                                    src={data.logoUrl}
                                    alt=""
                                    className="h-full w-full object-contain p-1"
                                    style={{ transform: `scale(${Math.max(0.6, Math.min(1.6, data.logoScale / 100))})` }}
                                />
                            ) : (
                                <Sparkles className="h-5 w-5" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="truncate font-semibold">{data.clinicName}</p>
                            <p className="truncate text-xs text-muted-foreground">{data.subtitle}</p>
                        </div>
                    </div>
                </header>
                <main className="flex flex-1 items-center justify-center px-4 py-10">
                    <div className="w-full max-w-lg rounded-3xl border bg-white p-8 text-center shadow-xl shadow-black/5">
                        <div
                            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: data.primaryColor }}
                        >
                            <CalendarDays className="h-8 w-8" />
                        </div>
                        <h1 className="mt-5 text-2xl font-bold">Reservas en línea no disponibles</h1>
                        <p className="mt-3 text-muted-foreground">
                            Por el momento este negocio no está recibiendo solicitudes desde el portal.
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    if (confirmationToken) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f4f4ef] px-4 py-10">
                <div className="w-full max-w-xl rounded-3xl border bg-white p-8 text-center shadow-xl shadow-black/5">
                    <div
                        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: data.primaryColor }}
                    >
                        <CheckCircle2 className="h-9 w-9" />
                    </div>
                    <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Solicitud recibida</p>
                    <h1 className="mt-2 text-3xl font-bold text-foreground">Tu horario quedó apartado</h1>
                    <p className="mt-3 text-muted-foreground">
                        {confirmedClientName ? `${confirmedClientName}, ` : ""}el negocio confirmará la cita por WhatsApp. Mientras tanto nadie más podrá usar ese horario.
                    </p>
                    <div className="mt-6 rounded-2xl border bg-muted/20 p-4 text-left text-sm">
                        <p className="font-semibold">{selectedService?.name || reason}</p>
                        <p className="mt-1 text-muted-foreground">
                            {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })} · {selectedSlot ? timeToOperationInputValue(selectedSlot, operationContext.timeZone) : ""}
                        </p>
                        <p className="mt-1 text-muted-foreground">Forma de pago: {chosenPaymentLabel}</p>
                    </div>
                    <Button className="mt-6 h-11 w-full" asChild style={{ backgroundColor: data.primaryColor }}>
                        <a href={`/portal/turno/${confirmationToken}`}>Ver el estado de mi cita</a>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#f4f4ef] text-foreground">
            <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
                <div className="grid min-h-16 w-full items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(440px,2fr)_minmax(0,1fr)] xl:px-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white"
                            style={{ backgroundColor: data.primaryColor }}
                        >
                            {data.logoUrl ? (
                                <img src={data.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                            ) : (
                                <Sparkles className="h-5 w-5" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="truncate font-semibold">{data.clinicName}</p>
                            <p className="truncate text-xs text-muted-foreground">{data.subtitle}</p>
                        </div>
                    </div>
                    <h1 className="col-span-full text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl lg:col-span-1 lg:col-start-2 lg:row-start-1 2xl:text-4xl">
                        Elige tu servicio y aparta el mejor horario para ti
                    </h1>
                    {data.address ? (
                        <div className="flex max-w-full items-center gap-2 justify-self-center rounded-full border bg-[#f8f8f4] px-3 py-2 text-xs text-muted-foreground lg:justify-self-end">
                            <MapPin className="h-4 w-4 shrink-0" style={{ color: data.primaryColor }} />
                            <span className="truncate">{data.address}</span>
                        </div>
                    ) : (
                        <div aria-hidden="true" className="hidden lg:block" />
                    )}
                </div>
            </header>

            <main id="reservar" className="mx-auto w-full max-w-[1760px] px-4 py-4 sm:px-6 lg:py-5 xl:px-8">
                <div className="grid items-start gap-4 xl:grid-cols-[270px_minmax(440px,1fr)_330px] 2xl:grid-cols-[280px_minmax(640px,1fr)_360px] 2xl:gap-5">
                    <section id="servicios" className="self-start rounded-3xl border bg-white p-4 shadow-sm">
                        <div className="px-1 pb-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paso 1</p>
                            <h2 className="mt-1 text-lg font-semibold">Selecciona un servicio</h2>
                        </div>
                        <div className="portal-scrollbar max-h-[58vh] space-y-2 overflow-y-auto pr-2 [scrollbar-gutter:stable] 2xl:max-h-[620px]">
                            {data.services.map((service, index) => {
                                const Icon = SERVICE_ICONS[index % SERVICE_ICONS.length];
                                const selected = selectedServiceId === service.id;
                                return (
                                    <button
                                        key={service.id}
                                        type="button"
                                        onClick={() => selectService(service.id)}
                                        className={cn(
                                            "group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                                            selected ? "shadow-sm" : "border-transparent hover:border-border hover:bg-muted/25",
                                        )}
                                        style={selected ? { borderColor: data.primaryColor, backgroundColor: `${data.primaryColor}0D` } : undefined}
                                    >
                                        {service.imageUrl ? (
                                            <img src={service.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl border object-cover" />
                                        ) : (
                                            <span
                                                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white"
                                                style={{ backgroundColor: index % 2 ? "#A88B54" : data.primaryColor }}
                                            >
                                                <Icon className="h-6 w-6" />
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold">{service.name}</span>
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                {service.durationMinutes} min{service.showPrice ? ` · ${money(service.price, service.currency, operationContext.locale)}` : ""}
                                            </span>
                                        </span>
                                        {selected ? <Check className="h-5 w-5 shrink-0" style={{ color: data.primaryColor }} /> : null}
                                    </button>
                                );
                            })}
                            {data.services.length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-4">
                                    <Label>Servicio o motivo</Label>
                                    <Input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2" />
                                </div>
                            ) : null}
                        </div>
                    </section>

                    <section className="self-start space-y-4">
                        <div className="rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
                            <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paso 2</p>
                                    <h2 className="mt-1 text-xl font-semibold">Elige profesional, fecha y hora</h2>
                                </div>
                                <div className="w-full sm:w-56">
                                    <Label className="sr-only">Profesional</Label>
                                    <Select value={selectedSpecialistId} onValueChange={setSelectedSpecialistId}>
                                        <SelectTrigger className="h-10 rounded-xl bg-background">
                                            <SelectValue placeholder="Selecciona profesional" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableSpecialists.map((entry) => (
                                                <SelectItem key={entry.id} value={entry.id}>{entry.displayName || entry.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="flex justify-center py-4 sm:py-5">
                                <div className="w-full max-w-[860px]">
                                    <Calendar
                                        mode="single"
                                        selected={selectedDate}
                                        onSelect={(value) => value && setDate(dateKey(value))}
                                        disabled={{ before: new Date() }}
                                        locale={es}
                                        className="w-full bg-white p-0 [--cell-size:3rem]"
                                        classNames={{
                                            root: "w-full",
                                            months: "relative flex w-full flex-col",
                                            month: "flex w-full flex-col gap-2",
                                            nav: "absolute right-2 top-1 z-10 flex w-auto items-center gap-1.5",
                                            month_caption: "flex h-12 w-full items-center justify-start px-2",
                                            caption_label: "text-2xl font-semibold capitalize tracking-normal sm:text-3xl",
                                            button_previous: "size-9 rounded-xl border border-[#deddd7] bg-[#fbfaf7] p-0 text-foreground shadow-none transition hover:border-[#c9c7be] hover:bg-[#f1efe8]",
                                            button_next: "size-9 rounded-xl border border-[#deddd7] bg-[#fbfaf7] p-0 text-foreground shadow-none transition hover:border-[#c9c7be] hover:bg-[#f1efe8]",
                                            table: "w-full border-collapse",
                                            weekdays: "grid w-full grid-cols-7",
                                            weekday: "text-center text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground",
                                            week: "mt-1 grid w-full grid-cols-7",
                                            day: "h-11 w-full px-0 text-center sm:h-12 sm:px-1 xl:h-[52px] xl:px-2 2xl:px-3",
                                            day_button: "h-full w-full min-w-0 rounded-xl text-base font-semibold",
                                        }}
                                        components={{
                                            Chevron: ({ className, orientation, ...props }) => orientation === "left"
                                                ? <ArrowLeft className={cn("h-4 w-4", className)} {...props} />
                                                : <ArrowRight className={cn("h-4 w-4", className)} {...props} />,
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
                            <div className="flex items-center justify-between border-b pb-4">
                                <div>
                                    <h2 className="text-2xl font-semibold tracking-tight">Horarios disponibles</h2>
                                    <p className="mt-1 text-sm font-medium uppercase tracking-[0.1em] text-muted-foreground">
                                        {format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: es })}
                                    </p>
                                </div>
                                {isLoadingSlots ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
                            </div>

                            <div className="mt-5 grid gap-5 2xl:grid-cols-2">
                                {groupedSlots.map((group) => {
                                    const GroupIcon = group.icon;
                                    return (
                                        <div key={group.key} className="rounded-2xl border bg-[#fbfaf7] p-4">
                                            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                                <GroupIcon className="h-6 w-6" />
                                                {group.label}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                                {group.slots.map((slot) => {
                                                    const active = selectedSlot === slot;
                                                    return (
                                                        <button
                                                            key={slot}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedSlot(slot);
                                                                setShowCustomerForm(false);
                                                            }}
                                                            className={cn(
                                                                "flex h-12 items-center justify-center rounded-full border bg-white text-base font-semibold transition",
                                                                active ? "text-white shadow-sm" : "bg-white hover:bg-muted/30",
                                                            )}
                                                            style={active ? { backgroundColor: data.primaryColor, borderColor: data.primaryColor } : undefined}
                                                        >
                                                            {timeToOperationInputValue(slot, operationContext.timeZone)}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                                {!isLoadingSlots && slots.length === 0 ? (
                                    <p className="rounded-xl border border-dashed p-4 text-sm leading-5 text-muted-foreground">No hay horarios disponibles para este día.</p>
                                ) : null}
                            </div>
                        </div>
                    </section>

                    <aside className="self-start rounded-3xl border bg-white p-4 shadow-sm sm:p-5 xl:sticky xl:top-24">
                        <div className="border-b pb-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resumen de reserva</p>
                        </div>

                        <div className="mt-4">
                            {selectedService?.imageUrl ? (
                                <img
                                    src={selectedService.imageUrl}
                                    alt={selectedService.name}
                                    className="h-40 w-full rounded-2xl object-cover"
                                />
                            ) : (
                                <div
                                    className="flex h-32 w-full items-center justify-center rounded-2xl text-white"
                                    style={{ background: `linear-gradient(135deg, ${data.primaryColor}, #A88B54)` }}
                                >
                                    <Sparkles className="h-9 w-9" />
                                </div>
                            )}

                            <span className="mt-4 inline-flex rounded-full bg-[#efeee8] px-3 py-1 text-[11px] font-medium text-muted-foreground">
                                Servicio
                            </span>
                            <h2 className="mt-2 text-xl font-semibold leading-tight">{selectedService?.name || reason}</h2>

                            <div className="mt-4 space-y-3 text-sm">
                                <div className="flex items-start gap-3">
                                    <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{specialist?.displayName || specialist?.name || "Profesional por asignar"}</p>
                                        <p className="text-xs text-muted-foreground">Profesional seleccionado</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />
                                    <p>{selectedService?.durationMinutes || specialist?.defaultDurationMinutes || data.defaultDurationMinutes} minutos</p>
                                </div>
                                {selectedService?.showPrice ? (
                                    <div className="flex items-center gap-3">
                                        <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
                                        <p className="font-semibold">{money(selectedService.price, selectedService.currency, operationContext.locale)}</p>
                                    </div>
                                ) : null}
                            </div>

                            <div className="mt-5 rounded-2xl bg-[#f5f2eb] p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fecha seleccionada</p>
                                <p className="mt-1 text-sm font-semibold capitalize">
                                    {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
                                    {selectedSlot ? ` · ${timeToOperationInputValue(selectedSlot, operationContext.timeZone)}` : " · Elige un horario"}
                                </p>
                            </div>

                            {!showCustomerForm ? (
                                <>
                                    <Button
                                        type="button"
                                        onClick={() => setShowCustomerForm(true)}
                                        disabled={!selectedSlot}
                                        className="mt-5 h-12 w-full rounded-xl text-sm font-semibold uppercase tracking-[0.08em]"
                                        style={selectedSlot ? { backgroundColor: data.primaryColor } : undefined}
                                    >
                                        Continuar <ArrowRight className="ml-2 h-5 w-5" />
                                    </Button>
                                    <p className="mt-2 text-center text-[11px] text-muted-foreground">Paso final: tus datos de contacto</p>
                                </>
                            ) : (
                                <div className="mt-5 space-y-4 border-t pt-5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: data.primaryColor }}>
                                            <UserRound className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Paso 3</p>
                                            <h3 className="font-semibold">Completa tu reserva</h3>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Nombre completo</Label>
                                        <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Tu nombre" className="h-11 rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>WhatsApp</Label>
                                        <PhonePrefixInput value={phone} onChange={setPhone} placeholder="10 dígitos" required />
                                        <p className="text-[11px] leading-4 text-muted-foreground">Si ya tienes registro, usaremos tus datos existentes sin cambiar tu nombre.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Forma de pago</Label>
                                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                            <SelectTrigger className="h-11 rounded-xl bg-background"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {PAYMENT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <label className={cn(
                                        "flex items-start gap-3 rounded-2xl border px-3 py-3",
                                        remindersGloballyEnabled ? "cursor-pointer" : "bg-muted/30 text-muted-foreground",
                                    )}>
                                        <Checkbox
                                            checked={sendReminders}
                                            onCheckedChange={(checked) => setSendReminders(Boolean(checked))}
                                            disabled={!remindersGloballyEnabled}
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-2 text-sm font-medium"><Bell className="h-4 w-4" /> Recordatorios por WhatsApp</span>
                                            <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Recibe avisos antes de tu cita.</span>
                                        </span>
                                    </label>

                                    {data.paymentInstructions ? (
                                        <div className="rounded-2xl border bg-muted/20 px-3 py-3 text-xs leading-5 text-muted-foreground">
                                            <span className="flex items-center gap-2 font-medium text-foreground"><CreditCard className="h-4 w-4" /> Información de pago</span>
                                            <p className="mt-1">{data.paymentInstructions}</p>
                                        </div>
                                    ) : null}

                                    <Button
                                        onClick={handleSubmit}
                                        disabled={isPending}
                                        className="h-12 w-full rounded-xl text-base"
                                        style={{ backgroundColor: data.primaryColor }}
                                    >
                                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                                        Apartar horario
                                    </Button>
                                    <p className="text-center text-[11px] leading-4 text-muted-foreground">El horario se bloquea y queda pendiente de confirmación del negocio.</p>
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            </main>
        </div>
    );
}
