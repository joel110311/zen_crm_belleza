"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Bell, CalendarIcon, Check, ChevronsUpDown, Clock, CreditCard, Loader2, User } from "lucide-react";
import { createAppointment, deleteAppointment, updateAppointment } from "@/app/actions/calendar";
import { getPatientsForPicker, savePatient } from "@/app/actions/patients";
import { getSpecialists } from "@/app/actions/specialists";
import { getActiveServicesForBooking } from "@/app/actions/services";
import { useToast } from "@/components/ui/use-toast";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import type { GoogleCalendarSourceSummary } from "@/lib/google-calendar";
import {
    formatTimeLabel,
    getBusinessDayScheduleForDate,
    getNextOpenDate,
    isBusinessDayOpen,
    timeToMinutes,
    type BusinessHoursConfig,
} from "@/lib/calendar/business-hours";
import {
    dateKeyToLocalNoonDate,
    formatOperationDayLabel,
    getLocalCalendarDateKey,
    getOperationDateKey,
    getOperationTodayKey,
    operationDateReference,
    operationDateTimeToUtc,
    timeToOperationInputValue,
} from "@/lib/operation-dates";

type GoogleCalendarStatusPayload = {
    sources: GoogleCalendarSourceSummary[];
};

type PatientPickerItem = Awaited<ReturnType<typeof getPatientsForPicker>>[number];
type SpecialistPickerItem = Awaited<ReturnType<typeof getSpecialists>>[number];
type BookingService = Awaited<ReturnType<typeof getActiveServicesForBooking>>[number];

type SelectedAppointmentEvent = {
    id: string;
    title: string;
    start: Date;
    end: Date;
    notes?: string | null;
    resource?: {
        patient?: { id?: string | null } | null;
        specialist?: { id?: string | null } | null;
        specialistId?: string | null;
        serviceId?: string | null;
        appointmentType?: string | null;
        isFirstVisit?: boolean | null;
        isOverbook?: boolean | null;
        visitMode?: string | null;
        meetStatus?: string | null;
        meetLink?: string | null;
        paymentStatus?: string | null;
        paymentAmount?: number | null;
        paymentCurrency?: string | null;
        remindersOptOut?: boolean | null;
        googleCalendarId?: string | null;
    };
};

interface AppointmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedEvent?: SelectedAppointmentEvent | null;
    selectedSlot?: { start: Date; end: Date } | null;
    defaultPatient?: PatientPickerItem | null;
    defaultPatientId?: string | null;
    defaultSpecialistId?: string | null;
    onSuccess: () => void;
    businessHours: BusinessHoursConfig;
}

function patientName(patient?: PatientPickerItem | null) {
    return [patient?.firstName, patient?.lastName].filter(Boolean).join(" ") || "Cliente";
}

