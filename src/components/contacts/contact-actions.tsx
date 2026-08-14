"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CalendarClock, MoreVertical, Pencil, Trash2, UserRoundX } from "lucide-react";
import { deleteContact } from "@/app/actions/contacts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";

interface ContactActionsProps {
    contactId: string;
    clientName: string;
    hasAppointment: boolean;
    disabled?: boolean;
    onReschedule: () => void;
    onDeleteAppointment: () => void;
}

export function ContactActions({ contactId, clientName, hasAppointment, disabled, onReschedule, onDeleteAppointment }: ContactActionsProps) {
    const [isDeletingClient, startDeletingClient] = useTransition();
    const router = useRouter();
    const { toast } = useToast();
    const actionsDisabled = disabled || !hasAppointment;

    const handleDeleteClient = () => {
        if (!confirm(`¿Eliminar al cliente "${clientName}"? Esta acción también eliminará sus citas relacionadas.`)) return;
        startDeletingClient(async () => {
            const result = await deleteContact(contactId);
            if (!result.success) {
                toast({ title: "No se pudo eliminar el cliente", description: result.error || "Inténtalo nuevamente.", variant: "destructive" });
                return;
            }
            toast({ title: "Cliente eliminado", description: `${clientName} se eliminó correctamente.` });
            router.refresh();
        });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" title={`Acciones de cita para ${clientName}`}>
                    <MoreVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onReschedule} disabled={actionsDisabled}>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Reagendar cita
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDeleteAppointment} disabled={actionsDisabled} className="text-red-600 focus:text-red-600">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar cita
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                    <Link href={`/dashboard/contacts/${contactId}`}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar cliente
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDeleteClient} disabled={isDeletingClient} className="text-red-600 focus:text-red-600">
                    <UserRoundX className="mr-2 h-4 w-4" />
                    Eliminar cliente
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
