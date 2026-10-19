"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  TriangleAlert,
  UserCheck,
  Video,
  XCircle,
} from "lucide-react";
import {
  getReceptionAppointments,
  getAppointmentRemindersByDate,
  prepareAppointmentReminderDraft,
  retryAppointmentReminderSend,
  updateAppointmentStatus,
} from "@/app/actions/calendar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { AppointmentRequestActions } from "@/components/portal/appointment-request-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { hasPermission, type AccessSubject } from "@/lib/permissions";
import { matchesWorkspaceSearch } from "@/lib/workspace-search";
import { shiftDateKey } from "@/lib/calendar/business-hours";
import {
  tenantDashboardPath,
  tenantSlugFromPath,
} from "@/lib/tenant-request-routing";
import {
  INBOX_DRAFT_STORAGE_KEY,
  type InboxDraftPayload,
} from "@/lib/inbox-drafts";
import {
  formatOperationDayLabel,
  formatTimeInOperationZone,
  getOperationDateKey,
  getOperationTodayKey,
} from "@/lib/operation-dates";
import layout from "@/components/shared/management-workspace.module.css";
import styles from "./reception.module.css";

type ReceptionAppointment = Awaited<
  ReturnType<typeof getReceptionAppointments>
>[number];
type AppointmentReminderRow = Awaited<
  ReturnType<typeof getAppointmentRemindersByDate>
>[number];
type ReminderFilter = "all" | "pending" | "sent" | "issues";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendada",
  waiting: "En espera",
  called: "Llamado",
  in_progress: "En atención",
  completed: "Completada",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

function patientName(appointment: ReceptionAppointment) {
  return appointment.patient
    ? [appointment.patient.firstName, appointment.patient.lastName]
        .filter(Boolean)
        .join(" ")
    : [appointment.contact?.name, appointment.contact?.lastName]
        .filter(Boolean)
        .join(" ") || appointment.title;
}

function statusTone(status: string) {
  if (status === "completed")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "in_progress")
    return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "waiting" || status === "called")
    return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "cancelled" || status === "no_show")
    return "bg-red-50 text-red-700 border-red-200";
  return "border-primary/20 bg-primary/5 text-primary";
}

function reminderTone(status: string) {
  if (status === "sent")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (status === "queued" || status === "sending")
    return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "skipped" || status === "cancelled")
    return "border-destructive/20 bg-destructive/5 text-destructive";
  return "border-primary/20 bg-primary/5 text-primary";
}

function reminderStatusLabel(status: string) {
  if (status === "sent") return "enviado";
  if (status === "failed") return "fallo";
  if (status === "sending") return "enviando";
  if (status === "queued") return "programado";
  if (status === "skipped") return "omitido";
  if (status === "cancelled") return "cancelado";
  return status;
}

