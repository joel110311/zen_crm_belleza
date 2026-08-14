"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    CalendarPlus,
    Check,
    CheckCircle2,
    CheckSquare2,
    ChevronLeft,
    ChevronRight,
    Crown,
    Download,
    Phone,
    RotateCw,
    Search,
    Sparkles,
    X,
} from "lucide-react";

import { deleteAppointment, updateAppointmentStatus } from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { AppointmentDialog } from "@/components/calendar/appointment-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { ContactActions } from "@/components/contacts/contact-actions";
import { ContactsBulkCampaignDialog } from "@/components/contacts/contacts-bulk-campaign-dialog";
import { ContactsBulkDeleteDialog } from "@/components/contacts/contacts-bulk-delete-dialog";
import { useToast } from "@/components/ui/use-toast";
import { getContactFullName } from "@/lib/contact-name";
import { normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { getOperationDateKey } from "@/lib/operation-dates";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type ClientAppointment = {
    id: string;
    title: string;
    appointmentType: string | null;
    serviceId: string | null;
    patientId: string | null;
    specialistId: string | null;
    notes: string | null;
    source: string;
    isOverbook: boolean;
    visitMode: string;
    meetStatus: string;
    meetLink: string | null;
    paymentStatus: string;
    paymentAmount: number;
    paymentCurrency: string;
    remindersOptOut: boolean;
    googleCalendarId: string | null;
    startTime: string | Date;
    endTime: string | Date;
    status: string;
    confirmationStatus: string;
};

type ContactTableItem = {
    id: string;
    name: string | null;
    lastName: string | null;
    phone: string | null;
    tags: string[];
    createdAt: string | Date;
    whatsappAvatarUrl: string | null;
    appointments: ClientAppointment[];
    patients: Array<{
        id: string;
        appointments: ClientAppointment[];
    }>;
};

interface ContactsPageProps {
    contacts: ContactTableItem[];
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const CLOSED_APPOINTMENT_STATUSES = new Set(["completed", "cancelled", "no_show"]);

function normalizeContactSearch(value: string) {
    return value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("es-MX")
        .trim();
}

function uniqueAppointments(contact: ContactTableItem) {
    const appointments = new Map<string, ClientAppointment>();
    for (const appointment of contact.appointments) appointments.set(appointment.id, appointment);
    for (const patient of contact.patients) {
        for (const appointment of patient.appointments) appointments.set(appointment.id, appointment);
    }
    return Array.from(appointments.values());
}

function serviceLabel(appointment: ClientAppointment) {
    const type = appointment.appointmentType?.trim();
    if (type && type.toLocaleLowerCase("es-MX") !== "consulta") return type;
    return appointment.title?.trim() || "Servicio";
}

function getClientMetrics(contact: ContactTableItem) {
    const appointments = uniqueAppointments(contact);
    const attendedCount = appointments.filter((appointment) => appointment.status === "completed").length;
    const serviceFrequency = new Map<string, number>();

    for (const appointment of appointments.filter((entry) => entry.status === "completed")) {
        const label = serviceLabel(appointment);
        serviceFrequency.set(label, (serviceFrequency.get(label) || 0) + 1);
    }

    const favoriteService = Array.from(serviceFrequency.entries())
        .sort((left, right) => right[1] - left[1])[0]?.[0] || "Sin servicios todavía";
    const nextAppointment = appointments
        .filter((appointment) => new Date(appointment.startTime) >= new Date() && !CLOSED_APPOINTMENT_STATUSES.has(appointment.status))
        .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())[0] || null;
    const tags = contact.tags.filter((tag) => {
        const normalized = tag.toLocaleLowerCase("es-MX");
        return !normalized.startsWith("entry_global_") && !normalized.startsWith("entryapp_");
    });
    if (attendedCount >= 2 && !tags.some((tag) => tag.toLocaleLowerCase("es-MX") === "recurrente")) tags.push("recurrente");
    if (attendedCount >= 5 && !tags.some((tag) => tag.toLocaleLowerCase("es-MX") === "vip")) tags.push("vip");

    const actionAppointment = nextAppointment || appointments
        .filter((appointment) => !["cancelled", "no_show"].includes(appointment.status))
        .sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime())[0] || null;

    return { attendedCount, favoriteService, actionAppointment, tags };
}

