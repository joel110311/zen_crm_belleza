"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { deleteAppointment, getAppointments } from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { getSpecialists } from "@/app/actions/specialists";
import { BigCalendar } from "@/components/calendar/big-calendar";
import { AppointmentList } from "@/components/calendar/appointment-list";
import { AppointmentDialog } from "@/components/calendar/appointment-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, Filter, LayoutList, Plus } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { getOperationDateKey } from "@/lib/operation-dates";
import { normalizeRole } from "@/lib/permissions";

type CalendarFilterOption = {
    id: string;
    label: string;
};

const NO_SPECIALIST_FILTER = "__none__";
const FINISHED_APPOINTMENT_STATUSES = new Set(["completed", "cancelled", "no_show"]);
const STATUS_FILTER_OPTIONS = [
    { id: "all", label: "Todos los estados" },
    { id: "reserved", label: "Apartados" },
    { id: "scheduled", label: "Agendadas" },
    { id: "waiting", label: "En sala" },
    { id: "in_progress", label: "En consulta" },
    { id: "completed", label: "Completadas" },
    { id: "no_show", label: "No asistió" },
] as const;

function normalizeAppointments(data: any[]) {
    const now = new Date();
    return data.map((apt) => {
        if (apt.status === "scheduled" && new Date(apt.endTime) < now) {
            return { ...apt, status: "completed" };
        }
        return apt;
    });
}

function appointmentMatchesSpecialist(appointment: any, specialist: Awaited<ReturnType<typeof getSpecialists>>[number]) {
    const appointmentSpecialistName = appointment.specialistName || appointment.specialist?.displayName || appointment.specialist?.name;
    return appointment.specialistId === specialist.id ||
        appointment.specialist?.id === specialist.id ||
        appointmentSpecialistName === specialist.displayName ||
        appointmentSpecialistName === specialist.name;
}

