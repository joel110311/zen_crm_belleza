"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { deleteAppointment, getAppointments } from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { getSpecialists } from "@/app/actions/specialists";
import { AppointmentList } from "@/components/calendar/appointment-list";
import type { SelectedAppointmentEvent } from "@/components/calendar/appointment-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import styles from "@/components/calendar/calendar.module.css";
import { appointmentsOnDay, validCalendarDateKey } from "@/lib/calendar/draft";
import {
  normalizeBusinessHours,
  shiftDateKey,
} from "@/lib/calendar/business-hours";
import {
  getLocalCalendarDateKey,
  dateKeyToLocalNoonDate,
  formatOperationDayLabel,
  getOperationTodayKey,
} from "@/lib/operation-dates";
import { normalizeRole } from "@/lib/permissions";
import { calendarQueryWindow } from "@/lib/calendar/query-window";
import { useDesktopWorkspace } from "@/components/shared/use-desktop-workspace";

const BigCalendar = dynamic(() => import("@/components/calendar/big-calendar").then((module) => module.BigCalendar));
const AppointmentDialog = dynamic(() => import("@/components/calendar/appointment-dialog").then((module) => module.AppointmentDialog));

type CalendarFilterOption = {
  id: string;
  label: string;
};

const NO_SPECIALIST_FILTER = "__none__";
const STATUS_FILTER_OPTIONS = [
  { id: "all", label: "Todos los estados" },
  { id: "reserved", label: "Apartados" },
  { id: "scheduled", label: "Agendadas" },
  { id: "waiting", label: "En sala" },
  { id: "in_progress", label: "En consulta" },
  { id: "completed", label: "Completadas" },
  { id: "no_show", label: "No asistió" },
] as const;

type CalendarAppointment = Awaited<ReturnType<typeof getAppointments>>[number];

function appointmentMatchesSpecialist(
  appointment: CalendarAppointment,
  specialist: Awaited<ReturnType<typeof getSpecialists>>[number],
) {
  const appointmentSpecialistName =
    appointment.specialistName ||
    appointment.specialist?.displayName ||
    appointment.specialist?.name;
  return (
    appointment.specialistId === specialist.id ||
    appointment.specialist?.id === specialist.id ||
    appointmentSpecialistName === specialist.displayName ||
    appointmentSpecialistName === specialist.name
  );
}

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
      remindersOptOut: appointment.remindersOptOut,
    },
  };
}

type CalendarSelectedEvent = SelectedAppointmentEvent;

