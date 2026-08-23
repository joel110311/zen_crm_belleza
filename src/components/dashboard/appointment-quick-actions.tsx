"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Check, CheckCircle2, Loader2, MoreVertical, Plus, Trash2, UserPlus, UserRoundCog } from "lucide-react";

import {
    assignAppointmentClient,
    assignAppointmentSpecialist,
    deleteAppointment,
    getAppointmentAssignmentOptions,
    updateAppointmentStatus,
} from "@/app/actions/calendar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Button } from "@/components/ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type AppointmentQuickActionsProps = {
    appointmentId: string;
    appointmentDate: string;
    clientName: string;
    contactId: string | null;
    patientId: string | null;
    specialistId: string | null;
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
    const [clientPickerOpen, setClientPickerOpen] = useState(false);
    const [specialistPickerOpen, setSpecialistPickerOpen] = useState(false);
    const [assignmentOptions, setAssignmentOptions] = useState<Awaited<ReturnType<typeof getAppointmentAssignmentOptions>> | null>(null);
    const [isLoadingOptions, setIsLoadingOptions] = useState(false);
    const isCompleted = status === "completed";
    const isConfirmed = confirmationStatus === "confirmed";

    const loadAssignmentOptions = async () => {
        if (assignmentOptions || isLoadingOptions) return;
        setIsLoadingOptions(true);
        try {
            setAssignmentOptions(await getAppointmentAssignmentOptions());
        } catch {
            toast({ title: "No se pudieron cargar las opciones", variant: "destructive" });
        } finally {
            setIsLoadingOptions(false);
        }
    };

    const selectClient = (selectedContactId: string) => {
        startTransition(async () => {
            const result = await assignAppointmentClient(appointmentId, selectedContactId);
            if (!result.success) {
                toast({ title: "No se pudo asignar el cliente", description: result.error, variant: "destructive" });
                return;
            }
            setClientPickerOpen(false);
            toast({ title: "Cliente asignado" });
            router.refresh();
        });
    };

    const selectSpecialist = (selectedSpecialistId: string) => {
        startTransition(async () => {
            const result = await assignAppointmentSpecialist(appointmentId, selectedSpecialistId);
            if (!result.success) {
                toast({ title: "No se pudo asignar el profesional", description: result.error, variant: "destructive" });
                return;
            }
            setSpecialistPickerOpen(false);
            toast({ title: "Profesional asignado", description: "La cita y Google Calendar quedaron actualizados." });
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
            {needsClientAssignment ? (
                <Popover
                    open={clientPickerOpen}
                    onOpenChange={(open) => {
                        setClientPickerOpen(open);
                        if (open) void loadAssignmentOptions();
                    }}
                >
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 rounded-xl px-2.5 sm:px-3">
                            <UserPlus className="mr-1.5 h-4 w-4" />
                            Cliente
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[min(330px,calc(100vw-24px))] p-0">
                        <Command>
                            <CommandInput placeholder="Buscar cliente por nombre o telefono..." />
                            <CommandList>
                                {isLoadingOptions ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes...
                                    </div>
                                ) : null}
                                <CommandEmpty>No se encontro ningun cliente.</CommandEmpty>
                                <CommandGroup heading="Clientes">
                                    {(assignmentOptions?.contacts || []).map((contact) => (
                                        <CommandItem
                                            key={contact.id}
                                            value={`${contact.name} ${contact.phone}`}
                                            onSelect={() => selectClient(contact.id)}
                                            disabled={isPending}
                                        >
                                            <UserPlus className="h-4 w-4" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{contact.name}</span>
                                                <span className="block truncate text-xs text-muted-foreground">{contact.phone}</span>
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                        <div className="border-t p-2">
                            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                                <Link href="/dashboard/contacts">
                                    <Plus className="mr-2 h-4 w-4" /> Registrar nuevo cliente
                                </Link>
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            ) : null}

            {needsSpecialistAssignment ? (
                <Popover
                    open={specialistPickerOpen}
                    onOpenChange={(open) => {
                        setSpecialistPickerOpen(open);
                        if (open) void loadAssignmentOptions();
                    }}
                >
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-9 rounded-xl px-2.5 sm:px-3">
                            <UserRoundCog className="mr-1.5 h-4 w-4" />
                            Profesional
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[min(310px,calc(100vw-24px))] p-0">
                        <Command>
                            <CommandInput placeholder="Buscar profesional..." />
                            <CommandList>
                                {isLoadingOptions ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando profesionales...
                                    </div>
                                ) : null}
                                <CommandEmpty>No hay profesionales disponibles.</CommandEmpty>
                                <CommandGroup heading="Profesionales">
                                    {(assignmentOptions?.specialists || []).map((specialist) => (
                                        <CommandItem
                                            key={specialist.id}
                                            value={`${specialist.displayName || specialist.name} ${specialist.specialty || ""}`}
                                            onSelect={() => selectSpecialist(specialist.id)}
                                            disabled={isPending}
                                        >
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: specialist.color || "var(--primary)" }} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{specialist.displayName || specialist.name}</span>
                                                <span className="block truncate text-xs text-muted-foreground">{specialist.specialty || "Profesional de belleza"}</span>
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
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
