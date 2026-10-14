"use client";

import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  MoreVertical,
  Trash2,
  Check,
  CheckCircle2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ContactActionsProps {
  clientName: string;
  hasAppointment: boolean;
  disabled?: boolean;
  showStatusActions?: boolean;
  canConfirm?: boolean;
  canComplete?: boolean;
  onConfirm?: () => void;
  onComplete?: () => void;
  onReschedule: () => void;
  onDeleteAppointment: () => void;
}

export function ContactActions({
  clientName,
  hasAppointment,
  disabled,
  onReschedule,
  onDeleteAppointment,
  showStatusActions,
  canConfirm,
  canComplete,
  onConfirm,
  onComplete,
}: ContactActionsProps) {
  const actionsDisabled = disabled || !hasAppointment;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label={`Acciones de cita para ${clientName}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showStatusActions ? (
          <>
            <DropdownMenuItem disabled={!canConfirm} onClick={onConfirm}>
              <Check className="mr-2 size-4" />
              Confirmar cita
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canComplete} onClick={onComplete}>
              <CheckCircle2 className="mr-2 size-4" />
              Marcar como atendido
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem onClick={onReschedule} disabled={actionsDisabled}>
          <CalendarClock className="mr-2 h-4 w-4" />
          Reagendar cita
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDeleteAppointment}
          disabled={actionsDisabled}
          className="text-red-600 focus:text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Eliminar cita
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
