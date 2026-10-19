"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Scissors,
  X,
} from "lucide-react";

import {
  deleteAppointment,
  updateAppointmentStatus,
} from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { createConversation } from "@/app/actions/chat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { ContactActions } from "@/components/contacts/contact-actions";
import { ContactsBulkCampaignDialog } from "@/components/contacts/contacts-bulk-campaign-dialog";
import { ContactsBulkDeleteDialog } from "@/components/contacts/contacts-bulk-delete-dialog";
import { useToast } from "@/components/ui/use-toast";
import { getContactFullName } from "@/lib/contact-name";
import { normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  type ClientAppointment,
  type ContactTableItem,
  getClientMetrics,
} from "@/lib/contacts-view";
import {
  tenantDashboardPath,
  tenantSlugFromPath,
} from "@/lib/tenant-request-routing";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { formatDateInOperationZone } from "@/lib/operation-dates";
import styles from "./contacts.module.css";

const AppointmentDialog = dynamic(() => import("@/components/calendar/appointment-dialog").then((module) => module.AppointmentDialog));

interface ContactsPageProps {
  contacts: ContactTableItem[];
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

function normalizeContactSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

function tagClasses(tag: string) {
  const normalized = tag.toLocaleLowerCase("es-MX");
  if (normalized === "vip")
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (normalized === "recurrente")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-primary/15 bg-primary/5 text-primary";
}

export function ContactsTable({ contacts }: ContactsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const slug = tenantSlugFromPath(pathname);
  const route = (path: string) =>
    slug ? tenantDashboardPath(slug, path) : path;
  const { readOnly } = useWorkspaceAccess();
  const { data: session } = useSession();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchTerm, setSearchTerm] = useState("");
  const [rawSelectedContactIds, setRawSelectedContactIds] = useState<string[]>(
    [],
  );
  const [confirmingAppointmentId, setConfirmingAppointmentId] = useState<
    string | null
  >(null);
  const [completingAppointmentId, setCompletingAppointmentId] = useState<
    string | null
  >(null);
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [appointmentClient, setAppointmentClient] =
    useState<ContactTableItem | null>(null);
  const [editingAppointment, setEditingAppointment] =
    useState<ClientAppointment | null>(null);
  const [businessHours, setBusinessHours] = useState(() =>
    normalizeBusinessHours(),
  );