function reminderClientName(reminder: AppointmentReminderRow) {
  const patient = reminder.appointment.patient;
  if (patient) {
    return (
      [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim() ||
      "Cliente"
    );
  }
  const contact = reminder.appointment.contact;
  return (
    [contact?.name, contact?.lastName].filter(Boolean).join(" ").trim() ||
    "Cliente"
  );
}

function reminderClientPhone(reminder: AppointmentReminderRow) {
  return (
    reminder.appointment.patient?.phone ||
    reminder.appointment.contact?.phone ||
    "Sin teléfono"
  );
}

type ReceptionFilter =
  | "all"
  | "scheduled"
  | "waiting"
  | "in_progress"
  | "completed"
  | "no_show";
const FILTERS: Array<{ value: ReceptionFilter; label: string }> = [
  { value: "all", label: "Todas las citas" },
  { value: "scheduled", label: "Agendadas" },
  { value: "waiting", label: "En espera" },
  { value: "in_progress", label: "En atención" },
  { value: "completed", label: "Completadas" },
  { value: "no_show", label: "Ausentes" },
];
const STATUS_ACTIONS = [
  {
    value: "confirmed",
    label: "Confirmar",
    success: "Cita confirmada",
    icon: CheckCircle2,
  },
  {
    value: "waiting",
    label: "En espera",
    success: "Cliente en espera",
    icon: UserCheck,
  },
  {
    value: "in_progress",
    label: "Iniciar",
    success: "Atención iniciada",
    icon: ClipboardCheck,
  },
  {
    value: "completed",
    label: "Finalizar",
    success: "Cita finalizada",
    icon: CheckCircle2,
  },
  {
    value: "no_show",
    label: "Ausente",
    success: "Marcada como ausente",
    icon: XCircle,
  },
];

export default function ReceptionPage() {
  const { toast } = useToast();
  const { readOnly } = useWorkspaceAccess();
  const { data: session, status: sessionStatus } = useSession();
  const canWrite =
    !readOnly &&
    sessionStatus === "authenticated" &&
    hasPermission(session?.user as AccessSubject, "reception.manage");
  const router = useRouter();
  const pathname = usePathname();
  const tenantSlug = tenantSlugFromPath(pathname);
  const workspaceHref = (path: string) =>
    tenantSlug ? tenantDashboardPath(tenantSlug, path) : path;
  const searchParams = useSearchParams();
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(
    searchParams.get("date") || "",
  )
    ? searchParams.get("date") || ""
    : "";
  const requestedFinishId = searchParams.get("finish") || "";
  const requestedRequestId = searchParams.get("request") || "";
  const [isPending, startTransition] = useTransition();
  const selectedDateTouchedRef = useRef(Boolean(requestedDate));
  const finishHandledRef = useRef("");
  const requestRef = useRef(0);
  const reminderRequestRef = useRef(0);
  const [appointments, setAppointments] = useState<ReceptionAppointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(
    requestedDate || getOperationTodayKey(),
  );
  const [loading, setLoading] = useState(true);
  const [loadedDate, setLoadedDate] = useState("");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReceptionFilter>("all");
  const [specialistFilter, setSpecialistFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [operationContext, setOperationContext] = useState({
    locale: "es-MX",
    timeZone: "America/Mexico_City",
  });
  const [closingAppointment, setClosingAppointment] =
    useState<ReceptionAppointment | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [reminderDate, setReminderDate] = useState(getOperationTodayKey());
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>("all");
  const [reminders, setReminders] = useState<AppointmentReminderRow[]>([]);
  const [isLoadingReminders, setIsLoadingReminders] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const [loadedReminderDate, setLoadedReminderDate] = useState("");
  const dateLoading = loading || loadedDate !== selectedDate;
  const remindersLoading =
    isLoadingReminders || loadedReminderDate !== reminderDate;

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await getReceptionAppointments(selectedDate);
      if (request !== requestRef.current) return;
      setAppointments(data);
      setLoadedDate(selectedDate);
    } catch {
      if (request !== requestRef.current) return;
      setAppointments([]);
      setLoadedDate(selectedDate);
      setLoadError("No se pudo cargar la agenda. Intenta de nuevo.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [selectedDate]);
  const loadReminders = useCallback(async () => {
    const request = ++reminderRequestRef.current;
    setIsLoadingReminders(true);
    setReminderError("");
    try {
      const rows = await getAppointmentRemindersByDate(reminderDate);
      if (request !== reminderRequestRef.current) return;
      setReminders(rows);
      setLoadedReminderDate(reminderDate);
    } catch {
      if (request !== reminderRequestRef.current) return;
      setReminders([]);
      setLoadedReminderDate(reminderDate);
      setReminderError(
        "No se pudieron cargar los recordatorios. Intenta de nuevo.",
      );
    } finally {
      if (request === reminderRequestRef.current) setIsLoadingReminders(false);
    }
  }, [reminderDate]);
  useEffect(() => {
    const requestState = requestRef;
    void load();
    return () => {
      requestState.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!remindersOpen) return;
    const requestState = reminderRequestRef;
    void loadReminders();
    return () => {
      requestState.current++;
    };
  }, [loadReminders, remindersOpen]);
  useEffect(() => {
    if (requestedDate) setSelectedDate(requestedDate);
  }, [requestedDate]);
  useEffect(() => {
    let active = true;
    fetch("/api/operation-context", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((context) => {
        if (!active || !context) return;
        const next = {
          locale: context.locale || "es-MX",
          timeZone: context.timeZone || "America/Mexico_City",
        };
        setOperationContext(next);
        if (!selectedDateTouchedRef.current)
          setSelectedDate(getOperationTodayKey(next.timeZone));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const chooseDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isPending) return;
    selectedDateTouchedRef.current = true;
    setSelectedDate(date);
    setClosingAppointment(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", date);
    params.delete("finish");
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  const dayAppointments = dateLoading ? [] : appointments;
  const counts = {
    scheduled: dayAppointments.filter((a) => a.status === "scheduled").length,
    waiting: dayAppointments.filter((a) =>
      ["waiting", "called"].includes(a.status),
    ).length,
    in_progress: dayAppointments.filter((a) => a.status === "in_progress")
      .length,
    completed: dayAppointments.filter((a) => a.status === "completed").length,
  };
  const specialists = Array.from(
    new Map(
      dayAppointments.map((a) => [
        a.specialistId || a.specialistName || "unassigned",
        a.specialist?.displayName ||
          a.specialist?.name ||
          a.specialistName ||
          "Sin especialista",
      ]),
    ).entries(),
  );
  const visibleAppointments = dayAppointments.filter(
    (a) =>
      (!requestedRequestId || selectedDate !== requestedDate || a.id === requestedRequestId) &&
      (statusFilter === "all" ||
        (statusFilter === "waiting"
          ? ["waiting", "called"].includes(a.status)
          : a.status === statusFilter)) &&
      (specialistFilter === "all" ||
        specialistFilter ===
          (a.specialistId || a.specialistName || "unassigned")) &&
      matchesWorkspaceSearch(
        query,
        patientName(a),
        a.title,
        a.specialist?.displayName,
        a.specialist?.name,
        a.specialistName,
        a.patient?.phone,
        a.contact?.phone,
      ),
  );
  const currentReminders = remindersLoading ? [] : reminders;
  const reminderStats = {
    pending: currentReminders.filter((r) =>
      ["queued", "sending"].includes(r.status),
    ).length,
    sent: currentReminders.filter((r) => r.status === "sent").length,
    issues: currentReminders.filter((r) =>
      ["failed", "skipped", "cancelled"].includes(r.status),
    ).length,
  };
  const visibleReminders = currentReminders.filter(
    (r) =>
      reminderFilter === "all" ||
      (reminderFilter === "pending"
        ? ["queued", "sending"].includes(r.status)
        : reminderFilter === "sent"
          ? r.status === "sent"
          : ["failed", "skipped", "cancelled"].includes(r.status)),
  );
  const runAction = (
    task: () => Promise<{ success: boolean; error?: string }>,
    successTitle: string,
    refreshReminders = false,
  ) => {
    if (
      !canWrite ||
      isPending ||
      (!refreshReminders && (dateLoading || loadError))
    )
      return;
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.success) {
          toast({
            title: "No se pudo completar",
            description: result.error,
            variant: "destructive",
          });
          return;
        }
        toast({ title: successTitle });
        await load();
        if (refreshReminders) await loadReminders();
      } catch {
        toast({
          title: "No se pudo completar",
          description: "Revisa tu conexión e intenta de nuevo.",
          variant: "destructive",
        });
      }
    });
  };
  const openFinishDialog = useCallback(
    (appointment: ReceptionAppointment) => {
      if (canWrite && !isPending) setClosingAppointment(appointment);
    },
    [canWrite, isPending],
  );
  useEffect(() => {
    if (
      !requestedFinishId ||
      dateLoading ||
      !canWrite ||
      finishHandledRef.current === requestedFinishId
    )
      return;
    const appointment = appointments.find((a) => a.id === requestedFinishId);
    if (!appointment) return;
    finishHandledRef.current = requestedFinishId;
    openFinishDialog(appointment);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("finish");
    params.set("date", selectedDate);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [
    appointments,
    canWrite,
    dateLoading,
    openFinishDialog,
    pathname,
    requestedFinishId,
    router,
    searchParams,
    selectedDate,
  ]);
  const finishAppointment = () => {
    if (!closingAppointment) return;
    runAction(async () => {
      const result = await updateAppointmentStatus(
        closingAppointment.id,
        "completed",
      );
      if (result.success) setClosingAppointment(null);
      return result;
    }, "Cita finalizada");
  };
  const prepareNotification = (appointment: ReceptionAppointment) => {
    if (!canWrite || isPending || dateLoading) return;
    startTransition(async () => {
      try {
        const result = await prepareAppointmentReminderDraft(appointment.id);
        if (!result.success) {
          toast({
            title: "No se pudo preparar la notificación",
            description: result.error,
            variant: "destructive",
          });
          return;
        }
        const draft: InboxDraftPayload = {
          conversationId: result.conversationId,
          content: result.content,
          mediaUrl: "",
          fileName: "",
          mimeType: "",
          mediaCategory: "document",
          createdAt: new Date().toISOString(),
          source: "manual",
        };
        window.sessionStorage.setItem(
          INBOX_DRAFT_STORAGE_KEY,
          JSON.stringify(draft),
        );
        router.push(
          `${workspaceHref("/dashboard/inbox")}?conversationId=${encodeURIComponent(result.conversationId)}&draft=appointment-reminder`,
        );
      } catch {
        toast({
          title: "No se pudo preparar la notificación",
          description: "Revisa tu conexión e intenta de nuevo.",
          variant: "destructive",
        });
      }
    });
  };
  const retryReminder = (id: string, label: string) =>
    runAction(
      () => retryAppointmentReminderSend(id),
      `Recordatorio ${label} reenviado`,
      true,
    );
  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setSpecialistFilter("all");
    if (requestedRequestId) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("request");
      router.replace(`${pathname}?${params}`, { scroll: false });
    }
  };

  return (
    <>
      <div
        className={`${layout.workspace} ${styles.workspace}`}
        data-reception-workspace
      >
        <header className={layout.heading}>
          <div>
            <h1>
              <ClipboardCheck className="size-6 shrink-0 text-primary" />
              Recepción
            </h1>
            <p>Llegadas, atención y seguimiento de las citas del día.</p>
          </div>
          <div className={styles.headerActions}>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={isPending || dateLoading}
            >
              <RefreshCw className="size-4" />
              Refrescar
            </Button>
            <Button
              onClick={() => {
                setReminderDate(selectedDate);
                setReminderFilter("all");
                setRemindersOpen(true);
              }}
            >
              <BellRing className="size-4" />
              Recordatorios
            </Button>
          </div>
        </header>
        {readOnly && (
          <p className={layout.readonly}>
            Solo lectura. Puedes consultar las citas y los recordatorios.
          </p>
        )}
        <div className={styles.dateBar} aria-label="Fecha de recepción">
          <div className={styles.dayControls}>
            <Button
              variant="outline"
              size="icon"
              aria-label="Día anterior"
              disabled={isPending}
              onClick={() => chooseDate(shiftDateKey(selectedDate, -1))}
            >
              <ChevronLeft />
            </Button>
            <Label htmlFor="reception-date" className="sr-only">
              Fecha de recepción
            </Label>
            <Input
              id="reception-date"
              type="date"
              value={selectedDate}
              disabled={isPending}
              onChange={(event) => chooseDate(event.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Día siguiente"
              disabled={isPending}
              onClick={() => chooseDate(shiftDateKey(selectedDate, 1))}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() =>
                chooseDate(getOperationTodayKey(operationContext.timeZone))
              }
            >
              Hoy
            </Button>
          </div>
          <p>
            {formatOperationDayLabel(
              selectedDate,
              operationContext.locale,
              operationContext.timeZone,
            )}
          </p>
        </div>
        <div className={styles.stats} aria-label="Resumen del día">
          {(
            [
              ["scheduled", "Agendadas"],
              ["waiting", "En espera"],
              ["in_progress", "En atención"],
              ["completed", "Completadas"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={statusFilter === value}
              onClick={() =>
                setStatusFilter((current) =>
                  current === value ? "all" : value,
                )
              }
            >
              <strong>{dateLoading || loadError ? "—" : counts[value]}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <section className={styles.agenda} aria-label="Agenda de recepción">
          <div className={styles.filters}>
            <div>
              <Label htmlFor="reception-search">Buscar cita</Label>
              <Input
                id="reception-search"
                placeholder="Cliente, servicio o teléfono…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              className={styles.toggleFilters}
              aria-expanded={showFilters}
              aria-controls="reception-filters"
              onClick={() => setShowFilters((value) => !value)}
            >
              Filtros
              {statusFilter !== "all" || specialistFilter !== "all"
                ? " · activos"
                : ""}
            </Button>
            <div
              id="reception-filters"
              className={styles.extraFilters}
              data-expanded={showFilters}
            >
              <div>
                <Label htmlFor="reception-status">Estado</Label>
                <select
                  id="reception-status"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as ReceptionFilter)
                  }
                >
                  {FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="reception-specialist">Especialista</Label>
                <select
                  id="reception-specialist"
                  value={specialistFilter}
                  onChange={(event) => setSpecialistFilter(event.target.value)}
                >
                  <option value="all">Todo el equipo</option>
                  {specialists.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(query ||
              statusFilter !== "all" ||
              specialistFilter !== "all") && (
              <Button variant="ghost" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
          <div className={styles.listHeading}>
            <h2>Agenda del día</h2>
            <span role="status">
              {loadError
                ? "No disponible"
                : dateLoading
                  ? "Cargando…"
                  : `${visibleAppointments.length} de ${dayAppointments.length} citas`}
            </span>
          </div>
          {loadError ? (
            <div role="alert" className={styles.empty}>
              <p>{loadError}</p>
              <Button variant="outline" onClick={() => void load()}>
                Reintentar
              </Button>
            </div>
          ) : dateLoading ? (
            <div role="status" className={styles.empty}>
              <Loader2 className="size-5 animate-spin" />
              Cargando citas…
            </div>
          ) : visibleAppointments.length === 0 ? (
            <div className={styles.empty}>
              <CalendarClock className="size-7 text-muted-foreground" />
              <p>
                {dayAppointments.length
                  ? "No hay citas para estos filtros."
                  : "No hay citas para esta fecha."}
              </p>
              {dayAppointments.length > 0 && (
                <Button variant="outline" onClick={clearFilters}>
                  Ver todas las citas
                </Button>
              )}
            </div>
          ) : (
            <div className={styles.list}>
              {visibleAppointments.map((appointment) => {
                const specialistName =
                  appointment.specialist?.displayName ||
                  appointment.specialist?.name ||
                  appointment.specialistName;
                const appointmentStarted =
                  new Date(appointment.startTime).getTime() <= Date.now();
                const isClosed = ["completed", "cancelled", "no_show"].includes(
                  appointment.status,
                );
                const notificationLocked = appointmentStarted || isClosed;
                const pendingPortalRequest = appointment.source === "portal" && appointment.status === "scheduled" && appointment.confirmationStatus === "pending";
                const primaryStatus =
                  appointment.status === "scheduled"
                    ? appointment.confirmationStatus === "confirmed"
                      ? "waiting"
                      : "confirmed"
                    : ["waiting", "called"].includes(appointment.status)
                      ? "in_progress"
                      : appointment.status === "in_progress"
                        ? "completed"
                        : null;
                const primary = STATUS_ACTIONS.find(
                  (action) => action.value === primaryStatus,
                );
                const disabled = !canWrite || isPending;
                const actionButton = (
                  action: (typeof STATUS_ACTIONS)[number],
                  prominent = false,
                ) => (
                  <Button
                    key={action.value}
                    variant={prominent ? "default" : "outline"}
                    disabled={disabled}
                    onClick={() =>
                      action.value === "completed"
                        ? openFinishDialog(appointment)
                        : runAction(
                            () =>
                              updateAppointmentStatus(
                                appointment.id,
                                action.value,
                              ),
                            action.success,
                          )
                    }
                  >
                    <action.icon className="size-4" />
                    {action.label}
                  </Button>
                );
                return (
                  <article
                    key={appointment.id}
                    className={styles.appointment}
                    aria-label={`Cita de ${patientName(appointment)}`}
                  >
                    <div className={styles.time}>
                      <strong>
                        {formatTimeInOperationZone(
                          appointment.startTime,
                          operationContext.locale,
                          operationContext.timeZone,
                          { hour12: false },
                        )}
                      </strong>
                      <span>
                        {Math.round(
                          (new Date(appointment.endTime).getTime() -
                            new Date(appointment.startTime).getTime()) /
                            60000,
                        )}{" "}
                        min
                      </span>
                    </div>
                    <div className={styles.appointmentInfo}>
                      <h3>{patientName(appointment)}</h3>
                      <p>{appointment.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {specialistName || "Sin especialista"} ·{" "}
                        {appointment.patient?.phone ||
                          appointment.contact?.phone ||
                          "Sin teléfono"}
                      </p>
                      <div className={styles.badges}>
                        <Badge
                          variant="outline"
                          className={statusTone(appointment.status)}
                        >
                          {STATUS_LABELS[appointment.status] ||
                            appointment.status}
                        </Badge>
                        {appointment.isOverbook && (
                          <Badge variant="secondary">Sobreturno</Badge>
                        )}
                        {appointment.source === "portal" && (
                          <Badge variant="outline">Portal</Badge>
                        )}
                        {appointment.confirmationStatus === "confirmed" && (
                          <Badge variant="outline">Confirmada</Badge>
                        )}
                        {appointment.visitMode &&
                          appointment.visitMode !== "presencial" && (
                            <Badge variant="outline">
                              {appointment.visitMode === "hibrida"
                                ? "Híbrida"
                                : "Virtual"}
                            </Badge>
                          )}
                        {appointment.appointmentReminders?.map((reminder) => (
                          <Badge
                            key={reminder.id}
                            variant="outline"
                            className={reminderTone(reminder.status)}
                          >
                            {reminder.label}:{" "}
                            {reminderStatusLabel(reminder.status)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className={styles.appointmentActions}>
                      {pendingPortalRequest ? <AppointmentRequestActions disabled={disabled} onDecision={(status) => runAction(() => updateAppointmentStatus(appointment.id, status, status === "cancelled" ? "Solicitud rechazada por el negocio." : undefined), status === "cancelled" ? "Solicitud rechazada" : "Cita confirmada")} /> : requestedRequestId === appointment.id ? <p role="status" className="text-sm font-medium">{appointment.status === "cancelled" ? "Solicitud rechazada" : "Solicitud confirmada"}</p> : <>
                      <div className={styles.primaryActions}>
                        {primary && actionButton(primary, true)}
                        {appointment.meetLink && (
                          <Button variant="outline" asChild>
                            <a
                              href={appointment.meetLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Video className="size-4" />
                              Meet
                            </a>
                          </Button>
                        )}
                      </div>
                      <details className={styles.moreActions}>
                        <summary>Más acciones</summary>
                        <div>
                          {STATUS_ACTIONS.filter(
                            (action) => action.value !== primaryStatus,
                          ).map((action) => actionButton(action))}
                          <Button
                            variant="outline"
                            onClick={() => prepareNotification(appointment)}
                            disabled={disabled || notificationLocked}
                            title={
                              notificationLocked
                                ? "Disponible antes del inicio de una cita abierta."
                                : "Preparar notificación en Chats"
                            }
                          >
                            <WhatsAppIcon className="size-4" />
                            Notificar
                          </Button>
                          {appointment.appointmentReminders
                            ?.filter((r) => r.status === "failed")
                            .map((reminder) => (
                              <Button
                                key={reminder.id}
                                variant="outline"
                                disabled={disabled}
                                onClick={() =>
                                  retryReminder(reminder.id, reminder.label)
                                }
                              >
                                Reintentar {reminder.label}
                              </Button>
                            ))}
                        </div>
                        {notificationLocked && (
                          <p className="text-xs text-muted-foreground">
                            La notificación manual está disponible antes del
                            inicio de una cita abierta.
                          </p>
                        )}
                      </details>
                      </>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <Dialog open={remindersOpen} onOpenChange={setRemindersOpen}>
        <DialogContent className={`${layout.dialog} ${styles.dialog}`}>
          <DialogHeader className={layout.dialogHeader}>
            <DialogTitle>Recordatorios</DialogTitle>
            <DialogDescription>
              Consulta los envíos y los que requieren atención.
            </DialogDescription>
          </DialogHeader>
          <div className={layout.dialogBody}>
            <div className={styles.reminderFilters}>
              <div>
                <Label htmlFor="reminder-date">Fecha de envío</Label>
                <Input
                  id="reminder-date"
                  type="date"
                  value={reminderDate}
                  disabled={isPending}
                  onChange={(event) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))
                      setReminderDate(event.target.value);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="reminder-status">Estado</Label>
                <select
                  id="reminder-status"
                  value={reminderFilter}
                  onChange={(event) =>
                    setReminderFilter(event.target.value as ReminderFilter)
                  }
                >
                  <option value="all">Todos</option>
                  <option value="pending">Por enviar</option>
                  <option value="sent">Enviados</option>
                  <option value="issues">Con atención</option>
                </select>
              </div>
              <Button
                variant="outline"
                onClick={() => void loadReminders()}
                disabled={isPending || remindersLoading}
              >
                <RefreshCw className="size-4" />
                Actualizar
              </Button>
            </div>
            <div className={styles.reminderStats}>
              {(
                [
                  ["pending", "Por enviar"],
                  ["sent", "Enviados"],
                  ["issues", "Con atención"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={reminderFilter === value}
                  onClick={() =>
                    setReminderFilter((current) =>
                      current === value ? "all" : value,
                    )
                  }
                >
                  <strong>
                    {remindersLoading || reminderError
                      ? "—"
                      : reminderStats[value]}
                  </strong>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {reminderError ? (
              <div role="alert" className={styles.empty}>
                <p>{reminderError}</p>
                <Button variant="outline" onClick={() => void loadReminders()}>
                  Reintentar
                </Button>
              </div>
            ) : remindersLoading ? (
              <div role="status" className={styles.empty}>
                <Loader2 className="size-5 animate-spin" />
                Cargando recordatorios…
              </div>
            ) : visibleReminders.length === 0 ? (
              <div className={styles.empty}>
                <BellRing className="size-7 text-muted-foreground" />
                <p>No hay recordatorios para este filtro.</p>
                <p className="text-sm text-muted-foreground">
                  Prueba otra fecha o comprueba los recordatorios automáticos
                  del negocio.
                </p>
              </div>
            ) : (
              <div className={styles.reminderList}>
                {visibleReminders.map((reminder) => (
                  <article key={reminder.id} className={styles.reminder}>
                    <div>
                      <h3>{reminderClientName(reminder)}</h3>
                      <div className={styles.badges}>
                        <Badge
                          variant="outline"
                          className={reminderTone(reminder.status)}
                        >
                          {reminderStatusLabel(reminder.status)}
                        </Badge>
                        <Badge variant="secondary">{reminder.label}</Badge>
                      </div>
                      <p>
                        Envío:{" "}
                        {formatTimeInOperationZone(
                          reminder.scheduledFor,
                          operationContext.locale,
                          operationContext.timeZone,
                        )}{" "}
                        · WhatsApp {reminderClientPhone(reminder)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Cita:{" "}
                        {formatOperationDayLabel(
                          getOperationDateKey(
                            reminder.appointment.startTime,
                            operationContext.timeZone,
                          ),
                          operationContext.locale,
                          operationContext.timeZone,
                        )}{" "}
                        ·{" "}
                        {formatTimeInOperationZone(
                          reminder.appointment.startTime,
                          operationContext.locale,
                          operationContext.timeZone,
                        )}{" "}
                        ·{" "}
                        {reminder.appointment.specialist?.displayName ||
                          reminder.appointment.specialist?.name ||
                          "Sin especialista"}
                      </p>
                      {reminder.lastError && (
                        <p className={styles.reminderError}>
                          <TriangleAlert className="size-4 shrink-0" />
                          {reminder.lastError}
                        </p>
                      )}
                    </div>
                    <div className={styles.retryActions}>
                      <span>
                        {reminder.attempts} intento
                        {reminder.attempts === 1 ? "" : "s"}
                      </span>
                      {reminder.status === "failed" && (
                        <Button
                          variant="outline"
                          disabled={!canWrite || isPending || dateLoading}
                          onClick={() =>
                            retryReminder(reminder.id, reminder.label)
                          }
                        >
                          <RefreshCw className="size-4" />
                          Reintentar
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className={layout.dialogFooter}>
            <Button variant="outline" onClick={() => setRemindersOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(closingAppointment)}
        onOpenChange={(open) => {
          if (!open && !isPending) setClosingAppointment(null);
        }}
      >
        <DialogContent className={`${layout.dialog} ${styles.finishDialog}`}>
          <DialogHeader className={layout.dialogHeader}>
            <DialogTitle>Finalizar cita</DialogTitle>
            <DialogDescription>
              La cita quedará marcada como completada.
            </DialogDescription>
          </DialogHeader>
          <div className={layout.dialogBody}>
            {closingAppointment && (
              <div className={styles.finishSummary}>
                <span className="text-sm text-muted-foreground">Cliente</span>
                <h3>{patientName(closingAppointment)}</h3>
                <p>{closingAppointment.title}</p>
                <p>
                  {formatTimeInOperationZone(
                    closingAppointment.startTime,
                    operationContext.locale,
                    operationContext.timeZone,
                    { hour12: true },
                  )}
                </p>
              </div>
            )}
          </div>
          <DialogFooter className={layout.dialogFooter}>
            <Button
              variant="outline"
              onClick={() => setClosingAppointment(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={finishAppointment}
              disabled={!canWrite || isPending || dateLoading}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}Marcar
              completada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
