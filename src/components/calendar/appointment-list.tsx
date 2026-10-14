"use client";

import type { getAppointments } from "@/app/actions/calendar";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { formatTimeInOperationZone } from "@/lib/operation-dates";
import styles from "./calendar.module.css";

type Appointment = Awaited<ReturnType<typeof getAppointments>>[number];
export function AppointmentList({
  appointments,
  onEdit,
  onDelete,
  readOnly = false,
}: {
  appointments: Appointment[];
  onEdit: (appointment: Appointment) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}) {
  const context = useOperationContext();
  if (!appointments.length)
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
        <CalendarDays
          className="mx-auto mb-3 size-7 text-primary"
          aria-hidden="true"
        />
        <p className="text-base font-medium">No hay citas para este día</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Prueba otra fecha o cambia los filtros.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {appointments.map((appointment) => {
        const name = appointment.patient
          ? [appointment.patient.firstName, appointment.patient.lastName]
              .filter(Boolean)
              .join(" ")
          : [appointment.contact?.name, appointment.contact?.lastName]
              .filter(Boolean)
              .join(" ") || "Sin cliente asignado";
        const status =
          appointment.status === "scheduled"
            ? appointment.confirmationStatus === "pending"
              ? "Por confirmar"
              : "Agendada"
            : {
                completed: "Completada",
                waiting: "En sala",
                in_progress: "En atención",
                no_show: "No asistió",
                cancelled: "Cancelada",
              }[appointment.status] || appointment.status;
        const specialist =
          appointment.specialist?.displayName ||
          appointment.specialist?.name ||
          appointment.specialistName ||
          "Sin profesional asignado";
        const duration = Math.round(
          (new Date(appointment.endTime).getTime() -
            new Date(appointment.startTime).getTime()) /
            60000,
        );
        return (
          <article key={appointment.id} className={styles.appointment}>
            <div className={styles.appointmentTime}>
              <time className="font-medium tabular-nums">
                {formatTimeInOperationZone(
                  appointment.startTime,
                  context.locale,
                  context.timeZone,
                  { hour12: false },
                )}
              </time>
              <time className="mt-1 block text-xs tabular-nums text-muted-foreground">
                {formatTimeInOperationZone(
                  appointment.endTime,
                  context.locale,
                  context.timeZone,
                  { hour12: false },
                )}
              </time>
            </div>
            <button
              type="button"
              className="min-w-0 text-left"
              aria-label={`Ver cita de ${name}`}
              onClick={() => onEdit(appointment)}
            >
              <p className="break-words text-base font-semibold">{name}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {appointment.appointmentType || appointment.title}
              </p>
              <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
                {specialist} <span aria-hidden="true">·</span>{" "}
                <Clock className="inline size-3" aria-hidden="true" />{" "}
                {duration} min
              </p>
              <span className="mt-3 inline-flex rounded-md bg-primary/8 px-2 py-1 text-xs font-medium text-primary">
                {status}
                {appointment.isOverbook ? " · Sobreturno" : ""}
              </span>
            </button>
            {!readOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={`Opciones de cita de ${name}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(appointment)}>
                    Ver o editar cita
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(appointment.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Eliminar cita
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={`Consultar cita de ${name}`}
                onClick={() => onEdit(appointment)}
              >
                <ChevronRight />
              </Button>
            )}
          </article>
        );
      })}
      <p className="py-2 text-xs text-muted-foreground">
        {appointments.length} cita{appointments.length === 1 ? "" : "s"} en este
        día.
      </p>
    </div>
  );
}
