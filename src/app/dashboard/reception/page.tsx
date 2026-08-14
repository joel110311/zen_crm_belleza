"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
    Banknote,
    BellRing,
    CalendarClock,
    CheckCircle2,
    ClipboardCheck,
    CreditCard,
    Landmark,
    LinkIcon,
    LockKeyhole,
    Loader2,
    RefreshCw,
    TriangleAlert,
    UserCheck,
    Video,
    XCircle,
} from "lucide-react";
import { markAppointmentDebt, markAppointmentNoCharge, registerAppointmentPayment } from "@/app/actions/billing";
import {
    getReceptionAppointments,
    getAppointmentRemindersByDate,
    prepareAppointmentReminderDraft,
    retryAppointmentReminderSend,
    updateAppointmentStatus,
} from "@/app/actions/calendar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { INBOX_DRAFT_STORAGE_KEY, type InboxDraftPayload } from "@/lib/inbox-drafts";
import {
    formatOperationDayLabel,
    formatTimeInOperationZone,
    getOperationDateKey,
    getOperationTodayKey,
} from "@/lib/operation-dates";
import { useRouter, useSearchParams } from "next/navigation";

type ReceptionAppointment = Awaited<ReturnType<typeof getReceptionAppointments>>[number];
type AppointmentReminderRow = Awaited<ReturnType<typeof getAppointmentRemindersByDate>>[number];
type ReminderFilter = "all" | "pending" | "sent" | "issues";

const STATUS_LABELS: Record<string, string> = {
    scheduled: "Agendada",
    waiting: "En sala",
    called: "Llamado",
    in_progress: "En consulta",
    completed: "Completada",
    no_show: "No asistio",
    cancelled: "Cancelada",
};

function patientName(appointment: ReceptionAppointment) {
    return appointment.patient
        ? [appointment.patient.firstName, appointment.patient.lastName].filter(Boolean).join(" ")
        : appointment.contact?.name || appointment.title;
}

function statusTone(status: string) {
    if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "in_progress") return "bg-blue-50 text-blue-700 border-blue-200";
    if (status === "waiting" || status === "called") return "bg-amber-50 text-amber-700 border-amber-200";
    if (status === "cancelled" || status === "no_show") return "bg-red-50 text-red-700 border-red-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
}