function tagClasses(tag: string) {
    const normalized = tag.toLocaleLowerCase("es-MX");
    if (normalized === "vip") return "border-amber-200 bg-amber-50 text-amber-700";
    if (normalized === "recurrente") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-primary/15 bg-primary/5 text-primary";
}

export function ContactsTable({ contacts }: ContactsPageProps) {
    const router = useRouter();
    const { data: session } = useSession();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [searchTerm, setSearchTerm] = useState("");
    const [rawSelectedContactIds, setRawSelectedContactIds] = useState<string[]>([]);
    const [confirmingAppointmentId, setConfirmingAppointmentId] = useState<string | null>(null);
    const [completingAppointmentId, setCompletingAppointmentId] = useState<string | null>(null);
    const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
    const [appointmentClient, setAppointmentClient] = useState<ContactTableItem | null>(null);
    const [editingAppointment, setEditingAppointment] = useState<ClientAppointment | null>(null);
    const [businessHours, setBusinessHours] = useState(() => normalizeBusinessHours());

    const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined;
    const canManageCampaigns = hasPermission(sessionUser, "campaigns.manage");
    const canConfirmAppointments = hasAnyPermission(sessionUser, ["calendar.manage", "reception.manage"]);
    const canManageCalendar = hasPermission(sessionUser, "calendar.manage");
    const clientRows = useMemo(() => {
        const normalizedTerm = normalizeContactSearch(searchTerm);
        const searchDigits = searchTerm.replace(/\D/g, "");

        return contacts
            .filter((contact) => {
                if (!normalizedTerm && !searchDigits) return true;
                const fullName = normalizeContactSearch(getContactFullName(contact, "Sin nombre"));
                const phone = contact.phone || "";
                const phoneDigits = phone.replace(/\D/g, "");
                return fullName.includes(normalizedTerm)
                    || normalizeContactSearch(phone).includes(normalizedTerm)
                    || (searchDigits.length > 0 && phoneDigits.includes(searchDigits));
            })
            .map((contact) => ({ contact, metrics: getClientMetrics(contact) }));
    }, [contacts, searchTerm]);
    const totalPages = Math.max(1, Math.ceil(clientRows.length / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const pagedRows = useMemo(() => {
        const start = (safePage - 1) * pageSize;
        return clientRows.slice(start, start + pageSize);
    }, [clientRows, pageSize, safePage]);
    const validContactIds = useMemo(() => new Set(contacts.map((contact) => contact.id)), [contacts]);
    const selectedContactIds = useMemo(
        () => rawSelectedContactIds.filter((contactId) => validContactIds.has(contactId)),
        [rawSelectedContactIds, validContactIds],
    );
    const selectedContactIdSet = useMemo(() => new Set(selectedContactIds), [selectedContactIds]);
    const selectedContacts = useMemo(
        () => contacts.filter((contact) => selectedContactIdSet.has(contact.id)),
        [contacts, selectedContactIdSet],
    );
    const currentPageSelectedCount = pagedRows.filter(({ contact }) => selectedContactIdSet.has(contact.id)).length;
    const pageSelectionState = pagedRows.length === 0
        ? false
        : currentPageSelectedCount === pagedRows.length
            ? true
            : currentPageSelectedCount > 0
                ? "indeterminate"
                : false;

    useEffect(() => {
        let active = true;
        void getSystemSettings()
            .then((settings) => {
                if (active) setBusinessHours(normalizeBusinessHours(settings));
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const handleRefresh = () => startTransition(() => router.refresh());
    const clearSelection = () => setRawSelectedContactIds([]);
    const handleRowSelection = (contactId: string, checked: boolean) => {
        setRawSelectedContactIds((current) => {
            const next = new Set(current.filter((entry) => validContactIds.has(entry)));
            if (checked) next.add(contactId);
            else next.delete(contactId);
            return Array.from(next);
        });
    };
    const handlePageSelection = (checked: boolean) => {
        setRawSelectedContactIds((current) => {
            const next = new Set(current.filter((entry) => validContactIds.has(entry)));
            for (const { contact } of pagedRows) {
                if (checked) next.add(contact.id);
                else next.delete(contact.id);
            }
            return Array.from(next);
        });
    };
    const handlePageSizeChange = (value: string) => {
        const nextPageSize = Number.parseInt(value, 10);
        if (!PAGE_SIZE_OPTIONS.includes(nextPageSize)) return;
        setPageSize(nextPageSize);
        setCurrentPage(1);
    };
    const handleExport = () => {
        const clientsToExport = selectedContacts.length > 0 ? selectedContacts : contacts;
        const rows = clientsToExport.map((contact) => {
            const metrics = getClientMetrics(contact);
            return [
                getContactFullName(contact, "Sin nombre"),
                contact.phone || "",
                metrics.tags.join(" | "),
                String(metrics.attendedCount),
                metrics.favoriteService,
            ];
        });
        const csv = [
            ["Nombre", "Telefono", "Etiquetas", "Atenciones", "Servicio favorito"].join(","),
            ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
        ].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = selectedContacts.length > 0 ? "clientes-seleccionados.csv" : "clientes.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    const handleConfirmAppointment = async (appointmentId: string) => {
        setConfirmingAppointmentId(appointmentId);
        try {
            const result = await updateAppointmentStatus(appointmentId, "confirmed");
            if (!result.success) throw new Error(result.error || "No se pudo confirmar.");
            toast({ title: "Reserva confirmada", description: "Ya aparece como cita confirmada en el calendario." });
            router.refresh();
        } catch (error) {
            toast({
                title: "No se pudo confirmar",
                description: error instanceof Error ? error.message : "Inténtalo nuevamente.",
                variant: "destructive",
            });
        } finally {
            setConfirmingAppointmentId(null);
        }
    };
    const handleCompleteAppointment = (appointment: ClientAppointment) => {
        setCompletingAppointmentId(appointment.id);
        const appointmentDate = getOperationDateKey(appointment.startTime, businessHours.timeZone);
        router.push(`/dashboard/reception?date=${encodeURIComponent(appointmentDate)}&finish=${encodeURIComponent(appointment.id)}`);
    };
    const openAppointmentDialog = (contact: ContactTableItem) => {
        setAppointmentClient(contact);
        setEditingAppointment(null);
        setAppointmentDialogOpen(true);
    };
    const openRescheduleDialog = (contact: ContactTableItem, appointment: ClientAppointment) => {
        setAppointmentClient(contact);
        setEditingAppointment(appointment);
        setAppointmentDialogOpen(true);
    };
    const handleDeleteAppointment = async (appointment: ClientAppointment) => {
        if (!confirm(`¿Eliminar la cita "${appointment.title}"?`)) return;
        try {
            const result = await deleteAppointment(appointment.id);
            if (!result.success) throw new Error(result.error || "No se pudo eliminar la cita.");
            toast({ title: "Cita eliminada", description: "El horario volvió a quedar disponible." });
            startTransition(() => router.refresh());
        } catch (error) {
            toast({
                title: "No se pudo eliminar la cita",
                description: error instanceof Error ? error.message : "Inténtalo nuevamente.",
                variant: "destructive",
            });
        }
    };

    const filteredContactCount = clientRows.length;
    const currentRangeStart = filteredContactCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const currentRangeEnd = Math.min(safePage * pageSize, filteredContactCount);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="shrink-0 border-b border-border px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">Clientes</h1>
                            <span className="text-sm text-muted-foreground">({contacts.length} total)</span>
                        </div>
                        <div className="relative mt-3 w-full sm:max-w-[360px]">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="text"
                                inputMode="search"
                                role="searchbox"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Buscar por nombre o número..."
                                aria-label="Buscar clientes por nombre o número"
                                className="h-10 rounded-xl bg-background pl-10 pr-10 text-sm shadow-none"
                            />
                            {searchTerm ? (
                                <button
                                    type="button"
                                    onClick={() => setSearchTerm("")}
                                    aria-label="Limpiar búsqueda"
                                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-1 hidden text-sm text-muted-foreground md:inline">
                            Mostrando {currentRangeStart}-{currentRangeEnd} de {filteredContactCount}
                        </span>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={handleRefresh} disabled={isPending} aria-label="Actualizar clientes">
                            <RotateCw className={cn("h-4 w-4", isPending && "animate-spin")} />
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={handleExport} aria-label="Exportar clientes">
                            <Download className="h-4 w-4" />
                        </Button>
                        <NewContactDialog />
                    </div>
                </div>

                {selectedContacts.length > 0 ? (
                    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-2 text-sm text-foreground">
                            <CheckSquare2 className="h-4 w-4 text-primary" />
                            <span className="font-semibold">{selectedContacts.length}</span>
                            <span>cliente{selectedContacts.length === 1 ? "" : "s"} seleccionado{selectedContacts.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {selectedContacts.length < contacts.length ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => setRawSelectedContactIds(contacts.map((contact) => contact.id))}>
                                    Seleccionar los {contacts.length}
                                </Button>
                            ) : null}
                            <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                                <X className="mr-2 h-4 w-4" /> Limpiar
                            </Button>
                            {canManageCampaigns ? <ContactsBulkCampaignDialog contacts={selectedContacts} onCreated={clearSelection} /> : null}
                            <ContactsBulkDeleteDialog
                                contacts={selectedContacts}
                                onDeleted={() => {
                                    clearSelection();
                                    startTransition(() => router.refresh());
                                }}
                            />
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-card">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="w-12">
                                <Checkbox checked={pageSelectionState} onCheckedChange={(checked) => handlePageSelection(checked === true)} aria-label="Seleccionar clientes de esta página" />
                            </TableHead>
                            <TableHead className="min-w-[230px]">Cliente</TableHead>
                            <TableHead className="hidden md:table-cell">Tags</TableHead>
                            <TableHead className="w-24 text-center">Atenciones</TableHead>
                            <TableHead className="hidden lg:table-cell">Servicio favorito</TableHead>
                            <TableHead className="w-[120px] text-right">Chat</TableHead>
                            <TableHead className="min-w-[330px] text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pagedRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-40 text-center text-muted-foreground">
                                    {searchTerm.trim()
                                        ? "No encontramos clientes con ese nombre o número."
                                        : "Todavía no hay clientes registrados."}
                                </TableCell>
                            </TableRow>
                        ) : pagedRows.map(({ contact, metrics }) => {
                            const fullName = getContactFullName(contact, "Sin nombre");
                            const isSelected = selectedContactIdSet.has(contact.id);
                            const actionAppointment = metrics.actionAppointment;
                            const isAttended = actionAppointment?.status === "completed";
                            const isConfirmed = actionAppointment?.confirmationStatus === "confirmed";
                            return (
                                <TableRow key={contact.id} className={cn("group", isSelected && "bg-primary/5")}>
                                    <TableCell>
                                        <Checkbox checked={isSelected} onCheckedChange={(checked) => handleRowSelection(contact.id, checked === true)} aria-label={`Seleccionar ${fullName}`} />
                                    </TableCell>
                                    <TableCell>
                                        <div className="block min-w-[210px]">
                                            <span className="block truncate font-semibold text-foreground">{fullName}</span>
                                            <span className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
                                                <Phone className="h-3.5 w-3.5" /> {contact.phone || "Sin teléfono"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell">
                                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                                            {metrics.tags.slice(0, 3).map((tag) => (
                                                <span key={tag} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", tagClasses(tag))}>
                                                    {tag.toLocaleLowerCase("es-MX") === "vip" ? <Crown className="h-3 w-3" /> : null}{tag}
                                                </span>
                                            ))}
                                            {metrics.tags.length === 0 ? <span className="text-xs text-muted-foreground">Sin tags</span> : null}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <span className="inline-flex min-w-10 items-center justify-center rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">{metrics.attendedCount}</span>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        <span className="inline-flex items-center gap-2 text-sm text-foreground"><Sparkles className="h-4 w-4 text-gold" />{metrics.favoriteService}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {contact.id ? (
                                            <Link
                                                href={`/dashboard/inbox?contactId=${encodeURIComponent(contact.id)}`}
                                                aria-label={`Abrir conversación de ${fullName}`}
                                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10"
                                            >
                                                <WhatsAppIcon className="h-3.5 w-3.5" /> Ir al chat
                                            </Link>
                                        ) : <span className="text-xs text-muted-foreground">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex min-w-max items-center justify-end gap-1.5">
                                            <Button type="button" variant="outline" className="h-9 gap-2 rounded-full px-3" onClick={() => openAppointmentDialog(contact)}>
                                                <CalendarPlus className="h-4 w-4" /> Cita
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-9 gap-2 rounded-full px-3"
                                                disabled={!canConfirmAppointments || !actionAppointment || isConfirmed || isAttended || confirmingAppointmentId === actionAppointment.id}
                                                onClick={() => actionAppointment && void handleConfirmAppointment(actionAppointment.id)}
                                            >
                                                <Check className="h-4 w-4" /> Confirmar
                                            </Button>
                                            <Button
                                                type="button"
                                                className={cn("h-9 gap-2 rounded-full px-3", isAttended && "bg-emerald-600 hover:bg-emerald-600")}
                                                disabled={!canConfirmAppointments || !actionAppointment || actionAppointment.paymentStatus === "paid" || completingAppointmentId === actionAppointment.id}
                                                onClick={() => actionAppointment && handleCompleteAppointment(actionAppointment)}
                                            >
                                                <CheckCircle2 className="h-4 w-4" /> Atendido
                                            </Button>
                                            <ContactActions
                                                clientName={fullName}
                                                hasAppointment={Boolean(actionAppointment)}
                                                disabled={!canManageCalendar}
                                                onReschedule={() => actionAppointment && openRescheduleDialog(contact, actionAppointment)}
                                                onDeleteAppointment={() => actionAppointment && void handleDeleteAppointment(actionAppointment)}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted-foreground">Página {safePage} de {totalPages}</span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                        <SelectTrigger size="sm" className="h-9 min-w-[82px]"><SelectValue /></SelectTrigger>
                        <SelectContent align="end">{PAGE_SIZE_OPTIONS.map((option) => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1}>
                        <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safePage === totalPages}>
                        Siguiente <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                </div>
            </div>

            <AppointmentDialog
                open={appointmentDialogOpen}
                onOpenChange={(open) => {
                    setAppointmentDialogOpen(open);
                    if (!open) {
                        setAppointmentClient(null);
                        setEditingAppointment(null);
                    }
                }}
                selectedEvent={editingAppointment ? {
                    id: editingAppointment.id,
                    title: editingAppointment.title,
                    start: new Date(editingAppointment.startTime),
                    end: new Date(editingAppointment.endTime),
                    notes: editingAppointment.notes,
                    resource: {
                        patient: { id: editingAppointment.patientId || appointmentClient?.patients[0]?.id || null },
                        specialistId: editingAppointment.specialistId,
                        serviceId: editingAppointment.serviceId,
                        appointmentType: editingAppointment.appointmentType,
                        isOverbook: editingAppointment.isOverbook,
                        visitMode: editingAppointment.visitMode,
                        meetStatus: editingAppointment.meetStatus,
                        meetLink: editingAppointment.meetLink,
                        paymentStatus: editingAppointment.paymentStatus,
                        paymentAmount: editingAppointment.paymentAmount,
                        paymentCurrency: editingAppointment.paymentCurrency,
                        remindersOptOut: editingAppointment.remindersOptOut,
                        googleCalendarId: editingAppointment.googleCalendarId,
                    },
                } : null}
                defaultPatientId={appointmentClient?.patients[0]?.id || null}
                onSuccess={() => {
                    setAppointmentDialogOpen(false);
                    setAppointmentClient(null);
                    setEditingAppointment(null);
                    startTransition(() => router.refresh());
                }}
                businessHours={businessHours}
            />
        </div>
    );
}
