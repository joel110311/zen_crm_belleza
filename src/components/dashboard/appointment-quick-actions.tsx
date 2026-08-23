"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Check, CheckCircle2, Loader2, MoreVertical, Plus, Trash2, UserPlus, UserRoundCog } from "lucide-react";

import {
    assignAppointmentDetails,
    deleteAppointment,
    getAppointmentAssignmentOptions,
    updateAppointmentStatus,
} from "@/app/actions/calendar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type AppointmentQuickActionsProps = {
    appointmentId: string;
    appointmentDate: string;
    clientName: string;
    contactId: string | null;
    patientId: string | null;
    specialistId: string | null;
    serviceId: string | null;
    needsClientAssignment: boolean;
    needsSpecialistAssignment: boolean;
    status: string;
    confirmationStatus: string;
    paymentStatus: string;
};

export function AppointmentQuickActions({
    appointmentId,
    appointmentDate,
    clientName,
    contactId,
    patientId,
    specialistId,
    serviceId,
    needsClientAssignment,
    needsSpecialistAssignment,
    status,
    confirmationStatus,
    paymentStatus,
}: AppointmentQuickActionsProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [isOpeningPayment, setIsOpeningPayment] = useState(false);
    const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
    const [clientPickerOpen, setClientPickerOpen] = useState(false);
    const [assignmentOptions, setAssignmentOptions] = useState<Awaited<ReturnType<typeof getAppointmentAssignmentOptions>> | null>(null);
    const [isLoadingOptions, setIsLoadingOptions] = useState(false);
    const [selectedContactId, setSelectedContactId] = useState("");
    const [selectedSpecialistId, setSelectedSpecialistId] = useState(specialistId || "");
    const [selectedServiceId, setSelectedServiceId] = useState(serviceId || "");
    const [sendReminders, setSendReminders] = useState(true);
    const isCompleted = status === "completed";
    const isConfirmed = confirmationStatus === "confirmed";

    const loadAssignmentOptions = async () => {
        if (assignmentOptions || isLoadingOptions) return;
        setIsLoadingOptions(true);
        try {
            const options = await getAppointmentAssignmentOptions();
            setAssignmentOptions(options);
            const currentContactId = needsClientAssignment
                ? ""
                : contactId || options.contacts.find((contact) => contact.patientId === patientId)?.id || "";
            setSelectedContactId(currentContactId);
            setSelectedSpecialistId(specialistId || "");
            setSelectedServiceId(serviceId || "");
        } catch {
            toast({ title: "No se pudieron cargar las opciones", variant: "destructive" });
        } finally {
            setIsLoadingOptions(false);
        }
    };

    const selectedContact = assignmentOptions?.contacts.find((contact) => contact.id === selectedContactId) || null;
    const selectedService = assignmentOptions?.services.find((service) => service.id === selectedServiceId) || null;
    const availableSpecialists = useMemo(() => {
        const specialists = assignmentOptions?.specialists || [];
        if (!selectedService || selectedService.specialistIds.length === 0) return specialists;
        return specialists.filter((specialist) => selectedService.specialistIds.includes(specialist.id));
    }, [assignmentOptions, selectedService]);
    const needsAssignment = needsClientAssignment || needsSpecialistAssignment || !serviceId;

    const saveAssignment = () => {
        if (!selectedContactId || !selectedSpecialistId || !selectedServiceId) {
            toast({ title: "Completa cliente, servicio y profesional", variant: "destructive" });
            return;
        }

        startTransition(async () => {
            const result = await assignAppointmentDetails(appointmentId, {
                contactId: selectedContactId,
                specialistId: selectedSpecialistId,
                serviceId: selectedServiceId,
                sendReminders,
            });
            if (!result.success) {
                toast({ title: "No se pudo completar la cita", description: result.error, variant: "destructive" });
                return;
            }
            setAssignmentDialogOpen(false);
            toast({ title: "Cita completada", description: "Cliente, servicio y profesional quedaron asignados." });
            router.refresh();
        });
    };

    const confirmAppointment = () => {
        startTransition(async () => {
            const result = await updateAppointmentStatus(appointmentId, "confirmed");
            if (!result.success) {
                toast({ title: "No se pudo confirmar", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Reserva confirmada" });
            router.refresh();
        });
    };

    const openPayment = () => {
        setIsOpeningPayment(true);
        router.push(`/dashboard/reception?date=${encodeURIComponent(appointmentDate)}&finish=${encodeURIComponent(appointmentId)}`);
    };

    const deleteCurrentAppointment = () => {
        if (!confirm("¿Eliminar esta cita?")) return;
        startTransition(async () => {
            const result = await deleteAppointment(appointmentId);
            if (!result.success) {
                toast({ title: "No se pudo eliminar la cita", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Cita eliminada", description: "El horario volvió a quedar disponible." });
            router.refresh();
        });
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {needsAssignment ? (
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl px-2.5 sm:px-3"
                        onClick={() => {
                            setAssignmentDialogOpen(true);
                            void loadAssignmentOptions();
                        }}
                    >
                        <UserRoundCog className="mr-1.5 h-4 w-4" />
                        Asignar
                    </Button>
                    <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
                        <DialogContent className="max-w-md">
                            <DialogHeader>
                                <DialogTitle>Completar cita</DialogTitle>
                                <DialogDescription>Asigna únicamente los datos operativos que faltan en la cita importada.</DialogDescription>
                            </DialogHeader>

                            {isLoadingOptions ? (
                                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando opciones...
                                </div>
                            ) : (
                                <div className="space-y-4 py-1">
                                    <div className="space-y-1.5">
                                        <Label>Cliente *</Label>
                                        <Popover open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
                                            <PopoverTrigger asChild>
                                                <Button variant="outline" className="h-11 w-full justify-start rounded-xl px-3 font-normal">
                                                    <UserPlus className="mr-2 h-4 w-4 text-primary" />
                                                    <span className="min-w-0 flex-1 truncate text-left">
                                                        {selectedContact ? `${selectedContact.name} · ${selectedContact.phone}` : "Buscar cliente por nombre o telefono..."}
                                                    </span>
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent align="start" className="w-[min(380px,calc(100vw-48px))] p-0">
                                                <Command>
                                                    <CommandInput placeholder="Buscar cliente..." />
                                                    <CommandList>
                                                        <CommandEmpty>No se encontro ningun cliente.</CommandEmpty>
                                                        <CommandGroup heading="Clientes con telefono">
                                                            {(assignmentOptions?.contacts || []).map((contact) => (
                                                                <CommandItem
                                                                    key={contact.id}
                                                                    value={`${contact.name} ${contact.phone}`}
                                                                    disabled={!contact.phone}
                                                                    onSelect={() => {
                                                                        setSelectedContactId(contact.id);
                                                                        setClientPickerOpen(false);
                                                                    }}
                                                                >
                                                                    <UserPlus className="h-4 w-4" />
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate font-medium">{contact.name}</span>
                                                                        <span className="block truncate text-xs text-muted-foreground">{contact.phone || "Sin telefono · agrega uno para seleccionarlo"}</span>
                                                                    </span>
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    </CommandList>
                                                </Command>
                                                <div className="border-t p-2">
                                                    <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                                                        <Link href="/dashboard/contacts"><Plus className="mr-2 h-4 w-4" /> Registrar nuevo cliente</Link>
                                                    </Button>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label>Servicio *</Label>
                                        <Select
                                            value={selectedServiceId}
                                            onValueChange={(value) => {
                                                setSelectedServiceId(value);
                                                const nextService = assignmentOptions?.services.find((service) => service.id === value);
                                                if (nextService?.specialistIds.length && !nextService.specialistIds.includes(selectedSpecialistId)) {
                                                    setSelectedSpecialistId("");
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Selecciona un servicio" /></SelectTrigger>
                                            <SelectContent>
                                                {(assignmentOptions?.services || []).map((service) => (
                                                    <SelectItem key={service.id} value={service.id}>
                                                        {service.name} · {service.durationMinutes} min · {new Intl.NumberFormat("es-MX", { style: "currency", currency: service.currency, maximumFractionDigits: 0 }).format(service.price)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label>Profesional *</Label>
                                        <Select value={selectedSpecialistId} onValueChange={setSelectedSpecialistId}>
                                            <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Selecciona un profesional" /></SelectTrigger>
                                            <SelectContent>
                                                {availableSpecialists.map((specialist) => (
                                                    <SelectItem key={specialist.id} value={specialist.id}>{specialist.displayName || specialist.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <label className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 px-3 py-2.5">
                                        <span>
                                            <span className="block text-sm font-medium">Enviar recordatorio</span>
                                            <span className="block text-xs text-muted-foreground">Se programara usando el telefono del cliente.</span>
                                        </span>
                                        <Switch checked={sendReminders} onCheckedChange={setSendReminders} />
                                    </label>
                                </div>
                            )}

                            <DialogFooter>
                                <Button variant="outline" onClick={() => setAssignmentDialogOpen(false)}>Cancelar</Button>
                                <Button onClick={saveAssignment} disabled={isPending || isLoadingOptions || !selectedContactId || !selectedServiceId || !selectedSpecialistId}>
                                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Guardar asignacion
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            ) : null}

            <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-xl px-2.5 sm:px-3"
                asChild
            >
                <Link
                    href={`/dashboard/calendar?new=1${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}${specialistId ? `&specialistId=${encodeURIComponent(specialistId)}` : ""}`}
                    aria-label={`Crear otra cita para ${clientName}`}
                    title={`Crear otra cita para ${clientName}`}
                >
                    <CalendarPlus className="mr-1.5 h-4 w-4" />
                    <span>Cita</span>
                </Link>
            </Button>

            {contactId ? (
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl text-primary" asChild>
                    <Link
                        href={`/dashboard/inbox?contactId=${encodeURIComponent(contactId)}`}
                        aria-label={`Abrir conversación de ${clientName}`}
                        title={`Abrir conversación de ${clientName}`}
                    >
                        <WhatsAppIcon className="h-4 w-4" />
                    </Link>
                </Button>
            ) : null}

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-xl px-2.5 sm:px-3"
                onClick={confirmAppointment}
                disabled={isPending || isConfirmed || isCompleted}
                title="Confirmar cita"
            >
                <Check className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Confirmar</span>
            </Button>

            <Button
                type="button"
                size="sm"
                className={cn("h-9 rounded-xl px-2.5 sm:px-3", isCompleted && paymentStatus !== "paid" && "bg-emerald-600 hover:bg-emerald-600")}
                onClick={openPayment}
                disabled={isOpeningPayment || paymentStatus === "paid"}
                title={paymentStatus === "paid" ? "Cita pagada" : "Atendido y cobrar"}
            >
                <CheckCircle2 className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Atendido</span>
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" title="Acciones de la cita">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => router.push(`/dashboard/calendar?appointmentId=${encodeURIComponent(appointmentId)}`)}>
                        <CalendarClock className="mr-2 h-4 w-4" />
                        Reagendar cita
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={deleteCurrentAppointment} disabled={isPending} className="text-red-600 focus:text-red-600">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar cita
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
