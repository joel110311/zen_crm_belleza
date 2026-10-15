"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { PortalFrame } from "./portal-frame";
import styles from "./portal-workspace.module.css";
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
    if (status === "completed") return "Completada";
    if (confirmationStatus === "confirmed") return "Confirmada";
    return "Solicitud recibida";
}

export function AppointmentConfirmation({ token, appointment }: Props) {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [reason, setReason] = useState("");
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        timeZone: "America/Mexico_City",
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
                });
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const handleCancel = () => {
        if (isPending || !confirming || ["cancelled", "completed"].includes(localState.status)) return;
        setError(null);
        startTransition(async () => {
            try {
            const result = await cancelAppointmentByToken(token, reason);
            if (!result.success) {
                setError(result.error || "No se pudo cancelar la cita.");
                return;
            }
            setLocalState({
                status: "cancelled",
                confirmationStatus: "declined",
                cancellationReason: reason || "Cancelada por el cliente",
            });
            setConfirming(false);
            toast({ title: "Cita cancelada" });
            } catch { setError("No se pudo cancelar. Revisa tu conexión e inténtalo de nuevo."); }
        });
    };

    return <PortalFrame name="Estado de tu cita"><section className={styles.statusPanel} aria-busy={isPending}>
        <h1>{statusLabel(localState.status, localState.confirmationStatus)}</h1>
        {localState.status !== "cancelled" && localState.confirmationStatus !== "confirmed" && localState.status !== "completed" && <p>El negocio revisará tu solicitud y te confirmará por WhatsApp.</p>}
        <dl className={styles.details}>
            <div><dt>Cliente</dt><dd>{patientName}</dd></div>
            <div><dt>Servicio o motivo</dt><dd>{appointment.title}</dd></div>
            <div><dt>Fecha y hora · horario del negocio</dt><dd>{new Intl.DateTimeFormat(operationContext.locale, { dateStyle: "full", timeStyle: "short", timeZone: operationContext.timeZone }).format(new Date(appointment.startTime))}</dd></div>
            {specialistName && <div><dt>Profesional</dt><dd>{specialistName}</dd></div>}
            {appointment.visitMode && appointment.visitMode !== "presencial" && <div><dt>Modalidad</dt><dd>{appointment.visitMode === "hibrida" ? "Híbrida" : "Virtual"}</dd>{appointment.meetLink && <a className={`${styles.secondary} mt-3`} href={appointment.meetLink} target="_blank" rel="noreferrer">Abrir Google Meet</a>}</div>}
            {localState.cancellationReason && <div><dt>Motivo de cancelación</dt><dd>{localState.cancellationReason}</dd></div>}
        </dl>
        {error && <p role="alert" className={`${styles.error} mt-5`}>{error}</p>}
        {!['cancelled', 'completed'].includes(localState.status) && (confirming ? <section className={styles.cancelPanel} aria-label="Confirmar cancelación"><h2>¿Cancelar esta cita?</h2><p>Revisa la fecha antes de confirmar la cancelación.</p><div className={`${styles.field} mt-4`}><label htmlFor="cancellation-reason">Motivo (opcional)</label><input id="cancellation-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={isPending} /></div><div className={styles.actions}><button className={styles.secondary} disabled={isPending} onClick={() => { setConfirming(false); setError(null); }}>Conservar cita</button><button className={styles.danger} disabled={isPending} onClick={handleCancel}>{isPending ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Cancelando…</> : "Sí, cancelar cita"}</button></div></section> : <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>Cancelar solicitud</button></div>)}
    </section></PortalFrame>;
}
