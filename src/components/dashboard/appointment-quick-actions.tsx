"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, CheckCircle2, MoreVertical, Trash2 } from "lucide-react";

import { deleteAppointment, updateAppointmentStatus } from "@/app/actions/calendar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type AppointmentQuickActionsProps = {
    appointmentId: string;
    appointmentDate: string;
    clientName: string;
    contactId: string | null;
    status: string;
    confirmationStatus: string;
    paymentStatus: string;
};

export function AppointmentQuickActions({
    appointmentId,
    appointmentDate,
    clientName,
    contactId,
    status,
    confirmationStatus,
    paymentStatus,
}: AppointmentQuickActionsProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [isOpeningPayment, setIsOpeningPayment] = useState(false);
    const isCompleted = status === "completed";
    const isConfirmed = confirmationStatus === "confirmed";

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