function parseCalendarDate(value: string | null) {
    const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

type CalendarAppointment = Awaited<ReturnType<typeof getAppointments>>[number];

function appointmentToSelectedEvent(appointment: CalendarAppointment) {
    return {
        id: appointment.id,
        title: appointment.title,
        start: new Date(appointment.startTime),
        end: new Date(appointment.endTime),
        notes: appointment.notes,
        resource: {
            contact: appointment.contact,
            patient: appointment.patient,
            specialist: appointment.specialist,
            specialistId: appointment.specialistId,
            serviceId: appointment.serviceId,
            appointmentType: appointment.appointmentType,
            source: appointment.source,
            isFirstVisit: appointment.isFirstVisit,
            isOverbook: appointment.isOverbook,
            confirmationStatus: appointment.confirmationStatus,
            googleCalendarId: appointment.googleCalendarId,
            googleCalendarName: appointment.googleCalendarName,
            googleCalendarColor: appointment.googleCalendarColor,
            specialistName: appointment.specialistName,
            visitMode: appointment.visitMode,
            meetStatus: appointment.meetStatus,
            meetLink: appointment.meetLink,
            paymentStatus: appointment.paymentStatus,
            paymentAmount: appointment.paymentAmount,
            paymentCurrency: appointment.paymentCurrency,
            paymentLinkUrl: appointment.paymentLinkUrl,
            remindersOptOut: appointment.remindersOptOut,
        },
    };
}

export default function CalendarPage() {
    const searchParams = useSearchParams();
    const initialCalendarDate = useMemo(() => parseCalendarDate(searchParams.get("date")), [searchParams]);
    const requestedAppointmentId = searchParams.get("appointmentId") || "";
    const requestedNewAppointment = searchParams.get("new") === "1";
    const requestedPatientId = searchParams.get("patientId") || "";
    const requestedSpecialistId = searchParams.get("specialistId") || "";
    const openedAppointmentRef = useRef("");
    const openedNewAppointmentRef = useRef(false);
    const { data: session, status: sessionStatus } = useSession();
    const sessionUser = session?.user as { id?: string; role?: string | null } | undefined;
    const currentUserId = sessionUser?.id || null;
    const currentRole = sessionStatus === "loading" ? null : normalizeRole(sessionUser?.role);
    const canChooseSpecialistView = currentRole === "ADMINISTRADOR";
    const isProfessional = currentRole === "PROFESIONAL";
    const [appointments, setAppointments] = useState<any[]>([]);
    const [specialists, setSpecialists] = useState<Awaited<ReturnType<typeof getSpecialists>>>([]);
    const [activeSpecialistFilter, setActiveSpecialistFilter] = useState("all");
    const [activeStatusFilter, setActiveStatusFilter] = useState("all");
    const [activeView, setActiveView] = useState<"list" | "calendar">("calendar");
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
    const [businessHours, setBusinessHours] = useState(() => normalizeBusinessHours());

    const applyAppointmentsState = useCallback((data: any[]) => {
        setAppointments(normalizeAppointments(data));
    }, []);

    const fetchAppointments = useCallback(async () => {
        const [data, settings, specialistsData] = await Promise.all([
            getAppointments(),
            getSystemSettings(),
            getSpecialists(),
        ]);

        applyAppointmentsState(data);
        setBusinessHours(normalizeBusinessHours(settings));
        setSpecialists(specialistsData);
    }, [applyAppointmentsState]);

    useEffect(() => {
        void fetchAppointments();
    }, [fetchAppointments]);

    const currentUserSpecialist = useMemo(
        () => specialists.find((specialist) => specialist.user?.id === currentUserId) || null,
        [currentUserId, specialists],
    );

    const specialistFilterOptions = useMemo<CalendarFilterOption[]>(() => {
        const options: CalendarFilterOption[] = [
            {
                id: "all",
                label: "Todos los profesionales",
            },
        ];

        for (const specialist of specialists) {
            const label = specialist.displayName || specialist.name;
            options.push({
                id: specialist.id,
                label,
            });
        }

        return options;
    }, [specialists]);

    useEffect(() => {
        if (isProfessional) {
            setActiveSpecialistFilter(currentUserSpecialist?.id || NO_SPECIALIST_FILTER);
            return;
        }

        if (!canChooseSpecialistView) {
            setActiveSpecialistFilter("all");
            return;
        }

        if (activeSpecialistFilter === "all") return;
        if (!specialistFilterOptions.some((option) => option.id === activeSpecialistFilter)) {
            setActiveSpecialistFilter("all");
        }
    }, [activeSpecialistFilter, canChooseSpecialistView, currentUserSpecialist?.id, isProfessional, specialistFilterOptions]);

    const specialistFilteredAppointments = useMemo(() => {
        if (!currentRole) {
            return [];
        }

        if (isProfessional) {
            if (!currentUserSpecialist) return [];
            return appointments.filter((appointment) => appointmentMatchesSpecialist(appointment, currentUserSpecialist));
        }

        if (activeSpecialistFilter === NO_SPECIALIST_FILTER) {
            return [];
        }

        if (activeSpecialistFilter === "all") {
            return appointments;
        }

        const selectedSpecialist = specialists.find((specialist) => specialist.id === activeSpecialistFilter);
        if (!selectedSpecialist) return appointments;

        return appointments.filter((appointment) => appointmentMatchesSpecialist(appointment, selectedSpecialist));
    }, [activeSpecialistFilter, appointments, currentRole, currentUserSpecialist, isProfessional, specialists]);

    const filteredAppointments = useMemo(() => {
        if (activeStatusFilter === "all") return specialistFilteredAppointments;
        if (activeStatusFilter === "reserved") {
            return specialistFilteredAppointments.filter(
                (appointment) => appointment.status === "scheduled" && appointment.confirmationStatus === "pending",
            );
        }
        if (activeStatusFilter === "scheduled") {
            return specialistFilteredAppointments.filter(
                (appointment) => appointment.status === "scheduled" && appointment.confirmationStatus === "confirmed",
            );
        }
        return specialistFilteredAppointments.filter((appointment) => appointment.status === activeStatusFilter);
    }, [activeStatusFilter, specialistFilteredAppointments]);

    const visibleListAppointments = useMemo(() => {
        const todayKey = getOperationDateKey(new Date(), businessHours.timeZone);
        return filteredAppointments
            .filter((appointment) => {
                const appointmentKey = getOperationDateKey(appointment.startTime, businessHours.timeZone);
                return appointmentKey === todayKey || (
                    appointmentKey > todayKey && !FINISHED_APPOINTMENT_STATUSES.has(appointment.status)
                );
            })
            .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
    }, [businessHours.timeZone, filteredAppointments]);

    const handleEdit = (appointment: any) => {
        setSelectedEvent(appointmentToSelectedEvent(appointment));
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    useEffect(() => {
        if (!requestedAppointmentId || openedAppointmentRef.current === requestedAppointmentId) return;
        const appointment = appointments.find((entry) => entry.id === requestedAppointmentId);
        if (!appointment) return;

        openedAppointmentRef.current = requestedAppointmentId;
        const timer = window.setTimeout(() => {
            setSelectedEvent(appointmentToSelectedEvent(appointment));
            setSelectedSlot(null);
            setIsDialogOpen(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [appointments, requestedAppointmentId]);

    useEffect(() => {
        if (!requestedNewAppointment || openedNewAppointmentRef.current) return;
        openedNewAppointmentRef.current = true;
        const timer = window.setTimeout(() => {
            setSelectedEvent(null);
            setSelectedSlot(null);
            setIsDialogOpen(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [requestedNewAppointment]);

    const handleSelectSlot = (slot: { start: Date; end: Date }) => {
        setSelectedSlot(slot);
        setSelectedEvent(null);
        setIsDialogOpen(true);
    };

    const handleSelectEvent = (event: any) => {
        setSelectedEvent(event);
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Eliminar cita?")) return;
        await deleteAppointment(id);
        toast({ title: "Cita eliminada" });
        void fetchAppointments();
    };

    const handleNew = () => {
        setSelectedEvent(null);
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    const handleAppointmentTimeChange = useCallback((appointmentId: string, start: Date, end: Date) => {
        setAppointments((prev) =>
            normalizeAppointments(
                prev.map((apt) =>
                    apt.id === appointmentId
                        ? {
                              ...apt,
                              startTime: start,
                              endTime: end,
                          }
                        : apt,
                ),
            ),
        );
    }, []);

    const events = useMemo(
        () =>
            filteredAppointments.map((apt) => ({
                id: apt.id,
                title: apt.title,
                start: new Date(apt.startTime),
                end: new Date(apt.endTime),
                notes: apt.notes || "",
                resource: {
                    contact: apt.contact,
                    patient: apt.patient,
                    specialist: apt.specialist,
                    specialistId: apt.specialistId,
                    user: apt.user,
                    status: apt.status,
                    appointmentType: apt.appointmentType,
                    source: apt.source,
                    isFirstVisit: apt.isFirstVisit,
                    isOverbook: apt.isOverbook,
                    confirmationStatus: apt.confirmationStatus,
                    googleCalendarId: apt.googleCalendarId,
                    googleCalendarName: apt.googleCalendarName,
                    googleCalendarColor: apt.googleCalendarColor,
                    specialistName: apt.specialistName,
                    visitMode: apt.visitMode,
                    meetStatus: apt.meetStatus,
                    meetLink: apt.meetLink,
                    paymentStatus: apt.paymentStatus,
                    paymentAmount: apt.paymentAmount,
                    paymentCurrency: apt.paymentCurrency,
                    paymentLinkUrl: apt.paymentLinkUrl,
                    remindersOptOut: apt.remindersOptOut,
                },
            })),
        [filteredAppointments],
    );

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex shrink-0 items-start justify-between gap-4 pb-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Agenda</h1>
                    <p className="text-sm text-muted-foreground">Calendario de citas — selecciona un horario para agendar.</p>
                </div>
                <Button onClick={handleNew} size="sm" className="shrink-0 shadow-sm">
                    <Plus className="mr-2 h-4 w-4" /> Nueva cita
                </Button>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-y border-border/80 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex w-fit rounded-xl border bg-card p-1 shadow-sm">
                    <Button
                        type="button"
                        variant={activeView === "list" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setActiveView("list")}
                        className="h-8 rounded-lg px-3"
                    >
                        <LayoutList className="mr-2 h-4 w-4" /> Lista
                    </Button>
                    <Button
                        type="button"
                        variant={activeView === "calendar" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setActiveView("calendar")}
                        className="h-8 rounded-lg px-3"
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" /> Calendario
                    </Button>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Filter className="hidden h-4 w-4 sm:block" />
                    <Select
                        value={activeSpecialistFilter}
                        onValueChange={setActiveSpecialistFilter}
                        disabled={!canChooseSpecialistView}
                    >
                        <SelectTrigger aria-label="Filtrar por profesional" className="h-9 w-full bg-card sm:w-[220px]">
                            <SelectValue placeholder="Todos los profesionales" />
                        </SelectTrigger>
                        <SelectContent>
                            {specialistFilterOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={activeStatusFilter} onValueChange={setActiveStatusFilter}>
                        <SelectTrigger aria-label="Filtrar por estado" className="h-9 w-full bg-card sm:w-[190px]">
                            <SelectValue placeholder="Todos los estados" />
                        </SelectTrigger>
                        <SelectContent>
                            {STATUS_FILTER_OPTIONS.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {activeView === "list" ? (
                <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border bg-card shadow-sm">
                    <AppointmentList
                        appointments={visibleListAppointments}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                </div>
            ) : (
                <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card p-2 shadow-sm sm:p-3">
                    <BigCalendar
                        initialEvents={events}
                        initialDate={initialCalendarDate}
                        onSelectSlot={handleSelectSlot}
                        onSelectEvent={handleSelectEvent}
                        onAppointmentTimeChange={handleAppointmentTimeChange}
                        onMutationSettled={fetchAppointments}
                        businessHours={businessHours}
                    />
                </div>
            )}

            <AppointmentDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                selectedEvent={selectedEvent}
                selectedSlot={selectedSlot}
                defaultPatientId={requestedPatientId || null}
                defaultSpecialistId={
                    isProfessional
                        ? currentUserSpecialist?.id || null
                        : requestedSpecialistId || (
                            activeSpecialistFilter === "all" || activeSpecialistFilter === NO_SPECIALIST_FILTER
                                ? null
                                : activeSpecialistFilter
                        )
                }
                onSuccess={fetchAppointments}
                businessHours={businessHours}
            />
        </div>
    );
}