function localTimeInputValue(date: Date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function maxTimeInput(left: string, right: string) {
    return left > right ? left : right;
}

function nextOperationMinute(timeZone: string) {
    return timeToOperationInputValue(new Date(Date.now() + 60_000), timeZone);
}

export function AppointmentDialog({
    open,
    onOpenChange,
    selectedEvent,
    selectedSlot,
    defaultPatient,
    defaultPatientId,
    defaultSpecialistId,
    onSuccess,
    businessHours,
}: AppointmentDialogProps) {
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const [title, setTitle] = useState("");
    const [patientId, setPatientId] = useState("");
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [time, setTime] = useState("09:00");
    const [duration, setDuration] = useState("30");
    const [notes, setNotes] = useState("");
    const [calendarSources, setCalendarSources] = useState<GoogleCalendarSourceSummary[]>([]);
    const [selectedCalendarId, setSelectedCalendarId] = useState<string>("general");
    const [specialists, setSpecialists] = useState<SpecialistPickerItem[]>([]);
    const [services, setServices] = useState<BookingService[]>([]);
    const [selectedServiceId, setSelectedServiceId] = useState("none");
    const [selectedSpecialistId, setSelectedSpecialistId] = useState<string>("none");
    const [appointmentType, setAppointmentType] = useState("Servicio");
    const [isFirstVisit, setIsFirstVisit] = useState(false);
    const [isOverbook, setIsOverbook] = useState(false);
    const [visitMode, setVisitMode] = useState("presencial");
    const [meetLink, setMeetLink] = useState("");
    const [requestGoogleMeet, setRequestGoogleMeet] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentCurrency, setPaymentCurrency] = useState("MXN");
    const [remindersGloballyEnabled, setRemindersGloballyEnabled] = useState(false);
    const [sendReminders, setSendReminders] = useState(false);
    const [operationContext, setOperationContext] = useState({
        phoneDefaultCountry: "MX",
        currencies: ["MXN"],
        defaultCurrency: "MXN",
        locale: "es-MX",
        timeZone: "America/Mexico_City",
    });

    const [patients, setPatients] = useState<PatientPickerItem[]>([]);
    const [openCombobox, setOpenCombobox] = useState(false);
    const [query, setQuery] = useState("");
    const initialPatientId = defaultPatient?.id || defaultPatientId || "";

    const [isCreatingPatient, setIsCreatingPatient] = useState(false);
    const [newPatientName, setNewPatientName] = useState("");
    const [newPatientPhone, setNewPatientPhone] = useState("");
    const [isSubmittingPatient, setIsSubmittingPatient] = useState(false);

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active || !context) return;
                setOperationContext({
                    phoneDefaultCountry: context.phoneDefaultCountry || "MX",
                    currencies: Array.isArray(context.currencies) && context.currencies.length > 0 ? context.currencies : ["MXN"],
                    defaultCurrency: context.defaultCurrency || "MXN",
                    locale: context.locale || "es-MX",
                    timeZone: context.timeZone || "America/Mexico_City",
                });
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        let active = true;
        fetch("/api/settings", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((settings) => {
                if (!active || !settings) return;
                const enabled = Boolean(settings.appointmentRemindersEnabled && settings.reminderWhatsAppEnabled);
                setRemindersGloballyEnabled(enabled);
                setSendReminders(enabled && !selectedEvent?.resource?.remindersOptOut);
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, [open, selectedEvent]);

    const clampTimeToSchedule = useCallback((value: string, targetDate: Date) => {
        const targetDateKey = getLocalCalendarDateKey(targetDate);
        const referenceDate = operationDateReference(targetDateKey, businessHours.timeZone);
        const { schedule } = getBusinessDayScheduleForDate(referenceDate, businessHours);
        if (!schedule.enabled) {
            return businessHours.start;
        }

        const minutes = timeToMinutes(value);
        const minimumTime = targetDateKey === getOperationTodayKey(businessHours.timeZone)
            ? maxTimeInput(schedule.start, nextOperationMinute(businessHours.timeZone))
            : schedule.start;
        if (minutes < timeToMinutes(minimumTime) || minutes >= timeToMinutes(schedule.end)) {
            return minimumTime;
        }

        return value;
    }, [businessHours]);

    useEffect(() => {
        if (!open) return;

        if (selectedEvent) {
            const selectedDateKey = getOperationDateKey(selectedEvent.start, businessHours.timeZone);
            const selectedLocalDate = dateKeyToLocalNoonDate(selectedDateKey);
            setTitle(selectedEvent.title);
            setPatientId(selectedEvent.resource?.patient?.id || "");
            setDate(selectedLocalDate);
            setTime(clampTimeToSchedule(timeToOperationInputValue(selectedEvent.start, businessHours.timeZone), selectedLocalDate));
            const diffMins = (selectedEvent.end.getTime() - selectedEvent.start.getTime()) / 60000;
            setDuration(diffMins.toString());
            setNotes(selectedEvent.notes || "");
            setSelectedSpecialistId(selectedEvent.resource?.specialistId || selectedEvent.resource?.specialist?.id || "none");
            setSelectedServiceId(selectedEvent.resource?.serviceId || "none");
            setAppointmentType(selectedEvent.resource?.appointmentType || "Servicio");
            setIsFirstVisit(Boolean(selectedEvent.resource?.isFirstVisit));
            setIsOverbook(Boolean(selectedEvent.resource?.isOverbook));
            setVisitMode(selectedEvent.resource?.visitMode || "presencial");
            setMeetLink(selectedEvent.resource?.meetLink || "");
            setRequestGoogleMeet(selectedEvent.resource?.meetStatus === "requested");
            setPaymentAmount(
                selectedEvent.resource?.paymentAmount
                    ? String(selectedEvent.resource.paymentAmount)
                    : "",
            );
            setPaymentCurrency(selectedEvent.resource?.paymentCurrency || operationContext.defaultCurrency);
            setSendReminders(remindersGloballyEnabled && !selectedEvent.resource?.remindersOptOut);
            return;
        }

        if (selectedSlot) {
            const selectedDateKey = getLocalCalendarDateKey(selectedSlot.start);
            const selectedLocalDate = dateKeyToLocalNoonDate(selectedDateKey);
            const referenceDate = operationDateReference(selectedDateKey, businessHours.timeZone);
            const nextDate = isBusinessDayOpen(referenceDate, businessHours)
                ? selectedLocalDate
                : dateKeyToLocalNoonDate(getOperationDateKey(getNextOpenDate(referenceDate, businessHours), businessHours.timeZone));
            setTitle(defaultPatient ? `Servicio para ${patientName(defaultPatient)}` : "");
            setPatientId(initialPatientId);
            setDate(nextDate);
            setTime(clampTimeToSchedule(localTimeInputValue(selectedSlot.start), nextDate));
            setDuration(String(businessHours.defaultDurationMinutes));
            setNotes("");
            setSelectedSpecialistId(defaultSpecialistId || "none");
            setSelectedServiceId("none");
            setAppointmentType("Servicio");
            setIsFirstVisit(false);
            setIsOverbook(false);
            setVisitMode("presencial");
            setMeetLink("");
            setRequestGoogleMeet(false);
            setPaymentAmount("");
            setPaymentCurrency(operationContext.defaultCurrency);
            setSendReminders(remindersGloballyEnabled);
            return;
        }

        const nextOpenDate = dateKeyToLocalNoonDate(getOperationDateKey(getNextOpenDate(new Date(), businessHours), businessHours.timeZone));
        setTitle(defaultPatient ? `Servicio para ${patientName(defaultPatient)}` : "");
        setPatientId(initialPatientId);
        setDate(nextOpenDate);
        setTime(clampTimeToSchedule(businessHours.start, nextOpenDate));
        setDuration(String(businessHours.defaultDurationMinutes));
        setNotes("");
        setSelectedSpecialistId(defaultSpecialistId || "none");
        setSelectedServiceId("none");
        setAppointmentType("Servicio");
        setIsFirstVisit(false);
        setIsOverbook(false);
        setVisitMode("presencial");
        setMeetLink("");
        setRequestGoogleMeet(false);
        setPaymentAmount("");
        setPaymentCurrency(operationContext.defaultCurrency);
        setSendReminders(remindersGloballyEnabled);
    }, [businessHours, clampTimeToSchedule, defaultPatient, defaultSpecialistId, initialPatientId, open, operationContext.defaultCurrency, remindersGloballyEnabled, selectedEvent, selectedSlot]);

    useEffect(() => {
        if (!open) return;

        void getActiveServicesForBooking()
            .then(setServices)
            .catch((error) => console.error("Failed to load services:", error));
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const loadGoogleCalendars = async () => {
            try {
                const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
                if (!response.ok) return;
                const payload = (await response.json()) as GoogleCalendarStatusPayload;
                const sources = (payload.sources || []).filter((source) => source.isSelected);
                setCalendarSources(sources);

                const selectedFromEvent = selectedEvent?.resource?.googleCalendarId as string | undefined;
                const specialistCalendars = sources.filter((source) => source.isSpecialist && source.writable);
                const defaultWriteTarget = sources.find((source) => source.isWriteTarget && source.writable);

                if (selectedFromEvent && sources.some((source) => source.calendarId === selectedFromEvent)) {
                    setSelectedCalendarId(selectedFromEvent);
                    return;
                }

                if (specialistCalendars.length === 1) {
                    setSelectedCalendarId(specialistCalendars[0].calendarId);
                    return;
                }

                if (defaultWriteTarget) {
                    setSelectedCalendarId(defaultWriteTarget.calendarId);
                    return;
                }

                setSelectedCalendarId("general");
            } catch (error) {
                console.error("Failed to load Google calendars for dialog:", error);
            }
        };

        void loadGoogleCalendars();
    }, [open, selectedEvent]);

    useEffect(() => {
        if (!open) return;

        const loadSpecialists = async () => {
            try {
                const rows = await getSpecialists();
                setSpecialists(rows);
                const eventSpecialistId = selectedEvent?.resource?.specialistId || selectedEvent?.resource?.specialist?.id;
                if (eventSpecialistId && rows.some((row) => row.id === eventSpecialistId)) {
                    setSelectedSpecialistId(eventSpecialistId);
                    return;
                }
                if (!eventSpecialistId) {
                    const defaultRow = defaultSpecialistId
                        ? rows.find((row) => row.id === defaultSpecialistId)
                        : null;
                    if (defaultRow) {
                        setSelectedSpecialistId(defaultRow.id);
                        return;
                    }
                    if (rows.length === 1) {
                        setSelectedSpecialistId(rows[0].id);
                    }
                }
            } catch (error) {
                console.error("Failed to load specialists:", error);
            }
        };

        void loadSpecialists();
    }, [defaultSpecialistId, open, selectedEvent]);

    useEffect(() => {
        if (!open) return;

        const fetchPatients = async () => {
            const results = await getPatientsForPicker(query);
            if (defaultPatient && !results.some((patient) => patient.id === defaultPatient.id)) {
                setPatients([defaultPatient, ...results]);
                return;
            }
            setPatients(results);
        };

        void fetchPatients();
    }, [defaultPatient, open, query]);

    useEffect(() => {
        if (!date) return;
        const clamped = clampTimeToSchedule(time, date);
        if (clamped !== time) {
            setTime(clamped);
        }
    }, [businessHours, clampTimeToSchedule, date, time]);

    const selectedDaySchedule = date
        ? getBusinessDayScheduleForDate(operationDateReference(getLocalCalendarDateKey(date), businessHours.timeZone), businessHours).schedule
        : null;
    const selectedDayStart = selectedDaySchedule?.enabled ? selectedDaySchedule.start : businessHours.start;
    const selectedDayEnd = selectedDaySchedule?.enabled ? selectedDaySchedule.end : businessHours.end;
    const selectedDateKey = date ? getLocalCalendarDateKey(date) : "";
    const todayKey = getOperationTodayKey(businessHours.timeZone);
    const currentOperationTime = nextOperationMinute(businessHours.timeZone);
    const selectedDayMinimumTime = selectedDateKey === todayKey
        ? maxTimeInput(selectedDayStart, currentOperationTime)
        : selectedDayStart;
    const writableSources = calendarSources.filter((source) => source.writable);
    const specialistSources = writableSources.filter((source) => source.isSpecialist);
    const selectedCalendar =
        writableSources.find((source) => source.calendarId === selectedCalendarId) ||
        writableSources.find((source) => source.isWriteTarget) ||
        null;
    const selectedPatient = patients.find((patient) => patient.id === patientId) || (defaultPatient?.id === patientId ? defaultPatient : undefined);
    const selectedSpecialist = specialists.find((specialist) => specialist.id === selectedSpecialistId);
    const selectedService = services.find((service) => service.id === selectedServiceId);
    const eligibleSpecialistIds = selectedService?.specialists.map((entry) => entry.specialistId) || [];
    const availableSpecialists = eligibleSpecialistIds.length > 0
        ? specialists.filter((specialist) => eligibleSpecialistIds.includes(specialist.id))
        : specialists;
    const specialistCalendar = selectedSpecialist?.googleCalendarSource || null;

    const handleSubmit = () => {
        if (!patientId) {
            toast({
                title: "Cliente requerido",
                description: "Selecciona o registra un cliente antes de apartar el horario.",
                variant: "destructive",
            });
            return;
        }

        if (!date || !time || !title) {
            toast({ title: "Faltan datos", description: "Completa fecha, hora y motivo.", variant: "destructive" });
            return;
        }

        const dateKey = getLocalCalendarDateKey(date);
        const referenceDate = operationDateReference(dateKey, businessHours.timeZone);
        const { schedule } = getBusinessDayScheduleForDate(referenceDate, businessHours);
        if (!schedule.enabled) {
            toast({
                title: "Dia cerrado",
                description: "Ese dia no tiene horario comercial configurado. Elige otra fecha.",
                variant: "destructive",
            });
            return;
        }

        const startTime = operationDateTimeToUtc(dateKey, time, businessHours.timeZone);
        const endTime = new Date(startTime.getTime() + parseInt(duration) * 60000);
        if (startTime <= new Date()) {
            toast({
                title: "Horario no disponible",
                description: "Solo puedes agendar citas desde este momento en adelante.",
                variant: "destructive",
            });
            return;
        }
        const targetCalendarId = specialistCalendar?.calendarId || selectedCalendar?.calendarId;
        const blockingCalendarIds = targetCalendarId ? [targetCalendarId] : undefined;
        const normalizedMeetLink = meetLink.trim();
        const wantsGoogleMeet = ["virtual", "hibrida"].includes(visitMode) && requestGoogleMeet && !normalizedMeetLink;
        const amount = Number(paymentAmount || 0);
        const normalizedPaymentAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
        const existingPaymentStatus = selectedEvent?.resource?.paymentStatus;
        const specialistName = selectedSpecialist
            ? (selectedSpecialist.displayName || selectedSpecialist.name)
            : selectedCalendar?.isSpecialist
                ? (selectedCalendar.specialistName || selectedCalendar.summary)
                : undefined;

        startTransition(async () => {
            try {
                const payload = {
                    title,
                    startTime,
                    endTime,
                    notes,
                    patientId,
                    specialistId: selectedSpecialistId !== "none" ? selectedSpecialistId : undefined,
                    serviceId: selectedServiceId !== "none" ? selectedServiceId : undefined,
                    appointmentType,
                    isFirstVisit,
                    isOverbook,
                    visitMode,
                    meetStatus: wantsGoogleMeet ? "requested" : normalizedMeetLink ? "generated" : "none",
                    meetLink: normalizedMeetLink || undefined,
                    paymentStatus: existingPaymentStatus || (normalizedPaymentAmount > 0 ? "pending" : "unpaid"),
                    paymentAmount: normalizedPaymentAmount,
                    paymentCurrency,
                    remindersOptOut: !sendReminders,
                    googleCalendarId: targetCalendarId,
                    googleCalendarName: specialistCalendar?.summary || selectedCalendar?.summary,
                    googleCalendarColor: specialistCalendar?.backgroundColor || selectedCalendar?.backgroundColor || undefined,
                    specialistName,
                    blockingCalendarIds,
                };

                const result = selectedEvent
                    ? await updateAppointment(selectedEvent.id, payload)
                    : await createAppointment(payload);

                if (!result.success) {
                    throw new Error(result.error || "No se pudo guardar la cita.");
                }

                toast({
                    title: selectedEvent ? "Cita actualizada" : "Horario apartado",
                    description: selectedEvent ? undefined : "La reserva bloqueará el horario hasta que sea confirmada.",
                });
                onSuccess();
                onOpenChange(false);
            } catch (error) {
                console.error(error);
                toast({
                    title: "Error",
                    description: error instanceof Error ? error.message : "No se pudo guardar la cita.",
                    variant: "destructive",
                });
            }
        });
    };

    const handleDelete = async () => {
        if (!selectedEvent) return;
        if (!confirm("Eliminar cita?")) return;

        startTransition(async () => {
            await deleteAppointment(selectedEvent.id);
            toast({ title: "Cita eliminada" });
            onSuccess();
            onOpenChange(false);
        });
    };

    const handleCreatePatient = async () => {
        if (!newPatientName.trim() || !newPatientPhone.trim()) {
            toast({ title: "Error", description: "El nombre y el teléfono son obligatorios.", variant: "destructive" });
            return;
        }

        setIsSubmittingPatient(true);
        try {
            const result = await savePatient({
                firstName: newPatientName,
                lastName: "",
                phone: newPatientPhone,
            });

            if (result.success && result.patient) {
                const pickerPatient = {
                    id: result.patient.id,
                    patientNumber: result.patient.patientNumber,
                    firstName: result.patient.firstName,
                    lastName: result.patient.lastName,
                    phone: result.patient.phone,
                    email: result.patient.email,
                    dob: result.patient.dob,
                };
                setPatients((prev) => [pickerPatient, ...prev]);
                setPatientId(result.patient.id);
                if (!title) setTitle(`Servicio para ${patientName(pickerPatient)}`);
                setIsCreatingPatient(false);
                setNewPatientName("");
                setNewPatientPhone("");
                setOpenCombobox(false);
                toast({ title: "Cliente creado" });
                return;
            }

            toast({ title: "Error", description: result.error || "No se pudo crear.", variant: "destructive" });
        } catch {
            toast({ title: "Error", description: "Error al crear paciente.", variant: "destructive" });
        } finally {
            setIsSubmittingPatient(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto bg-card sm:max-w-[720px]">
                <DialogHeader className="border-b pb-4">
                    <DialogTitle className="text-xl font-semibold text-foreground">
                        {selectedEvent ? "Editar Cita" : "Nueva Cita"}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="space-y-2">
                        <Label>Cliente *</Label>
                        <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={openCombobox}
                                    className="h-11 w-full justify-between bg-background"
                                >
                                    {patientId && selectedPatient
                                        ? patientName(selectedPatient)
                                        : "Buscar cliente..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0">
                                <Command shouldFilter={false}>
                                    <CommandInput placeholder="Buscar cliente..." onValueChange={setQuery} />
                                    <CommandList>
                                        <CommandEmpty>No se encontraron clientes.</CommandEmpty>
                                        <CommandGroup>
                                            {patients.map((patient) => (
                                                <CommandItem
                                                    key={patient.id}
                                                    value={patient.id}
                                                    onSelect={(currentValue) => {
                                                        setPatientId(currentValue);
                                                        setOpenCombobox(false);
                                                        if (!title) setTitle(`Servicio para ${patientName(patient)}`);
                                                    }}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            patientId === patient.id ? "opacity-100" : "opacity-0",
                                                        )}
                                                    />
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{patientName(patient)}</span>
                                                        <span className="text-xs text-secondary-foreground">
                                                            {patient.phone || "Sin teléfono"}
                                                        </span>
                                                    </div>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                    <div className="mt-1 border-t p-2">
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start font-medium text-primary"
                                            onClick={(event) => {
                                                event.preventDefault();
                                                setIsCreatingPatient(true);
                                                setOpenCombobox(false);
                                            }}
                                        >
                                            + Registrar nuevo cliente
                                        </Button>
                                    </div>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {isCreatingPatient ? (
                        <div className="-mt-2 space-y-4 rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center justify-between border-b pb-2">
                                <h4 className="flex items-center text-sm font-medium text-foreground">
                                    <User className="mr-2 h-4 w-4 text-primary" />
                                    Registrar cliente
                                </h4>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setIsCreatingPatient(false)}>
                                    Cancelar
                                </Button>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Nombre *</Label>
                                    <Input value={newPatientName} onChange={(event) => setNewPatientName(event.target.value)} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Teléfono *</Label>
                                    <PhonePrefixInput
                                        value={newPatientPhone}
                                        onChange={setNewPatientPhone}
                                        defaultCountry={operationContext.phoneDefaultCountry}
                                        className="grid-cols-[116px_minmax(0,1fr)]"
                                        inputClassName="h-8 text-sm"
                                    />
                                </div>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                className="h-8 w-full"
                                onClick={handleCreatePatient}
                                disabled={isSubmittingPatient || !newPatientName || !newPatientPhone}
                            >
                                {isSubmittingPatient ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                                Guardar y Seleccionar
                            </Button>
                        </div>
                    ) : null}

                    <div className="space-y-2">
                        <Label>Servicio</Label>
                        <Select value={selectedServiceId} onValueChange={(value) => {
                            setSelectedServiceId(value);
                            const service = services.find((entry) => entry.id === value);
                            if (!service) return;
                            setTitle(service.name);
                            setAppointmentType(service.name);
                            setDuration(String(service.durationMinutes));
                            setPaymentAmount(service.price > 0 ? String(service.price) : "");
                            setPaymentCurrency(service.currency || operationContext.defaultCurrency);
                            const assignedIds = service.specialists.map((entry) => entry.specialistId);
                            if (assignedIds.length > 0 && !assignedIds.includes(selectedSpecialistId)) {
                                setSelectedSpecialistId(assignedIds[0]);
                                const row = specialists.find((entry) => entry.id === assignedIds[0]);
                                if (row?.googleCalendarSource?.calendarId) setSelectedCalendarId(row.googleCalendarSource.calendarId);
                            }
                        }}>
                            <SelectTrigger className="h-11 bg-background"><SelectValue placeholder="Selecciona un servicio" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Servicio personalizado</SelectItem>
                                {services.map((service) => (
                                    <SelectItem key={service.id} value={service.id}>
                                        {service.name} · {service.durationMinutes} min · {new Intl.NumberFormat("es-MX", { style: "currency", currency: service.currency, maximumFractionDigits: 0 }).format(service.price)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedService && eligibleSpecialistIds.length > 0 ? <p className="text-xs text-muted-foreground">Solo se muestran los profesionales asignados a este servicio.</p> : null}
                    </div>

                    <div className="space-y-2">
                        <Label>Titulo / Motivo</Label>
                        <Input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            className="h-11 bg-background"
                            placeholder="Ej. Corte, color, tratamiento..."
                        />
                    </div>

                    {writableSources.length > 0 ? (
                        <div className="space-y-2">
                            <Label>Calendario / Especialista</Label>
                            <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                                <SelectTrigger className="h-11 bg-background">
                                    <SelectValue placeholder="Selecciona donde guardar la cita" />
                                </SelectTrigger>
                                <SelectContent>
                                    {writableSources.map((source) => (
                                        <SelectItem key={source.calendarId} value={source.calendarId}>
                                            {source.isSpecialist
                                                ? `${source.specialistName || source.summary} · Especialista`
                                                : source.summary}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {specialistSources.length > 0
                                    ? `Especialistas activos: ${specialistSources.map((source) => source.specialistName || source.summary).join(", ")}.`
                                    : "Si eliges un calendario de escritura, la cita se sincronizara directamente ahi."}
                            </p>
                        </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(18rem,1fr)_170px]">
                        <div className="space-y-2">
                            <Label>Profesional</Label>
                            <Select value={selectedSpecialistId} onValueChange={(value) => {
                                setSelectedSpecialistId(value);
                                const row = specialists.find((entry) => entry.id === value);
                                if (row?.googleCalendarSource?.calendarId) {
                                    setSelectedCalendarId(row.googleCalendarSource.calendarId);
                                }
                                if (row?.defaultDurationMinutes) {
                                    setDuration(String(row.defaultDurationMinutes));
                                }
                            }}>
                                <SelectTrigger className="h-11 w-full bg-background">
                                    <SelectValue placeholder="Selecciona especialista" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sin especialista</SelectItem>
                                    {availableSpecialists.map((specialist) => (
                                        <SelectItem key={specialist.id} value={specialist.id}>
                                            {specialist.displayName || specialist.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Modalidad</Label>
                            <Select value={visitMode} onValueChange={setVisitMode}>
                                <SelectTrigger className="h-11 bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="presencial">Presencial</SelectItem>
                                    <SelectItem value="virtual">Virtual</SelectItem>
                                    <SelectItem value="hibrida">Hibrida</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid gap-3">
                        <div className="flex min-h-[76px] items-center justify-between rounded-lg border bg-muted/20 px-3 py-3">
                            <div>
                                <p className="text-sm font-medium">Sobreturno</p>
                                <p className="text-xs text-muted-foreground">Permite solapar con otra cita.</p>
                            </div>
                            <Switch checked={isOverbook} onCheckedChange={setIsOverbook} />
                        </div>
                    </div>

                    <label
                        className={cn(
                            "flex items-start gap-3 rounded-lg border px-4 py-3",
                            remindersGloballyEnabled ? "cursor-pointer bg-muted/20" : "bg-muted/30 text-muted-foreground",
                        )}
                    >
                        <Checkbox
                            checked={sendReminders}
                            onCheckedChange={(checked) => setSendReminders(Boolean(checked))}
                            disabled={!remindersGloballyEnabled}
                            className="mt-1"
                        />
                        <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <Bell className="h-4 w-4 text-primary" />
                                Enviar recordatorios automaticos
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                {remindersGloballyEnabled
                                    ? "Se programaran los recordatorios configurados en Settings > Calendario al confirmar la cita."
                                    : "Activa los recordatorios en Settings > Calendario para usar esta opcion."}
                            </span>
                        </span>
                    </label>

                    {["virtual", "hibrida"].includes(visitMode) ? (
                        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-end">
                            <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-3">
                                <div>
                                    <p className="text-sm font-medium">Google Meet</p>
                                    <p className="text-xs text-muted-foreground">Crear link al sincronizar.</p>
                                </div>
                                <Switch checked={requestGoogleMeet} onCheckedChange={setRequestGoogleMeet} disabled={Boolean(meetLink.trim())} />
                            </div>
                            <div className="space-y-2">
                                <Label>Link de videollamada</Label>
                                <Input
                                    value={meetLink}
                                    onChange={(event) => setMeetLink(event.target.value)}
                                    className="h-11 bg-background"
                                    placeholder="https://meet.google.com/..."
                                />
                            </div>
                        </div>
                    ) : null}

                    <div className="grid gap-4 rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-primary" />
                            <p className="text-sm font-medium">Cobro de la cita</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                            <div className="space-y-2">
                                <Label>Monto esperado</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={paymentAmount}
                                    onChange={(event) => setPaymentAmount(event.target.value)}
                                    className="h-11 bg-background"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Moneda</Label>
                                <Select value={paymentCurrency} onValueChange={setPaymentCurrency}>
                                    <SelectTrigger className="h-11 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operationContext.currencies.map((currency) => (
                                            <SelectItem key={currency} value={currency}>
                                                {currency}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_170px]">
                        <div className="space-y-2">
                            <Label>Fecha *</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "h-11 w-full justify-start bg-background text-left font-normal",
                                            !date && "text-muted-foreground",
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? formatOperationDayLabel(getLocalCalendarDateKey(date), operationContext.locale, businessHours.timeZone, {
                                            day: "numeric",
                                            month: "long",
                                            year: "numeric",
                                        }) : <span>Seleccionar fecha</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={date}
                                        onSelect={setDate}
                                        disabled={(calendarDate) => {
                                            const calendarDateKey = getLocalCalendarDateKey(calendarDate);
                                            return calendarDateKey < todayKey || !isBusinessDayOpen(operationDateReference(calendarDateKey, businessHours.timeZone), businessHours);
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>Hora *</Label>
                            <div className="relative">
                                <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    type="time"
                                    value={time}
                                    onChange={(event) => setTime(event.target.value)}
                                    className="h-11 bg-background pl-9"
                                    min={selectedDayMinimumTime}
                                    max={selectedDayEnd}
                                    disabled={!selectedDaySchedule?.enabled}
                                />
                            </div>
                            {selectedDaySchedule?.enabled ? (
                                <p className="text-xs text-muted-foreground">
                                    Disponible entre {formatTimeLabel(selectedDayStart)} y {formatTimeLabel(selectedDayEnd)}.
                                </p>
                            ) : (
                                <p className="text-xs text-amber-600">
                                    Este dia esta cerrado en el horario comercial.
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>Duracion</Label>
                            <Select value={duration} onValueChange={setDuration}>
                                <SelectTrigger className="h-11 bg-background">
                                    <SelectValue placeholder="Duracion" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="15">15 min</SelectItem>
                                    <SelectItem value="30">30 min</SelectItem>
                                    <SelectItem value="45">45 min</SelectItem>
                                    <SelectItem value="60">1 hora</SelectItem>
                                    <SelectItem value="90">1.5 horas</SelectItem>
                                    <SelectItem value="120">2 horas</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Notas / Descripcion</Label>
                        <Input
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            className="h-11 bg-background"
                            placeholder="Detalles adicionales..."
                        />
                    </div>
                </div>

                <DialogFooter className="-mx-6 -mb-6 mt-4 flex items-center justify-between border-t bg-card p-4 sm:justify-between">
                    {selectedEvent ? (
                        <Button variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={handleDelete} type="button">
                            Eliminar
                        </Button>
                    ) : (
                        <div />
                    )}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
                            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {selectedEvent ? "Actualizar Cita" : "Agendar Cita"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
