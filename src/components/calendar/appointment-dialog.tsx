"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import {
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getAppointmentClientOptions,
} from "@/app/actions/calendar";
import { getPatientsForPicker, savePatient } from "@/app/actions/patients";
import { getSpecialists } from "@/app/actions/specialists";
import { getActiveServicesForBooking } from "@/app/actions/services";
import { getSystemSettings } from "@/app/actions/settings";
import { buildOperationContext } from "@/lib/operation-context";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { useToast } from "@/components/ui/use-toast";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  X,
} from "lucide-react";
import {
  getBusinessDayScheduleForDate,
  getNextOpenDate,
  formatTimeLabel,
  timeToMinutes,
  type BusinessHoursConfig,
} from "@/lib/calendar/business-hours";
import {
  getOperationDateKey,
  getOperationTodayKey,
  operationDateReference,
  timeToOperationInputValue,
  formatOperationDayLabel,
  getLocalCalendarDateKey,
} from "@/lib/operation-dates";
import { resolveDraftTimes, validCalendarDateKey } from "@/lib/calendar/draft";
import type { GoogleCalendarSourceSummary } from "@/lib/google-calendar";
import styles from "./appointment-dialog.module.css";

type Patient = Awaited<ReturnType<typeof getPatientsForPicker>>[number];
type ClientOption = {
  id: string;
  patientId: string | null;
  contactId: string | null;
  name: string;
  phone: string | null;
};
type Specialist = Awaited<ReturnType<typeof getSpecialists>>[number];
type Service = Awaited<ReturnType<typeof getActiveServicesForBooking>>[number];
export type SelectedAppointmentEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  notes?: string | null;
  resource?: {
    patient?: {
      id?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
    } | null;
    contact?: {
      id?: string | null;
      name?: string | null;
      lastName?: string | null;
      phone?: string | null;
    } | null;
    specialist?: {
      id?: string | null;
      name?: string | null;
      displayName?: string | null;
    } | null;
    specialistId?: string | null;
    serviceId?: string | null;
    appointmentType?: string | null;
    isFirstVisit?: boolean | null;
    isOverbook?: boolean | null;
    visitMode?: string | null;
    meetStatus?: string | null;
    meetLink?: string | null;
    remindersOptOut?: boolean | null;
    googleCalendarId?: string | null;
    googleCalendarColor?: string | null;
    googleCalendarName?: string | null;
    specialistName?: string | null;
    status?: string | null;
    confirmationStatus?: string | null;
  };
};
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEvent?: SelectedAppointmentEvent | null;
  selectedSlot?: { start: Date; end: Date } | null;
  defaultPatient?: Patient | null;
  defaultContact?: {
    id: string;
    name?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  defaultPatientId?: string | null;
  defaultSpecialistId?: string | null;
  lockedSpecialistId?: string | null;
  onSuccess: () => Promise<void> | void;
  businessHours: BusinessHoursConfig;
  readOnly?: boolean;
}
const durationOptions = [15, 30, 45, 60, 90, 120, 180, 240];
export function AppointmentDialog({
  open,
  onOpenChange,
  selectedEvent,
  selectedSlot,
  defaultPatient,
  defaultContact,
  defaultPatientId,
  defaultSpecialistId,
  lockedSpecialistId,
  onSuccess,
  businessHours,
  readOnly: readOnlyOverride,
}: Props) {
  const access = useWorkspaceAccess();
  const readOnly = readOnlyOverride ?? access.readOnly;
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const initialized = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [client, setClient] = useState<ClientOption | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [serviceId, setServiceId] = useState("none");
  const [specialistId, setSpecialistId] = useState("none");
  const [dateKey, setDateKey] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [notes, setNotes] = useState("");
  const [overbook, setOverbook] = useState(false);
  const [sendReminders, setSendReminders] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [sources, setSources] = useState<GoogleCalendarSourceSummary[]>([]);
  const [context, setContext] = useState({
    locale: "es-MX",
    phoneDefaultCountry: "MX",
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [newClient, setNewClient] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open) {
      initialized.current = "";
      return;
    }
    const key =
      selectedEvent?.id ||
      `new:${selectedSlot?.start.toISOString() || ""}:${defaultPatientId || defaultPatient?.id || defaultContact?.id || ""}`;
    if (initialized.current === key) return;
    initialized.current = key;
    const patient = selectedEvent?.resource?.patient || defaultPatient;
    const contact = selectedEvent?.resource?.contact || defaultContact;
    const patientId = patient?.id || defaultPatientId;
    setClient(
      patientId
        ? {
            id: `patient:${patientId}`,
            patientId,
            contactId: null,
            name:
              [
                patient && "firstName" in patient ? patient.firstName : "",
                patient && "lastName" in patient ? patient.lastName : "",
              ]
                .filter(Boolean)
                .join(" ") || "Cliente seleccionado",
            phone: patient?.phone || null,
          }
        : contact?.id
          ? {
              id: `contact:${contact.id}`,
              patientId: null,
              contactId: contact.id,
              name:
                [contact.name, contact.lastName].filter(Boolean).join(" ") ||
                contact.phone ||
                "Cliente",
              phone: contact.phone || null,
            }
          : null,
    );
    const keyDate = selectedEvent
      ? getOperationDateKey(selectedEvent.start, businessHours.timeZone)
      : selectedSlot
        ? getLocalCalendarDateKey(selectedSlot.start)
        : getOperationDateKey(
            getNextOpenDate(new Date(), businessHours),
            businessHours.timeZone,
          );
    const schedule = getBusinessDayScheduleForDate(
      operationDateReference(keyDate, businessHours.timeZone),
      businessHours,
    ).schedule;
    const rawTime = selectedEvent
      ? timeToOperationInputValue(selectedEvent.start, businessHours.timeZone)
      : selectedSlot
        ? `${String(selectedSlot.start.getHours()).padStart(2, "0")}:${String(selectedSlot.start.getMinutes()).padStart(2, "0")}`
        : schedule.start;
    const currentTime = timeToOperationInputValue(
      new Date(Date.now() + 60000),
      businessHours.timeZone,
    );
    const earliest =
      keyDate === getOperationTodayKey(businessHours.timeZone) &&
      currentTime > schedule.start
        ? currentTime
        : schedule.start;
    const newMinutes =
      Math.ceil(timeToMinutes(rawTime > earliest ? rawTime : earliest) / 15) *
      15;
    setDateKey(keyDate);
    setTime(
      selectedEvent
        ? rawTime
        : `${String(Math.floor(Math.min(newMinutes, 1439) / 60)).padStart(2, "0")}:${String(Math.min(newMinutes, 1439) % 60).padStart(2, "0")}`,
    );
    setDuration(
      selectedEvent
        ? String(
            (selectedEvent.end.getTime() - selectedEvent.start.getTime()) /
              60000,
          )
        : "30",
    );
    setServiceId(selectedEvent?.resource?.serviceId || "none");
    setSpecialistId(
      selectedEvent?.resource?.specialistId ||
        selectedEvent?.resource?.specialist?.id ||
        lockedSpecialistId ||
        defaultSpecialistId ||
        "none",
    );
    setNotes(selectedEvent?.notes || "");
    setOverbook(Boolean(selectedEvent?.resource?.isOverbook));
    setStep(readOnly ? 2 : 0);
    setErrors({});
    setSaveError("");
    setClientSearch("");
    setPickerOpen(false);
    setNewClient(false);
    setNewName("");
    setNewPhone("");
  }, [
    open,
    selectedEvent,
    selectedSlot,
    defaultPatient,
    defaultContact,
    defaultPatientId,
    defaultSpecialistId,
    lockedSpecialistId,
    businessHours,
    readOnly,
  ]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.all([
      getActiveServicesForBooking(),
      getSpecialists(),
      getSystemSettings(),
    ])
      .then(([serviceRows, specialistRows, settings]) => {
        if (!active) return;
        setServices(serviceRows);
        setSpecialists(specialistRows);
        const operation = buildOperationContext(settings);
        setContext({
          locale: operation.locale,
          phoneDefaultCountry: operation.phoneDefaultCountry,
        });
        const enabled = Boolean(
          settings?.appointmentRemindersEnabled &&
            settings?.reminderWhatsAppEnabled,
        );
        setRemindersEnabled(enabled);
        setSendReminders(enabled && !selectedEvent?.resource?.remindersOptOut);
        setSpecialistId((current) =>
          current !== "none"
            ? current
            : lockedSpecialistId ||
              defaultSpecialistId ||
              specialistRows[0]?.id ||
              "none",
        );
      })
      .catch(() => {
        if (active)
          setLoadError(
            "No pudimos cargar servicios y profesionales. Vuelve a intentarlo.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, retry, selectedEvent, lockedSpecialistId, defaultSpecialistId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSearchError("");
    const timer = window.setTimeout(
      () => {
        getAppointmentClientOptions(
          clientSearch,
          selectedEvent?.resource?.patient?.id ||
            defaultPatientId ||
            defaultPatient?.id ||
            undefined,
        )
          .then((rows) => {
            if (!active) return;
            setClients(rows);
            setClient((current) =>
              current && rows.some((row) => row.id === current.id)
                ? rows.find((row) => row.id === current.id)!
                : current,
            );
          })
          .catch(() => {
            if (active)
              setSearchError(
                "No pudimos buscar clientes. Reintenta la búsqueda.",
              );
          });
      },
      clientSearch ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    open,
    clientSearch,
    retry,
    selectedEvent,
    defaultPatientId,
    defaultPatient?.id,
  ]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/google-calendar/status", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!controller.signal.aborted)
          setSources(
            data?.sources?.filter(
              (source: GoogleCalendarSourceSummary) => source.isSelected,
            ) || [],
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open]);

  const service = services.find((row) => row.id === serviceId);
  const eligible = service?.specialists.map((row) => row.specialistId) || [];
  const available = specialists.filter(
    (row) =>
      (!lockedSpecialistId || row.id === lockedSpecialistId) &&
      (!eligible.length || eligible.includes(row.id)),
  );
  const specialist = specialists.find((row) => row.id === specialistId);
  const serviceName =
    service?.name ||
    selectedEvent?.resource?.appointmentType ||
    selectedEvent?.title ||
    "Servicio personalizado";
  const specialistName =
    specialist?.displayName ||
    specialist?.name ||
    selectedEvent?.resource?.specialist?.displayName ||
    selectedEvent?.resource?.specialist?.name ||
    selectedEvent?.resource?.specialistName ||
    "Sin profesional";
  const schedule = validCalendarDateKey(dateKey)
    ? getBusinessDayScheduleForDate(
        operationDateReference(dateKey, businessHours.timeZone),
        businessHours,
      ).schedule
    : null;
  const changeStep = (value: number) => {
    setStep(value);
    setErrors({});
    setSaveError("");
    bodyRef.current?.scrollTo({ top: 0 });
  };
  const validate = (part: number) => {
    const next: Record<string, string> = {};
    if (part === 0) {
      if (!client) next.client = "Selecciona o registra un cliente.";
      if (!selectedEvent && serviceId === "none")
        next.service = "Selecciona el servicio de la cita.";
      if (specialistId === "none")
        next.specialist = "Selecciona un profesional.";
      if (eligible.length && !eligible.includes(specialistId))
        next.specialist =
          "Este profesional no atiende el servicio seleccionado.";
    } else {
      try {
        const times = resolveDraftTimes({
          dateKey,
          time,
          duration: Number(duration),
          timeZone: businessHours.timeZone,
          original: selectedEvent,
        });
        if (!times.unchanged && times.start <= new Date())
          next.time = "Selecciona un horario futuro.";
        if (!times.unchanged && !schedule?.enabled)
          next.date = "El negocio está cerrado ese día.";
      } catch (error) {
        next.time =
          error instanceof Error ? error.message : "Revisa el horario.";
      }
    }
    setErrors(next);
    return !Object.keys(next).length;
  };
  const save = () => {
    if (readOnly || loading || pending) return;
    if (!validate(0)) {
      setStep(0);
      return;
    }
    if (!validate(1)) {
      setStep(1);
      return;
    }
    startTransition(async () => {
      setSaveError("");
      try {
        const times = resolveDraftTimes({
          dateKey,
          time,
          duration: Number(duration),
          timeZone: businessHours.timeZone,
          original: selectedEvent,
        });
        const originalSpecialist =
          selectedEvent?.resource?.specialistId ||
          selectedEvent?.resource?.specialist?.id ||
          "none";
        const scheduleChanged =
          !selectedEvent ||
          !times.unchanged ||
          specialistId !== originalSpecialist ||
          overbook !== Boolean(selectedEvent.resource?.isOverbook);
        const source =
          specialist?.googleCalendarSource ||
          sources.find(
            (row) =>
              row.calendarId === selectedEvent?.resource?.googleCalendarId,
          ) ||
          sources.find((row) => row.isWriteTarget && row.writable);
        const details = {
          title: serviceName,
          notes,
          ...(client?.patientId
            ? { patientId: client.patientId }
            : { contactId: client!.contactId! }),
          serviceId: serviceId !== "none" ? serviceId : undefined,
          appointmentType: serviceName,
          remindersOptOut: !sendReminders,
        };
        const timing = {
          startTime: times.start,
          endTime: times.end,
          specialistId: specialistId !== "none" ? specialistId : undefined,
          specialistName,
          isOverbook: overbook,
          googleCalendarId: source?.calendarId,
          googleCalendarName: source?.summary,
          googleCalendarColor: source?.backgroundColor || undefined,
          blockingCalendarIds: source?.calendarId
            ? [source.calendarId]
            : undefined,
        };
        const result = selectedEvent
          ? await updateAppointment(selectedEvent.id, {
              ...details,
              ...(scheduleChanged ? timing : {}),
            })
          : await createAppointment({ ...details, ...timing });
        if (!result.success) {
          setSaveError(
            result.error ||
              "No se pudo guardar. Tus datos siguen en el formulario.",
          );
          return;
        }
        toast({ title: selectedEvent ? "Cita actualizada" : "Cita creada" });
        onOpenChange(false);
        await onSuccess();
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "No se pudo guardar. Inténtalo nuevamente.",
        );
      }
    });
  };
  const remove = () => {
    if (
      !selectedEvent ||
      readOnly ||
      pending ||
      !confirm("¿Eliminar esta cita?")
    )
      return;
    startTransition(async () => {
      try {
        const result = await deleteAppointment(selectedEvent.id);
        if (!result.success) {
          setSaveError(result.error || "No se pudo eliminar la cita.");
          return;
        }
        onOpenChange(false);
        await onSuccess();
        toast({ title: "Cita eliminada" });
      } catch {
        setSaveError("No se pudo eliminar la cita.");
      }
    });
  };
  const registerClient = async () => {
    if (!newName.trim() || !newPhone.trim() || readOnly) return;
    setCreatingClient(true);
    setSaveError("");
    try {
      const result = await savePatient({
        firstName: newName.trim(),
        lastName: "",
        phone: newPhone,
      });
      if (!result.success || !result.patient) {
        setSaveError(result.error || "No se pudo registrar el cliente.");
        return;
      }
      setClient({
        id: `patient:${result.patient.id}`,
        patientId: result.patient.id,
        contactId: null,
        name: [result.patient.firstName, result.patient.lastName]
          .filter(Boolean)
          .join(" "),
        phone: result.patient.phone,
      });
      setNewClient(false);
      setNewName("");
      setNewPhone("");
    } catch {
      setSaveError(
        "No se pudo registrar el cliente. Conservamos los datos para reintentar.",
      );
    } finally {
      setCreatingClient(false);
    }
  };
  const fieldError = (key: string) =>
    errors[key] ? (
      <p
        id={`appointment-${key}-error`}
        className="mt-2 text-sm text-destructive"
        role="alert"
      >
        {errors[key]}
      </p>
    ) : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending && !creatingClient) onOpenChange(value);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={styles.dialog}
        onEscapeKeyDown={(event) => {
          if (pending || creatingClient) event.preventDefault();
        }}
      >
        <DialogHeader className={styles.header}>
          <div className="min-w-0">
            <DialogTitle className="text-xl font-semibold">
              {readOnly
                ? "Detalle de cita"
                : step === 2
                  ? "Revisa tu cita"
                  : selectedEvent
                    ? "Editar cita"
                    : "Nueva cita"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {readOnly
                ? "Consulta disponible · Solo lectura"
                : `Paso ${step + 1} de 3 · ${["Cliente y servicio", "Fecha y horario", "Confirma los datos"][step]}`}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              disabled={pending || creatingClient}
              aria-label="Cerrar cita"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
            >
              <X className="size-5" />
            </button>
          </DialogClose>
        </DialogHeader>
        <div ref={bodyRef} className={styles.body}>
          {loadError ? (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-destructive/25 p-4 text-sm"
            >
              <p>{loadError}</p>
              <Button
                variant="outline"
                className="mt-3 min-h-11"
                onClick={() => setRetry((value) => value + 1)}
              >
                Reintentar
              </Button>
            </div>
          ) : null}
          {loading && (
            <p role="status" className="mb-5 text-sm text-muted-foreground">
              Cargando opciones…
            </p>
          )}
          {step === 0 && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-4 text-sm font-semibold">
                  ¿Quién se atiende?
                </h3>
                <Label htmlFor="appointment-client">Cliente</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="appointment-client"
                      variant="outline"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      aria-label="Cliente"
                      aria-invalid={Boolean(errors.client)}
                      aria-describedby={
                        errors.client ? "appointment-client-error" : undefined
                      }
                      className="mt-2 min-h-12 h-auto w-full min-w-0 justify-between whitespace-normal text-left"
                    >
                      <span className="min-w-0 break-words">
                        {client?.name || "Seleccionar cliente"}
                      </span>
                      <ChevronsUpDown className="size-4 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Buscar nombre o teléfono"
                        value={clientSearch}
                        onValueChange={setClientSearch}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {searchError || "No se encontraron clientes."}
                        </CommandEmpty>
                        <CommandGroup>
                          {clients.map((row) => (
                            <CommandItem
                              key={row.id}
                              value={row.id}
                              onSelect={() => {
                                setClient(row);
                                setPickerOpen(false);
                                setErrors({});
                              }}
                              className="min-h-12"
                            >
                              <Check
                                className={
                                  client?.id === row.id
                                    ? "size-4"
                                    : "size-4 opacity-0"
                                }
                              />
                              <div className="min-w-0">
                                <p className="break-words">{row.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {row.phone || "Sin teléfono"}
                                </p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                      <Button
                        variant="ghost"
                        className="min-h-11 w-full justify-start"
                        onClick={() => {
                          setNewClient(true);
                          setPickerOpen(false);
                        }}
                      >
                        Registrar nuevo cliente
                      </Button>
                    </Command>
                  </PopoverContent>
                </Popover>
                {fieldError("client")}
                {newClient && (
                  <div className="mt-4 space-y-4 rounded-xl border border-border p-4">
                    <Label htmlFor="appointment-new-name">Nombre</Label>
                    <Input
                      id="appointment-new-name"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      className="min-h-12"
                    />
                    <Label>Teléfono</Label>
                    <PhonePrefixInput
                      value={newPhone}
                      onChange={setNewPhone}
                      defaultCountry={context.phoneDefaultCountry}
                      inputClassName="min-h-12"
                    />
                    <p className="text-xs text-muted-foreground">
                      Guardar registra al cliente ahora, aunque luego canceles
                      la cita.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="min-h-11"
                        onClick={() => void registerClient()}
                        disabled={
                          creatingClient || !newName.trim() || !newPhone.trim()
                        }
                      >
                        {creatingClient ? "Guardando…" : "Guardar cliente"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        onClick={() => setNewClient(false)}
                      >
                        Cancelar registro
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <section className="space-y-4">
                <h3 className="text-sm font-semibold">
                  Servicio y profesional
                </h3>
                <div>
                  <Label htmlFor="appointment-service">Servicio</Label>
                  <Select
                    value={serviceId}
                    onValueChange={(value) => {
                      setServiceId(value);
                      const next = services.find((row) => row.id === value);
                      if (next) {
                        setDuration(String(next.durationMinutes));
                        const ids = next.specialists.map(
                          (row) => row.specialistId,
                        );
                        if (ids.length && !ids.includes(specialistId))
                          setSpecialistId(lockedSpecialistId || ids[0]);
                      }
                      setErrors({});
                    }}
                    disabled={loading}
                  >
                    <SelectTrigger
                      id="appointment-service"
                      aria-label="Servicio"
                      aria-invalid={Boolean(errors.service)}
                      className="mt-2 min-h-12 h-auto w-full whitespace-normal text-left"
                    >
                      <SelectValue placeholder="Seleccionar servicio" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {selectedEvent
                          ? "Servicio personalizado"
                          : "Seleccionar servicio"}
                      </SelectItem>
                      {serviceId !== "none" && !service && (
                        <SelectItem value={serviceId}>
                          {serviceName} · Servicio original
                        </SelectItem>
                      )}
                      {services.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name} · {row.durationMinutes} min
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError("service")}
                  {!loading && !services.length && !selectedEvent && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Primero configura al menos un servicio activo en
                      Servicios.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="appointment-specialist">Profesional</Label>
                  <Select
                    value={specialistId}
                    onValueChange={setSpecialistId}
                    disabled={loading || Boolean(lockedSpecialistId)}
                  >
                    <SelectTrigger
                      id="appointment-specialist"
                      aria-label="Profesional"
                      aria-invalid={Boolean(errors.specialist)}
                      className="mt-2 min-h-12 h-auto w-full whitespace-normal text-left"
                    >
                      <SelectValue placeholder="Seleccionar profesional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Seleccionar profesional
                      </SelectItem>
                      {specialistId !== "none" &&
                        !available.some((row) => row.id === specialistId) && (
                          <SelectItem value={specialistId}>
                            {specialistName}
                          </SelectItem>
                        )}
                      {available.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.displayName || row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError("specialist")}
                  {!loading && !available.length && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No hay profesionales disponibles para este servicio.
                    </p>
                  )}
                </div>
                {service && (
                  <p className="text-sm text-muted-foreground">
                    Precio de catálogo:{" "}
                    {new Intl.NumberFormat(context.locale, {
                      style: "currency",
                      currency: service.currency,
                    }).format(service.price)}
                    . El cobro se registra por separado.
                  </p>
                )}
              </section>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-4 text-sm font-semibold">¿Cuándo?</h3>
                <div className={styles.timeFields}>
                  <div>
                    <Label htmlFor="appointment-date">Fecha</Label>
                    <Input
                      id="appointment-date"
                      type="date"
                      value={dateKey}
                      onChange={(event) => setDateKey(event.target.value)}
                      aria-invalid={Boolean(errors.date)}
                      className="mt-2 min-h-12"
                    />
                    {fieldError("date")}
                  </div>
                  <div>
                    <Label htmlFor="appointment-time">Hora</Label>
                    <Input
                      id="appointment-time"
                      type="time"
                      step="60"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                      aria-invalid={Boolean(errors.time)}
                      className="mt-2 min-h-12"
                    />
                  </div>
                </div>
                {fieldError("time")}
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {schedule?.enabled
                    ? `Horario del negocio: ${formatTimeLabel(schedule.start, context.locale)} a ${formatTimeLabel(schedule.end, context.locale)}.`
                    : "El negocio está cerrado en esta fecha."}{" "}
                  Zona horaria: {businessHours.timeZone}.
                </p>
                <div className="mt-5">
                  <Label htmlFor="appointment-duration">Duración</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger
                      id="appointment-duration"
                      aria-label="Duración"
                      className="mt-2 min-h-12 w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!durationOptions.includes(Number(duration)) && (
                        <SelectItem value={duration}>
                          {duration} min · Duración original
                        </SelectItem>
                      )}
                      {durationOptions.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value} minutos
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>
              <section className="space-y-4">
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-border px-4 py-3">
                  <Checkbox
                    checked={sendReminders}
                    onCheckedChange={(value) =>
                      setSendReminders(Boolean(value))
                    }
                    disabled={!remindersEnabled}
                  />
                  <span className="text-sm">
                    Enviar recordatorio
                    {!remindersEnabled && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Desactivado en la configuración del negocio.
                      </span>
                    )}
                  </span>
                </label>
                <details className="rounded-xl border border-border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Opciones adicionales
                  </summary>
                  <div className="mt-4 space-y-4">
                    <label className="flex min-h-11 items-center gap-3">
                      <Checkbox
                        checked={overbook}
                        onCheckedChange={(value) => setOverbook(Boolean(value))}
                      />
                      <span className="text-sm">Permitir sobreturno</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Permite solapar horarios sólo si las políticas del negocio
                      lo autorizan.
                    </p>
                    <Label htmlFor="appointment-notes">Notas internas</Label>
                    <textarea
                      id="appointment-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="min-h-28 w-full rounded-xl border border-border bg-card p-3 text-base"
                    />
                  </div>
                </details>
              </section>
            </div>
          )}
          {step === 2 && (
            <section>
              <h3 className="break-words text-xl font-semibold">
                {client?.name || "Sin cliente asignado"}
              </h3>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                {serviceName}
              </p>
              <dl className={styles.review}>
                {[
                  ["Profesional", specialistName],
                  [
                    "Fecha",
                    validCalendarDateKey(dateKey)
                      ? formatOperationDayLabel(
                          dateKey,
                          context.locale,
                          businessHours.timeZone,
                          {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          },
                        )
                      : "Sin fecha",
                  ],
                  ["Hora", formatTimeLabel(time, context.locale)],
                  ["Duración", `${duration} minutos`],
                  ["Recordatorio", sendReminders ? "Activado" : "Desactivado"],
                  ...(overbook ? [["Sobreturno", "Sí"]] : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {notes && (
                <p className="mt-4 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {notes}
                </p>
              )}
              <p className="mt-5 rounded-xl bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground">
                {readOnly
                  ? "Esta cuenta permite consultar los datos. Reactiva un plan para realizar cambios."
                  : "Al confirmar comprobamos el horario y los posibles conflictos en el servidor. Si no se puede guardar, conservarás estos datos para corregirlos."}
              </p>
            </section>
          )}
          {saveError && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-destructive/25 p-4 text-sm text-destructive"
            >
              {saveError}
            </div>
          )}
        </div>
        <footer className={styles.footer}>
          {readOnly ? (
            <Button
              className="min-h-11 w-full"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap gap-2">
                {step > 0 ? (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => changeStep(step - 1)}
                    disabled={pending}
                  >
                    <ChevronLeft />
                    Atrás
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => onOpenChange(false)}
                    disabled={pending || creatingClient}
                  >
                    Cancelar
                  </Button>
                )}
                {selectedEvent && step === 0 && (
                  <Button
                    variant="ghost"
                    className="min-h-11 text-destructive"
                    onClick={remove}
                    disabled={pending}
                  >
                    Eliminar
                  </Button>
                )}
              </div>
              <Button
                className="min-h-11 min-w-0 flex-1 whitespace-normal"
                disabled={
                  loading || Boolean(loadError) || pending || creatingClient
                }
                onClick={() => {
                  if (step < 2) {
                    if (validate(step)) changeStep(step + 1);
                  } else save();
                }}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {step === 2
                  ? selectedEvent
                    ? "Guardar cambios"
                    : "Confirmar cita"
                  : step === 1
                    ? "Revisar cita"
                    : "Continuar"}
                {step < 2 && <ChevronRight className="size-4" />}
              </Button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