export default function CalendarPage() {
  const searchParams = useSearchParams();
  const { readOnly } = useWorkspaceAccess();
  const desktop = useDesktopWorkspace();
  const loadVersion = useRef(0);
  const [chosenDay, setChosenDay] = useState<string | null>(() =>
    validCalendarDateKey(searchParams.get("date")),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const requestedAppointmentId = searchParams.get("appointmentId") || "";
  const requestedNewAppointment = searchParams.get("new") === "1";
  const requestedPatientId = searchParams.get("patientId") || "";
  const requestedSpecialistId = searchParams.get("specialistId") || "";
  const openedAppointmentRef = useRef("");
  const openedNewAppointmentRef = useRef(false);
  const { data: session, status: sessionStatus } = useSession();
  const sessionUser = session?.user as
    | { id?: string; role?: string | null }
    | undefined;
  const currentUserId = sessionUser?.id || null;
  const currentRole =
    sessionStatus === "loading" ? null : normalizeRole(sessionUser?.role);
  const canChooseSpecialistView = currentRole === "ADMINISTRADOR";
  const isProfessional = currentRole === "PROFESIONAL";
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [specialists, setSpecialists] = useState<
    Awaited<ReturnType<typeof getSpecialists>>
  >([]);
  const [activeSpecialistFilter, setActiveSpecialistFilter] = useState("all");
  const [activeStatusFilter, setActiveStatusFilter] = useState("all");
  const [activeView, setActiveView] = useState<"auto" | "list" | "calendar">(
    "auto",
  );
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("week");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] =
    useState<CalendarSelectedEvent | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [businessHours, setBusinessHours] = useState(() =>
    normalizeBusinessHours(),
  );
  const selectedDay = chosenDay || getOperationTodayKey(businessHours.timeZone);
  const queryWindow = useMemo(() => calendarQueryWindow(selectedDay), [selectedDay]);
  const showCalendar = activeView === "calendar" || (activeView === "auto" && desktop);

  const applyAppointmentsState = useCallback((data: CalendarAppointment[]) => {
    setAppointments(data);
  }, []);

  const fetchAppointments = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const [data, settings, specialistsData] = await Promise.all([
        getAppointments({ throwOnError: true, rangeStart: queryWindow.start, rangeEnd: queryWindow.end, appointmentId: requestedAppointmentId || undefined }),
        getSystemSettings(),
        getSpecialists(),
      ]);
      if (version !== loadVersion.current) return;
      applyAppointmentsState(data);
      setBusinessHours(normalizeBusinessHours(settings));
      setSpecialists(specialistsData);
    } catch {
      if (version !== loadVersion.current) return;
      setLoadError(
        "No pudimos cargar la agenda. Tus citas no se han modificado.",
      );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [applyAppointmentsState, queryWindow.start, queryWindow.end, requestedAppointmentId]);
  const selectedDate = useMemo(
    () => dateKeyToLocalNoonDate(selectedDay),
    [selectedDay],
  );
  const weekDays = useMemo(() => {
    const weekday = dateKeyToLocalNoonDate(selectedDay).getDay();
    const monday = shiftDateKey(selectedDay, -((weekday + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => shiftDateKey(monday, index));
  }, [selectedDay]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAppointments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAppointments]);

  const currentUserSpecialist = useMemo(
    () =>
      specialists.find(
        (specialist) =>
          specialist.user?.id === currentUserId ||
          specialist.user?.controlUserId === currentUserId,
      ) || null,
    [currentUserId, specialists],
  );

  const canSchedule =
    !readOnly &&
    Boolean(currentRole) &&
    (!isProfessional || Boolean(currentUserSpecialist));

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

  const requiredSpecialistFilter = useMemo(() => {
    if (isProfessional)
      return currentUserSpecialist?.id || NO_SPECIALIST_FILTER;
    if (!canChooseSpecialistView) return "all";
    if (
      activeSpecialistFilter !== "all" &&
      !specialistFilterOptions.some(
        (option) => option.id === activeSpecialistFilter,
      )
    )
      return "all";
    return null;
  }, [
    activeSpecialistFilter,
    canChooseSpecialistView,
    currentUserSpecialist?.id,
    isProfessional,
    specialistFilterOptions,
  ]);

  useEffect(() => {
    if (
      !requiredSpecialistFilter ||
      requiredSpecialistFilter === activeSpecialistFilter
    )
      return;
    const timer = window.setTimeout(
      () => setActiveSpecialistFilter(requiredSpecialistFilter),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [activeSpecialistFilter, requiredSpecialistFilter]);

  const specialistFilteredAppointments = useMemo(() => {
    if (!currentRole) {
      return [];
    }

    if (isProfessional) {
      if (!currentUserSpecialist) return [];
      return appointments.filter((appointment) =>
        appointmentMatchesSpecialist(appointment, currentUserSpecialist),
      );
    }

    if (activeSpecialistFilter === NO_SPECIALIST_FILTER) {
      return [];
    }

    if (activeSpecialistFilter === "all") {
      return appointments;
    }

    const selectedSpecialist = specialists.find(
      (specialist) => specialist.id === activeSpecialistFilter,
    );
    if (!selectedSpecialist) return appointments;

    return appointments.filter((appointment) =>
      appointmentMatchesSpecialist(appointment, selectedSpecialist),
    );
  }, [
    activeSpecialistFilter,
    appointments,
    currentRole,
    currentUserSpecialist,
    isProfessional,
    specialists,
  ]);

  const filteredAppointments = useMemo(() => {
    if (activeStatusFilter === "all") return specialistFilteredAppointments;
    if (activeStatusFilter === "reserved") {
      return specialistFilteredAppointments.filter(
        (appointment) =>
          appointment.status === "scheduled" &&
          appointment.confirmationStatus === "pending",
      );
    }
    if (activeStatusFilter === "scheduled") {
      return specialistFilteredAppointments.filter(
        (appointment) =>
          appointment.status === "scheduled" &&
          appointment.confirmationStatus === "confirmed",
      );
    }
    return specialistFilteredAppointments.filter(
      (appointment) => appointment.status === activeStatusFilter,
    );
  }, [activeStatusFilter, specialistFilteredAppointments]);

  const visibleListAppointments = useMemo(
    () =>
      appointmentsOnDay(
        filteredAppointments,
        selectedDay,
        businessHours.timeZone,
      ),
    [filteredAppointments, selectedDay, businessHours.timeZone],
  );

  const handleEdit = (appointment: CalendarAppointment) => {
    setSelectedEvent(appointmentToSelectedEvent(appointment));
    setSelectedSlot(null);
    setIsDialogOpen(true);
  };

  useEffect(() => {
    if (
      !requestedAppointmentId ||
      openedAppointmentRef.current === requestedAppointmentId
    )
      return;
    const appointment = specialistFilteredAppointments.find(
      (entry) => entry.id === requestedAppointmentId,
    );
    if (!appointment) return;

    const timer = window.setTimeout(() => {
      openedAppointmentRef.current = requestedAppointmentId;
      setSelectedEvent(appointmentToSelectedEvent(appointment));
      setSelectedSlot(null);
      setIsDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [specialistFilteredAppointments, requestedAppointmentId]);

  useEffect(() => {
    if (
      !canSchedule ||
      loading ||
      !requestedNewAppointment ||
      openedNewAppointmentRef.current
    )
      return;
    const timer = window.setTimeout(() => {
      openedNewAppointmentRef.current = true;
      setSelectedEvent(null);
      setSelectedSlot(null);
      setIsDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canSchedule, loading, requestedNewAppointment]);

  const handleSelectSlot = (slot: { start: Date; end: Date }) => {
    if (!canSchedule) return;
    setSelectedSlot(slot);
    setSelectedEvent(null);
    setIsDialogOpen(true);
  };

  const handleSelectEvent = (event: CalendarSelectedEvent) => {
    setSelectedEvent(event);
    setSelectedSlot(null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (readOnly) return;
    if (!confirm("¿Eliminar cita?")) return;
    const result = await deleteAppointment(id);
    if (!result.success) {
      toast({
        title: "No se pudo eliminar la cita",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Cita eliminada" });
    await fetchAppointments();
  };

  const handleNew = () => {
    if (!canSchedule) return;
    setSelectedEvent(null);
    setSelectedSlot({
      start: selectedDate,
      end: new Date(selectedDate.getTime() + 30 * 60000),
    });
    setIsDialogOpen(true);
  };

  const handleAppointmentTimeChange = useCallback(
    (appointmentId: string, start: Date, end: Date) => {
      setAppointments((previous) =>
        previous.map((appointment) =>
          appointment.id === appointmentId
            ? { ...appointment, startTime: start, endTime: end }
            : appointment,
        ),
      );
    },
    [],
  );

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
          remindersOptOut: apt.remindersOptOut,
        },
      })),
    [filteredAppointments],
  );

  return (
    <div className={styles.agenda} data-view={activeView}>
      <header className={styles.heading}>
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organiza tu día, cita por cita.
          </p>
        </div>
        {!readOnly && (
          <Button
            onClick={handleNew}
            disabled={!canSchedule || loading || Boolean(loadError)}
            className="min-h-11 rounded-xl"
          >
            <Plus className="size-4" aria-hidden="true" />
            Nueva cita
          </Button>
        )}
      </header>
      <div className={styles.controls}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="Día anterior"
            onClick={() => setChosenDay(shiftDateKey(selectedDay, -1))}
          >
            <ChevronLeft />
          </Button>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Elegir fecha de agenda</span>
            <input
              type="date"
              value={selectedDay}
              onChange={(event) => {
                const value = validCalendarDateKey(event.target.value);
                if (value) setChosenDay(value);
              }}
              className="h-11 min-w-0 w-full rounded-xl border border-border bg-card px-3 text-base"
            />
          </label>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="Día siguiente"
            onClick={() => setChosenDay(shiftDateKey(selectedDay, 1))}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() =>
              setChosenDay(getOperationTodayKey(businessHours.timeZone))
            }
          >
            Hoy
          </Button>
        </div>
        <div className={styles.filters}>
          <label className="min-w-0 text-xs text-muted-foreground">
            <span className="mb-1 block">Profesional</span>
            <Select
              value={requiredSpecialistFilter || activeSpecialistFilter}
              onValueChange={setActiveSpecialistFilter}
              disabled={!canChooseSpecialistView}
            >
              <SelectTrigger
                aria-label="Filtrar por profesional"
                className="h-11 w-full min-w-0 bg-card"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {specialistFilterOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="min-w-0 text-xs text-muted-foreground">
            <span className="mb-1 block">Estado</span>
            <Select
              value={activeStatusFilter}
              onValueChange={setActiveStatusFilter}
            >
              <SelectTrigger
                aria-label="Filtrar por estado"
                className="h-11 w-full min-w-0 bg-card"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>
      <div className={styles.viewBar}>
        <p className="min-w-0 text-sm capitalize text-muted-foreground">
          {formatOperationDayLabel(
            selectedDay,
            "es-MX",
            businessHours.timeZone,
            { weekday: "long", day: "numeric", month: "long", year: undefined },
          )}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Actualizar agenda"
            onClick={() => void fetchAppointments()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
          <Button
            variant={activeView === "list" ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => setActiveView("list")}
            aria-label="Vista de lista"
            aria-pressed={activeView === "list"}
          >
            <LayoutList />
            <span className="hidden sm:inline">Lista</span>
          </Button>
          <Button
            variant={activeView === "calendar" ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => setActiveView("calendar")}
            aria-label="Vista de calendario"
            aria-pressed={activeView === "calendar"}
          >
            <CalendarIcon />
            <span className="hidden sm:inline">Calendario</span>
          </Button>
        </div>
      </div>
      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/25 bg-card p-5 text-sm"
        >
          <p>{loadError}</p>
          <Button
            className="mt-3 min-h-11"
            variant="outline"
            onClick={() => void fetchAppointments()}
          >
            Reintentar
          </Button>
        </div>
      ) : loading ? (
        <div
          role="status"
          className="p-8 text-center text-sm text-muted-foreground"
        >
          Cargando agenda…
        </div>
      ) : (
        <>
          <section className={styles.dayList} aria-label="Citas del día">
            <div className={styles.dayStrip}>
              {weekDays.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChosenDay(key)}
                  aria-pressed={key === selectedDay}
                  className="min-h-16 min-w-0 rounded-xl px-1 py-2 text-xs text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  <span className="block capitalize">
                    {formatOperationDayLabel(
                      key,
                      "es-MX",
                      businessHours.timeZone,
                      {
                        weekday: "short",
                        day: undefined,
                        month: undefined,
                        year: undefined,
                      },
                    )}
                  </span>
                  <span className="mt-1 block text-base font-semibold">
                    {Number(key.slice(-2))}
                  </span>
                </button>
              ))}
            </div>
            <AppointmentList
              appointments={visibleListAppointments}
              onEdit={handleEdit}
              onDelete={handleDelete}
              readOnly={readOnly}
            />
          </section>
          <div className={styles.calendarCanvas}>
            {showCalendar && <BigCalendar
              initialEvents={events}
              initialDate={selectedDate}
              initialView={calendarView}
              onViewChange={setCalendarView}
              onDateChange={(date) =>
                setChosenDay(getLocalCalendarDateKey(date))
              }
              readOnly={!canSchedule}
              onSelectSlot={handleSelectSlot}
              onSelectEvent={handleSelectEvent}
              onAppointmentTimeChange={handleAppointmentTimeChange}
              onMutationSettled={fetchAppointments}
              businessHours={businessHours}
            />}
          </div>
        </>
      )}
      {isDialogOpen && <AppointmentDialog
        readOnly={readOnly}
        lockedSpecialistId={
          isProfessional ? currentUserSpecialist?.id || null : null
        }
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedEvent={selectedEvent}
        selectedSlot={selectedSlot}
        defaultPatientId={requestedPatientId || null}
        defaultSpecialistId={
          isProfessional
            ? currentUserSpecialist?.id || null
            : requestedSpecialistId ||
              (activeSpecialistFilter === "all" ||
              activeSpecialistFilter === NO_SPECIALIST_FILTER
                ? null
                : activeSpecialistFilter)
        }
        onSuccess={fetchAppointments}
        businessHours={businessHours}
      />}
    </div>
  );
}