  const sessionUser = session?.user as
    | { role?: string; permissions?: unknown }
    | undefined;
  const canEditContacts =
    !readOnly &&
    hasAnyPermission(sessionUser, ["contacts.manage", "patients.manage"]);
  const canReadChats = hasPermission(sessionUser, "chats.manage");
  const canManageCampaigns =
    !readOnly && hasPermission(sessionUser, "campaigns.manage");
  const canConfirmAppointments =
    !readOnly &&
    hasAnyPermission(sessionUser, ["calendar.manage", "reception.manage"]);
  const canManageCalendar =
    !readOnly && hasPermission(sessionUser, "calendar.manage");
  const clientRows = useMemo(() => {
    const normalizedTerm = normalizeContactSearch(searchTerm);
    const searchDigits = searchTerm.replace(/\D/g, "");

    return contacts
      .filter((contact) => {
        if (!normalizedTerm && !searchDigits) return true;
        const fullName = normalizeContactSearch(
          getContactFullName(contact, "Sin nombre"),
        );
        const phone = contact.phone || "";
        const phoneDigits = phone.replace(/\D/g, "");
        return (
          fullName.includes(normalizedTerm) ||
          normalizeContactSearch(phone).includes(normalizedTerm) ||
          (searchDigits.length > 0 && phoneDigits.includes(searchDigits))
        );
      })
      .map((contact) => ({ contact, metrics: getClientMetrics(contact) }));
  }, [contacts, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(clientRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return clientRows.slice(start, start + pageSize);
  }, [clientRows, pageSize, safePage]);
  const validContactIds = useMemo(
    () => new Set(contacts.map((contact) => contact.id)),
    [contacts],
  );
  const selectedContactIds = useMemo(
    () =>
      rawSelectedContactIds.filter((contactId) =>
        validContactIds.has(contactId),
      ),
    [rawSelectedContactIds, validContactIds],
  );
  const selectedContactIdSet = useMemo(
    () => new Set(selectedContactIds),
    [selectedContactIds],
  );
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedContactIdSet.has(contact.id)),
    [contacts, selectedContactIdSet],
  );
  const currentPageSelectedCount = pagedRows.filter(({ contact }) =>
    selectedContactIdSet.has(contact.id),
  ).length;
  const pageSelectionState =
    pagedRows.length === 0
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

  useEffect(() => {
    const next = contacts.map((contact) => contact.listMetrics?.nextAppointment?.startTime)
      .filter((value): value is string | Date => Boolean(value))
      .map((value) => new Date(value).getTime()).sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = window.setTimeout(() => router.refresh(), Math.min(2_147_000_000, Math.max(1000, next - Date.now() + 1000)));
    return () => window.clearTimeout(timer);
  }, [contacts, router]);

  const handleRefresh = () => startTransition(() => router.refresh());
  const clearSelection = () => setRawSelectedContactIds([]);
  const handleRowSelection = (contactId: string, checked: boolean) => {
    setRawSelectedContactIds((current) => {
      const next = new Set(
        current.filter((entry) => validContactIds.has(entry)),
      );
      if (checked) next.add(contactId);
      else next.delete(contactId);
      return Array.from(next);
    });
  };
  const handlePageSelection = (checked: boolean) => {
    setRawSelectedContactIds((current) => {
      const next = new Set(
        current.filter((entry) => validContactIds.has(entry)),
      );
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
    const clientsToExport =
      selectedContacts.length > 0 ? selectedContacts : contacts;
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
      [
        "Nombre",
        "Telefono",
        "Etiquetas",
        "Atenciones",
        "Servicio favorito",
      ].join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      selectedContacts.length > 0
        ? "clientes-seleccionados.csv"
        : "clientes.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const handleConfirmAppointment = async (appointmentId: string) => {
    setConfirmingAppointmentId(appointmentId);
    try {
      const result = await updateAppointmentStatus(appointmentId, "confirmed");
      if (!result.success)
        throw new Error(result.error || "No se pudo confirmar.");
      toast({
        title: "Reserva confirmada",
        description: "Ya aparece como cita confirmada en el calendario.",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "No se pudo confirmar",
        description:
          error instanceof Error ? error.message : "Inténtalo nuevamente.",
        variant: "destructive",
      });
    } finally {
      setConfirmingAppointmentId(null);
    }
  };
  const handleCompleteAppointment = async (appointment: ClientAppointment) => {
    setCompletingAppointmentId(appointment.id);
    try {
      const result = await updateAppointmentStatus(appointment.id, "completed");
      if (!result.success) throw new Error(result.error);
      toast({ title: "Cita finalizada" });
      router.refresh();
    } catch (error) {
      toast({
        title: "No se pudo finalizar",
        description:
          error instanceof Error ? error.message : "Inténtalo nuevamente.",
        variant: "destructive",
      });
    } finally {
      setCompletingAppointmentId(null);
    }
  };
  const openAppointmentDialog = (contact: ContactTableItem) => {
    setAppointmentClient(contact);
    setEditingAppointment(null);
    setAppointmentDialogOpen(true);
  };
  const openRescheduleDialog = (
    contact: ContactTableItem,
    appointment: ClientAppointment,
  ) => {
    setAppointmentClient(contact);
    setEditingAppointment(appointment);
    setAppointmentDialogOpen(true);
  };
  const handleDeleteAppointment = async (appointment: ClientAppointment) => {
    if (!confirm(`¿Eliminar la cita "${appointment.title}"?`)) return;
    try {
      const result = await deleteAppointment(appointment.id);
      if (!result.success)
        throw new Error(result.error || "No se pudo eliminar la cita.");
      toast({
        title: "Cita eliminada",
        description: "El horario volvió a quedar disponible.",
      });
      startTransition(() => router.refresh());
    } catch (error) {
      toast({
        title: "No se pudo eliminar la cita",
        description:
          error instanceof Error ? error.message : "Inténtalo nuevamente.",
        variant: "destructive",
      });
    }
  };

  const filteredContactCount = clientRows.length;
  const currentRangeStart =
    filteredContactCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const currentRangeEnd = Math.min(safePage * pageSize, filteredContactCount);

  return (
    <div className={styles.workspace}>
      <div className={styles.header}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Clientes
              </h1>
              <span className="text-sm text-muted-foreground">
                ({contacts.length} total)
              </span>
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
              Mostrando {currentRangeStart}-{currentRangeEnd} de{" "}
              {filteredContactCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              onClick={handleRefresh}
              disabled={isPending}
              aria-label="Actualizar clientes"
            >
              <RotateCw
                className={cn("h-4 w-4", isPending && "animate-spin")}
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl"
              onClick={handleExport}
              aria-label="Exportar clientes"
            >
              <Download className="h-4 w-4" />
            </Button>
            {canEditContacts ? <NewContactDialog /> : null}
          </div>
        </div>

        {selectedContacts.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <CheckSquare2 className="h-4 w-4 text-primary" />
              <span className="font-semibold">{selectedContacts.length}</span>
              <span>
                cliente{selectedContacts.length === 1 ? "" : "s"} seleccionado
                {selectedContacts.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedContacts.length < contacts.length ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRawSelectedContactIds(
                      contacts.map((contact) => contact.id),
                    )
                  }
                >
                  Seleccionar los {contacts.length}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSelection}
              >
                <X className="mr-2 h-4 w-4" /> Limpiar
              </Button>
              {canManageCampaigns ? (
                <ContactsBulkCampaignDialog
                  contacts={selectedContacts}
                  onCreated={clearSelection}
                />
              ) : null}
              {canEditContacts ? (
                <ContactsBulkDeleteDialog
                  contacts={selectedContacts}
                  onDeleted={() => {
                    clearSelection();
                    startTransition(() => router.refresh());
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.selectionLine}>
        <Checkbox
          checked={pageSelectionState}
          onCheckedChange={(checked) => handlePageSelection(checked === true)}
          aria-label="Seleccionar clientes de esta página"
        />
        <span>Seleccionar página</span>
        <span>{filteredContactCount} resultado{filteredContactCount === 1 ? "" : "s"}</span>
      </div>
      <div className={styles.listScroll}>
        <Table className={styles.table}>
          <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox
                  checked={pageSelectionState}
                  onCheckedChange={(checked) =>
                    handlePageSelection(checked === true)
                  }
                  aria-label="Seleccionar clientes de esta página"
                />
              </TableHead>
              <TableHead className="min-w-[230px]">Cliente</TableHead>
              <TableHead className="hidden md:table-cell">Tags</TableHead>
              <TableHead className="w-24 text-center">Atenciones</TableHead>
              <TableHead className={styles.favoriteCell}>
                Servicio favorito
              </TableHead>
              <TableHead className="w-[120px] text-right">Chat</TableHead>
              <TableHead className="min-w-[330px] text-right">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.length === 0 ? (
              <TableRow className={styles.emptyRow}>
                <TableCell
                  colSpan={7}
                  className="h-40 whitespace-normal break-words text-center text-muted-foreground"
                >
                  {searchTerm.trim()
                    ? "No encontramos clientes con ese nombre o número."
                    : "Todavía no hay clientes registrados."}
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map(({ contact, metrics }) => {
                const fullName = getContactFullName(contact, "Sin nombre");
                const isSelected = selectedContactIdSet.has(contact.id);
                const actionAppointment = metrics.actionAppointment;
                const isAttended = actionAppointment?.status === "completed";
                const isConfirmed =
                  actionAppointment?.confirmationStatus === "confirmed";
                return (
                  <TableRow
                    key={contact.id}
                    className={cn(styles.row, isSelected && "bg-primary/5")}
                  >
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          handleRowSelection(contact.id, checked === true)
                        }
                        aria-label={`Seleccionar ${fullName}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className={styles.identity}>
                        <Link
                          href={route(
                            `/dashboard/contacts/${encodeURIComponent(contact.id)}`,
                          )}
                          className={styles.clientName}
                        >
                          {fullName}
                          <ChevronRight className="size-4 shrink-0" />
                        </Link>
                        <span className={cn(styles.channel, "mt-1 inline-flex items-center gap-1 rounded-full bg-primary/5 px-2 py-0.5 text-xs text-primary")}>
                          <WhatsAppIcon className="h-3 w-3" />{" "}
                          {contact.sourceType === "meta"
                            ? "WhatsApp API oficial"
                            : "WhatsApp QR"}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 break-all text-sm text-muted-foreground">
                          <Phone className="h-3.5 w-3.5" />{" "}
                          {contact.phone || "Sin teléfono"}
                        </span>
                        <span className={styles.lastVisit}>
                          {metrics.lastVisit
                            ? `Última visita · ${formatDateInOperationZone(metrics.lastVisit.startTime, undefined, businessHours.timeZone, { day: "numeric", month: "short", year: undefined })}`
                            : "Sin visitas completadas"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={cn(styles.tagsCell, metrics.tags.length === 0 && styles.emptyTags)}>
                      <div className="flex max-w-[260px] flex-wrap gap-1.5">
                        {metrics.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                              tagClasses(tag),
                            )}
                          >
                            {tag.toLocaleLowerCase("es-MX") === "vip" ? (
                              <Crown className="h-3 w-3" />
                            ) : null}
                            {tag}
                          </span>
                        ))}
                        {metrics.tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Sin tags
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className={styles.metricsCell}>
                      <span className={styles.mobileLabel}>Atenciones</span>
                      <span className="inline-flex min-w-10 items-center justify-center rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                        {metrics.attendedCount}
                      </span>
                    </TableCell>
                    <TableCell className={styles.favoriteCell}>
                      <span className="inline-flex items-center gap-2 text-sm text-foreground">
                        <Scissors className="h-4 w-4 text-gold" />
                        {metrics.favoriteService}
                      </span>
                    </TableCell>
                    <TableCell className={styles.chatCell}>
                      {canReadChats ? (
                        <Link
                          href={route(
                            `/dashboard/inbox?contactId=${encodeURIComponent(contact.id)}`,
                          )}
                          aria-label={`Abrir conversación de ${fullName}`}
                            onClick={(event) => {
                              if (readOnly || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              if (isPending) return;
                              startTransition(async () => {
                                try {
                                  const conversation = await createConversation(contact.id);
                                  router.push(route(`/dashboard/inbox?conversationId=${encodeURIComponent(conversation.id)}`));
                                } catch {
                                  toast({ title: "No se pudo abrir el chat", description: "Inténtalo de nuevo; el cliente conserva sus datos.", variant: "destructive" });
                                }
                              });
                            }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10"
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" /> Ir al chat
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className={styles.actionsCell}>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 gap-2 rounded-full px-3"
                          disabled={!canManageCalendar}
                          onClick={() => openAppointmentDialog(contact)}
                        >
                          <CalendarPlus className="h-4 w-4" /> Cita
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            styles.desktopAction,
                            "h-9 gap-2 rounded-full px-3",
                          )}
                          disabled={
                            !canConfirmAppointments ||
                            !actionAppointment ||
                            isConfirmed ||
                            isAttended ||
                            confirmingAppointmentId === actionAppointment.id
                          }
                          onClick={() =>
                            actionAppointment &&
                            void handleConfirmAppointment(actionAppointment.id)
                          }
                        >
                          <Check className="h-4 w-4" /> Confirmar
                        </Button>
                        <Button
                          type="button"
                          className={cn(
                            styles.desktopAction,
                            "h-9 gap-2 rounded-full px-3",
                            isAttended && "bg-emerald-600 hover:bg-emerald-600",
                          )}
                          disabled={
                            !canConfirmAppointments ||
                            !actionAppointment ||
                            isAttended ||
                            completingAppointmentId === actionAppointment.id
                          }
                          onClick={() =>
                            actionAppointment &&
                            void handleCompleteAppointment(actionAppointment)
                          }
                        >
                          <CheckCircle2 className="h-4 w-4" /> Atendido
                        </Button>
                        <ContactActions
                          clientName={fullName}
                          canConfirm={
                            canConfirmAppointments &&
                            Boolean(actionAppointment) &&
                            !isConfirmed &&
                            !isAttended &&
                            confirmingAppointmentId !== actionAppointment?.id
                          }
                          canComplete={
                            canConfirmAppointments &&
                            Boolean(actionAppointment) &&
                            !isAttended &&
                            completingAppointmentId !== actionAppointment?.id
                          }
                          onConfirm={() =>
                            actionAppointment &&
                            void handleConfirmAppointment(actionAppointment.id)
                          }
                          onComplete={() =>
                            actionAppointment &&
                            void handleCompleteAppointment(actionAppointment)
                          }
                          showStatusActions
                          hasAppointment={Boolean(actionAppointment)}
                          disabled={!canManageCalendar}
                          onReschedule={() =>
                            actionAppointment &&
                            openRescheduleDialog(contact, actionAppointment)
                          }
                          onDeleteAppointment={() =>
                            actionAppointment &&
                            void handleDeleteAppointment(actionAppointment)
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className={styles.pagination}>
        <span className="text-sm text-muted-foreground">
          Página {safePage} de {totalPages}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger
              aria-label="Clientes por página"
              size="sm"
              className="h-9 min-w-[70px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            aria-label="Página anterior"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={safePage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className={styles.pageText}>Anterior</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            aria-label="Página siguiente"
            onClick={() =>
              setCurrentPage((page) => Math.min(totalPages, page + 1))
            }
            disabled={safePage === totalPages}
          >
            <span className={styles.pageText}>Siguiente</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {appointmentDialogOpen && <AppointmentDialog
        defaultContact={appointmentClient}
        open={appointmentDialogOpen}
        onOpenChange={(open) => {
          setAppointmentDialogOpen(open);
          if (!open) {
            setAppointmentClient(null);
            setEditingAppointment(null);
          }
        }}
        selectedEvent={
          editingAppointment
            ? {
                id: editingAppointment.id,
                title: editingAppointment.title,
                start: new Date(editingAppointment.startTime),
                end: new Date(editingAppointment.endTime),
                notes: editingAppointment.notes,
                resource: {
                  patient: {
                    id:
                      editingAppointment.patientId ||
                      appointmentClient?.patients[0]?.id ||
                      null,
                  },
                  specialistId: editingAppointment.specialistId,
                  serviceId: editingAppointment.serviceId,
                  appointmentType: editingAppointment.appointmentType,
                  isOverbook: editingAppointment.isOverbook,
                  visitMode: editingAppointment.visitMode,
                  meetStatus: editingAppointment.meetStatus,
                  meetLink: editingAppointment.meetLink,
                  remindersOptOut: editingAppointment.remindersOptOut,
                  googleCalendarId: editingAppointment.googleCalendarId,
                },
              }
            : null
        }
        defaultPatientId={appointmentClient?.patients[0]?.id || null}
        onSuccess={() => {
          setAppointmentDialogOpen(false);
          setAppointmentClient(null);
          setEditingAppointment(null);
          startTransition(() => router.refresh());
        }}
        businessHours={businessHours}
      />}
    </div>
  );
}