function reminderTone(status: string) {
    if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
    if (status === "queued" || status === "sending") return "border-blue-200 bg-blue-50 text-blue-700";
    if (status === "skipped" || status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-500";
    return "border-slate-200 bg-slate-50 text-slate-700";
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
        return [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim() || "Cliente";
    }
    const contact = reminder.appointment.contact;
    return [contact?.name, contact?.lastName].filter(Boolean).join(" ").trim() || "Cliente";
}

function reminderClientPhone(reminder: AppointmentReminderRow) {
    return reminder.appointment.patient?.phone || reminder.appointment.contact?.phone || "Sin teléfono";
}

export default function ReceptionPage() {
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("date") || "")
        ? searchParams.get("date") || ""
        : "";
    const requestedFinishId = searchParams.get("finish") || "";
    const [isPending, startTransition] = useTransition();
    const selectedDateTouchedRef = useRef(Boolean(requestedDate));
    const finishHandledRef = useRef("");
    const [appointments, setAppointments] = useState<ReceptionAppointment[]>([]);
    const [selectedDate, setSelectedDate] = useState(requestedDate || getOperationTodayKey());
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        defaultCurrency: "MXN",
        timeZone: "America/Mexico_City",
    });
    const [closingAppointment, setClosingAppointment] = useState<ReceptionAppointment | null>(null);
    const [closingAmount, setClosingAmount] = useState("");
    const [closingPaymentMethod, setClosingPaymentMethod] = useState("efectivo");
    const [closingPaidWith, setClosingPaidWith] = useState("");
    const [closingNotes, setClosingNotes] = useState("");
    const [remindersOpen, setRemindersOpen] = useState(false);
    const [reminderDate, setReminderDate] = useState(getOperationTodayKey());
    const [reminderFilter, setReminderFilter] = useState<ReminderFilter>("all");
    const [reminders, setReminders] = useState<AppointmentReminderRow[]>([]);
    const [isLoadingReminders, setIsLoadingReminders] = useState(false);

    const formatMoney = useCallback(
        (amount?: number | null, currency = operationContext.defaultCurrency) =>
            new Intl.NumberFormat(operationContext.locale, {
                style: "currency",
                currency,
            }).format(amount || 0),
        [operationContext.defaultCurrency, operationContext.locale],
    );

    const load = useCallback(async () => {
        const data = await getReceptionAppointments(selectedDate);
        setAppointments(data);
    }, [selectedDate]);

    const loadReminders = useCallback(async () => {
        setIsLoadingReminders(true);
        try {
            const rows = await getAppointmentRemindersByDate(reminderDate);
            setReminders(rows);
        } catch {
            toast({
                title: "No se pudieron cargar los recordatorios",
                description: "Intenta nuevamente en unos segundos.",
                variant: "destructive",
            });
        } finally {
            setIsLoadingReminders(false);
        }
    }, [reminderDate, toast]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!remindersOpen) return;
        void loadReminders();
    }, [loadReminders, remindersOpen]);

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active || !context) return;
                const nextContext = {
                    locale: context.locale || "es-MX",
                    defaultCurrency: context.defaultCurrency || "MXN",
                    timeZone: context.timeZone || "America/Mexico_City",
                };
                setOperationContext({
                    locale: nextContext.locale,
                    defaultCurrency: nextContext.defaultCurrency,
                    timeZone: nextContext.timeZone,
                });
                if (!selectedDateTouchedRef.current) {
                    setSelectedDate(getOperationTodayKey(nextContext.timeZone));
                }
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const stats = useMemo(() => ({
        scheduled: appointments.filter((appointment) => appointment.status === "scheduled").length,
        waiting: appointments.filter((appointment) => ["waiting", "called"].includes(appointment.status)).length,
        inProgress: appointments.filter((appointment) => appointment.status === "in_progress").length,
        completed: appointments.filter((appointment) => appointment.status === "completed").length,
        paid: appointments.filter((appointment) => appointment.paymentStatus === "paid").length,
        pendingPayment: appointments.filter((appointment) => appointment.paymentStatus === "pending").length,
    }), [appointments]);

    const reminderStats = useMemo(() => ({
        pending: reminders.filter((reminder) => ["queued", "sending"].includes(reminder.status)).length,
        sent: reminders.filter((reminder) => reminder.status === "sent").length,
        issues: reminders.filter((reminder) => ["failed", "skipped", "cancelled"].includes(reminder.status)).length,
    }), [reminders]);

    const visibleReminders = useMemo(() => reminders.filter((reminder) => {
        if (reminderFilter === "pending") return ["queued", "sending"].includes(reminder.status);
        if (reminderFilter === "sent") return reminder.status === "sent";
        if (reminderFilter === "issues") return ["failed", "skipped", "cancelled"].includes(reminder.status);
        return true;
    }), [reminderFilter, reminders]);

    const runAction = (task: () => Promise<{ success: boolean; error?: string }>, successTitle: string) => {
        startTransition(async () => {
            const result = await task();
            if (!result.success) {
                toast({ title: "No se pudo completar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: successTitle });
            await load();
        });
    };

    const openFinishDialog = useCallback((appointment: ReceptionAppointment) => {
        setClosingAppointment(appointment);
        setClosingAmount(appointment.paymentAmount ? String(appointment.paymentAmount) : "");
        setClosingPaymentMethod("efectivo");
        setClosingPaidWith(appointment.paymentAmount ? String(appointment.paymentAmount) : "");
        setClosingNotes("");
    }, []);

    useEffect(() => {
        if (!requestedFinishId || finishHandledRef.current === requestedFinishId) return;
        const appointment = appointments.find((entry) => entry.id === requestedFinishId);
        if (!appointment) return;

        finishHandledRef.current = requestedFinishId;
        openFinishDialog(appointment);
        router.replace(`/dashboard/reception?date=${encodeURIComponent(selectedDate)}`, { scroll: false });
    }, [appointments, openFinishDialog, requestedFinishId, router, selectedDate]);

    const closeFinishDialog = () => {
        setClosingAppointment(null);
        setClosingAmount("");
        setClosingPaymentMethod("efectivo");
        setClosingPaidWith("");
        setClosingNotes("");
    };

    const finishAppointment = (mode: "paid" | "debt" | "no_charge") => {
        if (!closingAppointment) return;

        startTransition(async () => {
            const amount = Number(closingAmount);
            if ((mode === "paid" || mode === "debt") && (!Number.isFinite(amount) || amount <= 0)) {
                toast({ title: "Monto inválido", description: "Captura un monto mayor a cero.", variant: "destructive" });
                return;
            }

            if (mode === "paid") {
                const paymentResult = await registerAppointmentPayment(closingAppointment.id, amount, closingPaymentMethod);
                if (!paymentResult.success) {
                    toast({ title: "No se pudo cobrar", description: paymentResult.error, variant: "destructive" });
                    return;
                }
            }

            if (mode === "debt") {
                const debtResult = await markAppointmentDebt(closingAppointment.id, amount);
                if (!debtResult.success) {
                    toast({ title: "No se pudo dejar adeudo", description: debtResult.error, variant: "destructive" });
                    return;
                }
            }

            if (mode === "no_charge") {
                const noChargeResult = await markAppointmentNoCharge(closingAppointment.id);
                if (!noChargeResult.success) {
                    toast({ title: "No se pudo cerrar sin cobro", description: noChargeResult.error, variant: "destructive" });
                    return;
                }
            }

            const statusResult = await updateAppointmentStatus(closingAppointment.id, "completed");
            if (!statusResult.success) {
                toast({ title: "No se pudo finalizar", description: statusResult.error, variant: "destructive" });
                return;
            }

            toast({
                title: mode === "paid"
                    ? "Consulta finalizada y cobro registrado"
                    : mode === "debt"
                        ? "Consulta finalizada con adeudo"
                        : "Consulta finalizada sin cobro",
            });
            closeFinishDialog();
            await load();
        });
    };

    const closingTotal = Number(closingAmount || 0);
    const closingReceived = Number(closingPaidWith || 0);
    const closingChange = closingPaymentMethod === "efectivo"
        ? Math.max((Number.isFinite(closingReceived) ? closingReceived : 0) - (Number.isFinite(closingTotal) ? closingTotal : 0), 0)
        : 0;

    const prepareNotification = (appointment: ReceptionAppointment) => {
        startTransition(async () => {
            const result = await prepareAppointmentReminderDraft(appointment.id);
            if (!result.success) {
                toast({ title: "No se pudo preparar la notificación", description: result.error, variant: "destructive" });
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
            window.sessionStorage.setItem(INBOX_DRAFT_STORAGE_KEY, JSON.stringify(draft));
            router.push(`/dashboard/inbox?conversationId=${encodeURIComponent(result.conversationId)}&draft=appointment-reminder`);
        });
    };

    const retryReminder = (reminderId: string, label: string) => {
        startTransition(async () => {
            const result = await retryAppointmentReminderSend(reminderId);
            if (!result.success) {
                toast({ title: "No se pudo reenviar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: `Recordatorio ${label} reenviado` });
            await Promise.all([load(), loadReminders()]);
        });
    };

    return (
        <>
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <ClipboardCheck className="h-6 w-6 text-primary" />
                        Recepcion
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Sala de espera, confirmaciones, sobreturnos y recordatorios operativos del dia.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        type="date"
                        value={selectedDate}
                        onChange={(event) => {
                            selectedDateTouchedRef.current = true;
                            setSelectedDate(event.target.value);
                        }}
                        className="h-10 w-full bg-background sm:w-[170px]"
                    />
                    <Button variant="outline" onClick={load} disabled={isPending}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refrescar
                    </Button>
                    <Button
                        onClick={() => {
                            setReminderDate(selectedDate);
                            setReminderFilter("all");
                            setRemindersOpen(true);
                        }}
                    >
                        <BellRing className="mr-2 h-4 w-4" />
                        Ver recordatorios
                    </Button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Agendadas</p>
                    <p className="mt-2 text-2xl font-bold">{stats.scheduled}</p>
                </div>
                <div className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">En sala</p>
                    <p className="mt-2 text-2xl font-bold">{stats.waiting}</p>
                </div>
                <div className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">En consulta</p>
                    <p className="mt-2 text-2xl font-bold">{stats.inProgress}</p>
                </div>
                <div className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="text-sm text-muted-foreground">Completadas</p>
                    <p className="mt-2 text-2xl font-bold">{stats.completed}</p>
                </div>
                <div className="rounded-2xl border bg-card p-4 shadow-sm xl:col-span-2">
                    <p className="text-sm text-muted-foreground">Cobranza</p>
                    <p className="mt-2 text-2xl font-bold">{stats.paid} pagadas</p>
                    <p className="text-xs text-muted-foreground">{stats.pendingPayment} pendientes de pago</p>
                </div>
            </div>

            <div className="rounded-2xl border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b px-5 py-4">
                    <div>
                        <h2 className="font-semibold">Agenda del dia</h2>
                        <p className="text-sm text-muted-foreground">
                            {formatOperationDayLabel(selectedDate, operationContext.locale, operationContext.timeZone)}
                        </p>
                    </div>
                    {isPending ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
                </div>

                <div className="divide-y">
                    {appointments.map((appointment) => {
                        const specialistName = appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName;
                        const appointmentStarted = new Date(appointment.startTime).getTime() <= Date.now();
                        const isClosed = ["completed", "cancelled", "no_show"].includes(appointment.status);
                        const notificationLocked = appointmentStarted || isClosed;
                        const notificationLockText = isClosed
                            ? "Esta cita ya está cerrada y no se puede notificar."
                            : "Cita vencida. La notificación manual ya no está disponible.";
                        return (
                            <div key={appointment.id} className="grid gap-4 px-5 py-4 xl:grid-cols-[180px_minmax(0,1fr)_auto] xl:items-center">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                        <CalendarClock className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-semibold">{formatTimeInOperationZone(appointment.startTime, operationContext.locale, operationContext.timeZone, { hour12: false })}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {Math.round((new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime()) / 60000)} min
                                        </p>
                                    </div>
                                </div>

                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate font-semibold text-foreground">{patientName(appointment)}</h3>
                                        <Badge variant="outline" className={statusTone(appointment.status)}>
                                            {STATUS_LABELS[appointment.status] || appointment.status}
                                        </Badge>
                                        {appointment.isOverbook ? <Badge variant="secondary">Sobreturno</Badge> : null}
                                        {appointment.source === "portal" ? <Badge variant="outline">Portal</Badge> : null}
                                        {appointment.confirmationStatus === "confirmed" ? <Badge variant="outline">Confirmada</Badge> : null}
                                        {appointmentStarted ? (
                                            <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-600">
                                                <LockKeyhole className="h-3 w-3" />
                                                Cita vencida
                                            </Badge>
                                        ) : null}
                                        {appointment.visitMode && appointment.visitMode !== "presencial" ? (
                                            <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
                                                <Video className="h-3 w-3" />
                                                {appointment.visitMode === "hibrida" ? "Hibrida" : "Virtual"}
                                            </Badge>
                                        ) : null}
                                        {appointment.paymentStatus === "paid" ? (
                                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                                Pagada {appointment.paymentAmount ? formatMoney(appointment.paymentAmount, appointment.paymentCurrency || operationContext.defaultCurrency) : ""}
                                            </Badge>
                                        ) : appointment.paymentStatus === "pending" ? (
                                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                                Pago pendiente {appointment.paymentAmount ? formatMoney(appointment.paymentAmount, appointment.paymentCurrency || operationContext.defaultCurrency) : ""}
                                            </Badge>
                                        ) : null}
                                        {appointment.appointmentReminders?.map((reminder) => (
                                            <Badge key={reminder.id} variant="outline" className={reminderTone(reminder.status)}>
                                                {reminder.label}: {reminderStatusLabel(reminder.status)}
                                            </Badge>
                                        ))}
                                    </div>
                                    <p className="mt-1 text-sm text-muted-foreground">{appointment.title}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {specialistName || "Sin especialista"} · {appointment.patient?.phone || appointment.contact?.phone || "Sin telefono"}
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2 xl:justify-end">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => runAction(() => updateAppointmentStatus(appointment.id, "confirmed"), "Cita confirmada")}
                                    >
                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                        Confirmar
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => runAction(() => updateAppointmentStatus(appointment.id, "waiting"), "Paciente listo en sala")}>
                                        <UserCheck className="mr-2 h-4 w-4" />
                                        En sala
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => runAction(() => updateAppointmentStatus(appointment.id, "in_progress"), "Consulta iniciada")}>
                                        Iniciar
                                    </Button>
                                    <Button size="sm" onClick={() => openFinishDialog(appointment)}>
                                        Finalizar
                                    </Button>
                                    {appointment.meetLink ? (
                                        <Button size="sm" variant="outline" asChild>
                                            <a href={appointment.meetLink} target="_blank" rel="noreferrer">
                                                <Video className="mr-2 h-4 w-4" />
                                                Meet
                                            </a>
                                        </Button>
                                    ) : null}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => prepareNotification(appointment)}
                                        disabled={notificationLocked || isPending}
                                        title={notificationLocked ? notificationLockText : "Preparar notificación en Chats"}
                                        className="gap-2"
                                    >
                                        {notificationLocked ? <LockKeyhole className="h-4 w-4" /> : <WhatsAppIcon className="h-4 w-4" />}
                                        Notificar
                                    </Button>
                                    {appointment.appointmentReminders
                                        ?.filter((reminder) => reminder.status === "failed")
                                        .map((reminder) => (
                                            <Button
                                                key={reminder.id}
                                                size="sm"
                                                variant="outline"
                                                onClick={() => runAction(() => retryAppointmentReminderSend(reminder.id), `Recordatorio ${reminder.label} reenviado`)}
                                            >
                                                <WhatsAppIcon className="mr-2 h-4 w-4" />
                                                Reintentar {reminder.label}
                                            </Button>
                                        ))}
                                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => runAction(() => updateAppointmentStatus(appointment.id, "no_show"), "Marcada como no asistio")}>
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Ausente
                                    </Button>
                                </div>
                            </div>
                        );
                    })}

                    {appointments.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                            No hay citas para esta fecha.
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
        <Dialog open={remindersOpen} onOpenChange={setRemindersOpen}>
            <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(96vw,62rem)] max-w-[min(96vw,62rem)] flex-col overflow-hidden rounded-2xl p-0">
                <DialogHeader className="shrink-0 border-b px-5 py-4 sm:px-6 sm:py-5">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <BellRing className="h-5 w-5 text-primary" />
                        Recordatorios programados
                    </DialogTitle>
                    <DialogDescription>
                        Consulta qué mensajes se enviarán, cuáles ya salieron y cuáles requieren atención. El envío continúa funcionando automáticamente.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid min-w-0 shrink-0 gap-3 border-b bg-muted/15 px-5 py-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:px-6">
                    <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="reminder-date">Fecha de envío</Label>
                        <Input
                            id="reminder-date"
                            type="date"
                            value={reminderDate}
                            onChange={(event) => setReminderDate(event.target.value)}
                            className="min-w-0 bg-background"
                        />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                        <Label>Estado</Label>
                        <Select value={reminderFilter} onValueChange={(value) => setReminderFilter(value as ReminderFilter)}>
                            <SelectTrigger className="w-full min-w-0 bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos los recordatorios</SelectItem>
                                <SelectItem value="pending">Por enviar</SelectItem>
                                <SelectItem value="sent">Enviados</SelectItem>
                                <SelectItem value="issues">Con problemas</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex min-w-0 items-end sm:col-span-2 sm:justify-end">
                        <Button variant="outline" onClick={loadReminders} disabled={isLoadingReminders} className="w-full min-w-0 sm:w-auto">
                            {isLoadingReminders ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Actualizar
                        </Button>
                    </div>
                </div>

                <div className="grid shrink-0 grid-cols-3 gap-2 px-5 pt-4 sm:gap-3 sm:px-6">
                    <button type="button" onClick={() => setReminderFilter("pending")} className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40">
                        <p className="text-xl font-bold text-foreground">{reminderStats.pending}</p>
                        <p className="truncate text-[11px] text-muted-foreground">Por enviar</p>
                    </button>
                    <button type="button" onClick={() => setReminderFilter("sent")} className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40">
                        <p className="text-xl font-bold text-emerald-700">{reminderStats.sent}</p>
                        <p className="truncate text-[11px] text-muted-foreground">Enviados</p>
                    </button>
                    <button type="button" onClick={() => setReminderFilter("issues")} className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40">
                        <p className="text-xl font-bold text-amber-700">{reminderStats.issues}</p>
                        <p className="truncate text-[11px] text-muted-foreground">Con atención</p>
                    </button>
                </div>

                <ScrollArea className="min-h-0 flex-1 px-5 py-4 sm:px-6">
                    {isLoadingReminders && reminders.length === 0 ? (
                        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Cargando recordatorios…
                        </div>
                    ) : visibleReminders.length === 0 ? (
                        <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
                            <BellRing className="mb-3 h-8 w-8 text-muted-foreground/60" />
                            <p className="font-semibold text-foreground">No hay recordatorios para este filtro</p>
                            <p className="mt-1 max-w-md text-sm text-muted-foreground">
                                Prueba otra fecha o revisa que las citas estén confirmadas y los recordatorios automáticos estén activos.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3 pb-1">
                            {visibleReminders.map((reminder) => {
                                const specialistName = reminder.appointment.specialist?.displayName || reminder.appointment.specialist?.name || "Sin especialista";
                                return (
                                    <div key={reminder.id} className="rounded-2xl border bg-card p-4">
                                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                                    <BellRing className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="truncate font-semibold text-foreground">{reminderClientName(reminder)}</h3>
                                                        <Badge variant="outline" className={reminderTone(reminder.status)}>
                                                            {reminderStatusLabel(reminder.status)}
                                                        </Badge>
                                                        <Badge variant="secondary">{reminder.label}</Badge>
                                                    </div>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Envío: {formatTimeInOperationZone(reminder.scheduledFor, operationContext.locale, operationContext.timeZone)} · WhatsApp {reminderClientPhone(reminder)}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        Cita: {formatOperationDayLabel(getOperationDateKey(reminder.appointment.startTime, operationContext.timeZone), operationContext.locale, operationContext.timeZone)} a las {formatTimeInOperationZone(reminder.appointment.startTime, operationContext.locale, operationContext.timeZone)} · {specialistName}
                                                    </p>
                                                    {reminder.lastError ? (
                                                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                                                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                            {reminder.lastError}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2 md:justify-end">
                                                <span className="text-xs text-muted-foreground">{reminder.attempts} intento{reminder.attempts === 1 ? "" : "s"}</span>
                                                {reminder.status === "failed" ? (
                                                    <Button size="sm" variant="outline" onClick={() => retryReminder(reminder.id, reminder.label)} disabled={isPending}>
                                                        <RefreshCw className="mr-2 h-4 w-4" />
                                                        Reintentar
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>

                <DialogFooter className="shrink-0 border-t px-5 py-3 sm:px-6">
                    <Button variant="outline" onClick={() => setRemindersOpen(false)}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={Boolean(closingAppointment)} onOpenChange={(open) => {
            if (!open) closeFinishDialog();
        }}>
            <DialogContent className="flex max-h-[calc(100vh-2rem)] w-[min(96vw,46rem)] max-w-[min(96vw,46rem)] flex-col overflow-hidden rounded-2xl p-0">
                <DialogHeader className="shrink-0 border-b px-5 py-4 sm:px-6 sm:py-5">
                    <DialogTitle className="flex items-center gap-2 text-xl leading-none">
                        <CreditCard className="h-5 w-5 text-primary" />
                        Finalizar consulta
                    </DialogTitle>
                    <DialogDescription>
                        Elige si se cobra ahora, queda como adeudo para plan de pago o se cierra sin generar saldo.
                    </DialogDescription>
                </DialogHeader>

                {closingAppointment ? (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                        <div className="rounded-2xl border bg-muted/20 p-4">
                            <p className="text-sm text-muted-foreground">Paciente</p>
                            <p className="mt-1 text-lg font-semibold">{patientName(closingAppointment)}</p>
                            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                                <span>{closingAppointment.title}</span>
                                <span>
                                    {formatTimeInOperationZone(closingAppointment.startTime, operationContext.locale, operationContext.timeZone, { hour12: true })}
                                </span>
                            </div>
                            {closingAppointment.paymentStatus === "paid" ? (
                                <Badge variant="outline" className="mt-3 border-emerald-200 bg-emerald-50 text-emerald-700">
                                    Pago registrado {formatMoney(closingAppointment.paymentAmount, closingAppointment.paymentCurrency || operationContext.defaultCurrency)}
                                </Badge>
                            ) : null}
                        </div>

                        <div className="rounded-2xl border bg-background p-4 text-center sm:p-5">
                            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Total a cobrar</p>
                            <p className="mt-2 text-4xl font-bold text-primary sm:text-5xl">{formatMoney(closingTotal || 0, closingAppointment.paymentCurrency || operationContext.defaultCurrency)}</p>
                        </div>

                        <div
                            className="grid gap-3"
                            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8.75rem, 1fr))" }}
                        >
                            {[
                                { value: "efectivo", label: "Efectivo", Icon: Banknote },
                                { value: "tarjeta", label: "Tarjeta", Icon: CreditCard },
                                { value: "transferencia", label: "Transferencia", Icon: Landmark },
                                { value: "link", label: "Link", Icon: LinkIcon },
                            ].map(({ value, label, Icon }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setClosingPaymentMethod(value)}
                                    className={`min-h-[6.25rem] min-w-0 rounded-2xl border px-2 py-4 text-center font-semibold transition ${
                                        closingPaymentMethod === value
                                            ? "border-primary bg-primary/10 text-primary shadow-sm"
                                            : "bg-muted/20 hover:border-primary/40"
                                    }`}
                                >
                                    <Icon className="mx-auto mb-2 h-5 w-5" />
                                    <span className="block whitespace-normal break-words text-center text-[13px] leading-tight sm:text-sm">
                                        {label}
                                    </span>
                                </button>
                            ))}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                            <div className="space-y-2">
                                <Label htmlFor="closing-amount">Monto</Label>
                                <Input
                                    id="closing-amount"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={closingAmount}
                                    onChange={(event) => {
                                        setClosingAmount(event.target.value);
                                        if (!closingPaidWith || closingPaidWith === closingAmount) setClosingPaidWith(event.target.value);
                                    }}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{closingPaymentMethod === "efectivo" ? "Pago con" : "Referencia"}</Label>
                                <Input
                                    type={closingPaymentMethod === "efectivo" ? "number" : "text"}
                                    min="0"
                                    step="0.01"
                                    value={closingPaidWith}
                                    onChange={(event) => setClosingPaidWith(event.target.value)}
                                    placeholder={closingPaymentMethod === "efectivo" ? "0.00" : "Referencia opcional"}
                                />
                            </div>
                        </div>
                        {closingPaymentMethod === "efectivo" ? (
                            <div className="grid gap-3 rounded-2xl border bg-emerald-50 p-4 text-sm text-emerald-900 sm:grid-cols-3">
                                <div>
                                    <p className="text-emerald-700">Total</p>
                                    <p className="text-lg font-bold">{formatMoney(closingTotal || 0, closingAppointment.paymentCurrency || operationContext.defaultCurrency)}</p>
                                </div>
                                <div>
                                    <p className="text-emerald-700">Pago con</p>
                                    <p className="text-lg font-bold">{formatMoney(closingReceived || 0, closingAppointment.paymentCurrency || operationContext.defaultCurrency)}</p>
                                </div>
                                <div>
                                    <p className="text-emerald-700">Cambio</p>
                                    <p className="text-lg font-bold">{formatMoney(closingChange, closingAppointment.paymentCurrency || operationContext.defaultCurrency)}</p>
                                </div>
                            </div>
                        ) : null}
                        <div className="space-y-2">
                            <Label>Notas internas</Label>
                            <Textarea
                                value={closingNotes}
                                onChange={(event) => setClosingNotes(event.target.value)}
                                rows={2}
                                placeholder="Notas del cobro, referencia o comentario de caja..."
                            />
                        </div>
                        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                            <p><span className="font-semibold">Dejar adeudo:</span> conserva el saldo pendiente para cobrarlo después o integrarlo a un plan de pago.</p>
                            <p className="mt-1"><span className="font-semibold">Sin cobro:</span> cierra la cita sin generar deuda ni movimiento de caja.</p>
                        </div>
                    </div>
                ) : null}

                <DialogFooter className="shrink-0 gap-2 border-t bg-muted/20 px-5 py-4 sm:flex-nowrap sm:justify-end sm:px-6">
                    <Button
                        className="w-full sm:w-auto"
                        variant="outline"
                        onClick={() => finishAppointment("debt")}
                        disabled={isPending || closingAppointment?.paymentStatus === "paid"}
                    >
                        Dejar adeudo
                    </Button>
                    <Button
                        className="w-full sm:w-auto"
                        variant="outline"
                        onClick={closeFinishDialog}
                        disabled={isPending}
                    >
                        Cancelar
                    </Button>
                    <Button
                        className="w-full sm:w-auto sm:min-w-[13.5rem]"
                        onClick={() => finishAppointment("paid")}
                        disabled={isPending}
                    >
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                        {closingAppointment?.paymentStatus === "paid" ? "Confirmar cobro y finalizar" : "Cobrar y finalizar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}
