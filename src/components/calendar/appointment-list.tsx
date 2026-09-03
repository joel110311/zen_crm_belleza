"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit2, Trash2, Video } from "lucide-react";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { formatDateInOperationZone, formatTimeInOperationZone } from "@/lib/operation-dates";
import type { getAppointments } from "@/app/actions/calendar";

type CalendarAppointment = Awaited<ReturnType<typeof getAppointments>>[number];

interface AppointmentListProps {
    appointments: CalendarAppointment[];
    onEdit: (apt: CalendarAppointment) => void;
    onDelete: (id: string) => void;
}

export function AppointmentList({ appointments, onEdit, onDelete }: AppointmentListProps) {
    const operationContext = useOperationContext();

    if (!appointments || appointments.length === 0) {
        return (
            <div className="text-center py-10 text-muted-foreground bg-white rounded-lg border">
                No hay citas de hoy ni citas pendientes próximas.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
                <TableHeader className="bg-primary/[0.045]">
                    <TableRow>
                        <TableHead className="font-semibold text-slate-600">FECHA/HORA</TableHead>
                        <TableHead className="font-semibold text-slate-600">PACIENTE</TableHead>
                        <TableHead className="font-semibold text-slate-600">MOTIVO</TableHead>
                        <TableHead className="font-semibold text-slate-600">DURACION</TableHead>
                        <TableHead className="font-semibold text-slate-600">ESTADO</TableHead>
                        <TableHead className="text-right font-semibold text-slate-600">ACCIONES</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {appointments.map((apt) => {
                        const durationMins = Math.round((new Date(apt.endTime).getTime() - new Date(apt.startTime).getTime()) / 60000);
                        const calendarLabel = apt.specialistName || apt.googleCalendarName;
                        const specialistLabel = apt.specialist?.displayName || apt.specialist?.name || apt.specialistName;
                        const calendarColor = apt.googleCalendarColor || "#2563EB";
                        const patientLabel = apt.patient
                            ? [apt.patient.firstName, apt.patient.lastName].filter(Boolean).join(" ")
                            : "Cliente no vinculado";
                        const isReserved = apt.status === "scheduled" && apt.confirmationStatus === "pending";
                        const statusLabel = apt.status === "scheduled"
                            ? isReserved ? "Apartado" : "Agendada"
                            : apt.status === "completed"
                                ? "Completada"
                                : apt.status === "waiting"
                                    ? "En sala"
                                    : apt.status === "in_progress"
                                        ? "En consulta"
                                        : apt.status === "no_show"
                                            ? "No asistio"
                                            : apt.status === "cancelled"
                                                ? "Cancelada"
                                                : apt.status;

                        return (
                            <TableRow key={apt.id} className="hover:bg-primary/[0.035]">
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-slate-900">
                                            {formatDateInOperationZone(apt.startTime, operationContext.locale, operationContext.timeZone, {
                                                day: "numeric",
                                                month: "numeric",
                                                year: "numeric",
                                            })}
                                        </span>
                                        <span className="text-sm text-slate-500">
                                            {formatTimeInOperationZone(apt.startTime, operationContext.locale, operationContext.timeZone, { hour12: false })}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-medium text-slate-900">
                                                {patientLabel}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {apt.patient?.phone || "Sin telefono"}
                                            </span>
                                            {calendarLabel && (
                                                <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-full"
                                                        style={{ backgroundColor: calendarColor }}
                                                    />
                                                    <span className="truncate">{calendarLabel}</span>
                                                </span>
                                            )}
                                            {specialistLabel && (
                                                <span className="text-[11px] text-slate-500">
                                                    Especialista: {specialistLabel}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="font-medium text-slate-700">{apt.title}</span>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {apt.source === "portal" ? <Badge variant="outline">Portal</Badge> : null}
                                            {apt.isOverbook ? <Badge variant="secondary">Sobreturno</Badge> : null}
                                            {apt.confirmationStatus === "confirmed" ? <Badge variant="outline">Confirmada</Badge> : null}
                                            {apt.appointmentType ? <Badge variant="outline">{apt.appointmentType}</Badge> : null}
                                            {apt.visitMode && apt.visitMode !== "presencial" ? (
                                                <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
                                                    <Video className="h-3 w-3" />
                                                    {apt.visitMode === "hibrida" ? "Hibrida" : "Virtual"}
                                                </Badge>
                                            ) : null}
                                            {apt.meetLink ? <Badge variant="outline">Meet listo</Badge> : null}
                                            {apt.paymentStatus === "paid" ? (
                                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                                    Pagada
                                                </Badge>
                                            ) : apt.paymentStatus === "pending" ? (
                                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                                    Pago pendiente
                                                </Badge>
                                            ) : null}
                                        </div>
                                        {apt.notes && (
                                            <span className="text-xs text-slate-400 truncate max-w-[200px] block">
                                                {apt.notes}
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-slate-600">{durationMins} min</TableCell>
                                <TableCell>
                                    <Badge
                                        variant={apt.status === "completed" ? "default" : "secondary"}
                                        className={
                                            isReserved
                                                ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-none shadow-none"
                                                : apt.status === "completed"
                                                    ? "bg-green-100 text-green-700 hover:bg-green-200 border-none shadow-none"
                                                    : ""
                                        }
                                    >
                                        {statusLabel}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-gray-400 hover:text-blue-600"
                                            onClick={() => onEdit(apt)}
                                        >
                                            <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                            onClick={() => onDelete(apt.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
