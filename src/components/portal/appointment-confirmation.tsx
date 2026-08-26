"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarCheck, CreditCard, Loader2, Video, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cancelAppointmentByToken } from "@/app/actions/calendar";

type Props = {
    token: string;
    appointment: {
        id: string;
        title: string;
        startTime: Date;
        endTime: Date;
        status: string;
        confirmationStatus: string;
        cancellationReason?: string | null;
        visitMode?: string | null;
        meetLink?: string | null;
        paymentStatus?: string | null;
        paymentAmount?: number | null;
        paymentCurrency?: string | null;
        paymentMethod?: string | null;
        paymentLinkUrl?: string | null;
        patient?: {
            firstName: string;
            lastName: string;
        } | null;
        specialist?: {
            name: string;
            displayName?: string | null;
        } | null;
        specialistName?: string | null;
    };
};

function statusLabel(status: string, confirmationStatus: string) {
    if (status === "cancelled") return "Cancelada";
    if (confirmationStatus === "confirmed") return "Confirmada";
    if (status === "completed") return "Completada";
    return "Solicitud recibida";
}

function money(amount?: number | null, currency = "MXN", locale = "es-MX") {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
    }).format(amount || 0);
}

function paymentMethodLabel(method?: string | null) {
    const labels: Record<string, string> = {
        local: "Pago en el local",
        efectivo: "Efectivo",
        tarjeta: "Tarjeta",
        transferencia: "Transferencia",
        link: "Enlace de pago",
    };
    return labels[method || ""] || method || "Por definir";
}

export function AppointmentConfirmation({ token, appointment }: Props) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [reason, setReason] = useState("");
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        timeZone: "America/Mexico_City",
        defaultCurrency: "MXN",
    });
    const [localState, setLocalState] = useState({
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus,
        cancellationReason: appointment.cancellationReason || "",
    });
    const patientName = [appointment.patient?.firstName, appointment.patient?.lastName].filter(Boolean).join(" ") || "Cliente";
    const specialistName = appointment.specialist?.displayName || appointment.specialist?.name || appointment.specialistName;

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active || !context) return;
                setOperationContext({
                    locale: context.locale || "es-MX",
                    timeZone: context.timeZone || "America/Mexico_City",
                    defaultCurrency: context.defaultCurrency || "MXN",
                });
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const handleCancel = () => {
        startTransition(async () => {
            const result = await cancelAppointmentByToken(token, reason);
            if (!result.success) {
                toast({ title: "No se pudo cancelar", description: result.error, variant: "destructive" });
                return;
            }
            setLocalState({
                status: "cancelled",
                confirmationStatus: "declined",
                cancellationReason: reason || "Cancelada por paciente",
            });
            toast({ title: "Cita cancelada" });
        });
    };

    return (
        <div className="min-h-screen bg-background px-4 py-8">
            <main className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 border-b pb-5">
                    <div>
                        <p className="text-sm font-medium text-primary">Estado de cita</p>
                        <h1 className="mt-1 text-2xl font-bold text-foreground">
                            {statusLabel(localState.status, localState.confirmationStatus)}
                        </h1>
                        {localState.status !== "cancelled" && localState.confirmationStatus !== "confirmed" ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                                El negocio revisará tu solicitud y te confirmará por WhatsApp.
                            </p>
                        ) : null}
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <CalendarCheck className="h-6 w-6" />
                    </div>
                </div>

                <div className="mt-5 space-y-4 rounded-2xl border bg-muted/20 p-4">
                    <div>
                        <p className="text-xs text-muted-foreground">Cliente</p>
                        <p className="font-semibold">{patientName}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Motivo</p>
                        <p className="font-semibold">{appointment.title}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Fecha y hora</p>
                        <p className="font-semibold">
                            {new Intl.DateTimeFormat(operationContext.locale, {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: operationContext.timeZone,
                            }).format(new Date(appointment.startTime))}
                        </p>
                    </div>
                    {specialistName ? (
                        <div>
                            <p className="text-xs text-muted-foreground">Especialista</p>
                            <p className="font-semibold">{specialistName}</p>
                        </div>
                    ) : null}
                    {appointment.visitMode && appointment.visitMode !== "presencial" ? (
                        <div>
                            <p className="text-xs text-muted-foreground">Modalidad</p>
                            <p className="font-semibold">{appointment.visitMode === "hibrida" ? "Hibrida" : "Virtual"}</p>
                            {appointment.meetLink ? (
                                <Button className="mt-2" size="sm" asChild>
                                    <a href={appointment.meetLink} target="_blank" rel="noreferrer">
                                        <Video className="mr-2 h-4 w-4" />
                                        Abrir Google Meet
                                    </a>
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                    {appointment.paymentAmount && appointment.paymentAmount > 0 ? (
                        <div>
                            <p className="text-xs text-muted-foreground">Pago</p>
                            <p className="font-semibold">
                                {money(appointment.paymentAmount, appointment.paymentCurrency || operationContext.defaultCurrency, operationContext.locale)} - {appointment.paymentStatus === "paid" ? "pagado" : "pendiente"}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">{paymentMethodLabel(appointment.paymentMethod)}</p>
                            {appointment.paymentLinkUrl && appointment.paymentStatus !== "paid" ? (
                                <Button className="mt-2" size="sm" variant="outline" asChild>
                                    <a href={appointment.paymentLinkUrl} target="_blank" rel="noreferrer">
                                        <CreditCard className="mr-2 h-4 w-4" />
                                        Abrir link de pago
                                    </a>
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                    {localState.cancellationReason ? (
                        <div>
                            <p className="text-xs text-muted-foreground">Motivo de cancelacion</p>
                            <p className="font-semibold">{localState.cancellationReason}</p>
                        </div>
                    ) : null}
                </div>

                {localState.status !== "cancelled" && localState.status !== "completed" ? (
                    <div className="mt-5 space-y-4">
                        <div className="flex gap-2">
                            <Input
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Motivo opcional"
                                className="h-11"
                            />
                            <Button type="button" variant="outline" onClick={handleCancel} disabled={isPending} className="h-11 shrink-0">
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Cancelar solicitud
                            </Button>
                        </div>
                    </div>
                ) : null}
            </main>
        </div>
    );
}
