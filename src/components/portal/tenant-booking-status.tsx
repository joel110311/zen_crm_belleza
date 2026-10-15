"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PortalFrame } from "./portal-frame";
import styles from "./portal-workspace.module.css";

type Booking = {
    clinicName: string;
    timeZone?: string;
    primaryColor?: string;
    logoUrl?: string | null;
    status: string;
    confirmationStatus: string;
    startsAt: string;
    serviceName: string;
    specialistName: string;
    cancellationReason: string | null;
    cancellable: boolean;
};

export function TenantBookingStatus({ tenantSlug, token }: { tenantSlug: string; token: string }) {
    const [booking, setBooking] = useState<Booking | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [cancelling, setCancelling] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const endpoint = `/api/public/t/${encodeURIComponent(tenantSlug)}/v1/bookings/${encodeURIComponent(token)}`;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(endpoint, { cache: "no-store" });
            const payload = await response.json().catch(() => null) as { data?: Booking; error?: { message?: string } } | null;
            if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || "No fue posible consultar la cita.");
            setBooking(payload.data);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible consultar la cita.");
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => { void load(); }, [load]);

    async function cancel() {
        if (!booking?.cancellable || cancelling || !confirming) return;
        setCancelling(true);
        try {
            const response = await fetch(`${endpoint}/cancel`, { method: "POST" });
            const payload = await response.json().catch(() => null) as { data?: Booking; error?: { message?: string } } | null;
            if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || "No fue posible cancelar la cita.");
            setBooking(payload.data);
            setConfirming(false);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible cancelar la cita.");
        } finally {
            setCancelling(false);
        }
    }

    const title = booking?.status === "cancelled" ? "Cita cancelada" : booking?.status === "completed" ? "Cita completada" : booking?.status === "no_show" ? "Cita no realizada" : booking?.confirmationStatus === "confirmed" ? "Cita confirmada" : "Solicitud recibida";
    return <PortalFrame name={booking?.clinicName || "Estado de tu cita"} primaryColor={booking?.primaryColor} logoUrl={booking?.logoUrl}>
        <section className={styles.statusPanel} aria-busy={loading || cancelling}>
            <h1>{loading ? "Consultando tu cita" : booking ? title : "No pudimos abrir la cita"}</h1>
            {loading ? <p role="status">Estamos consultando el estado de tu reserva…</p> : <>
                {error && <div role="alert" className={`${styles.error} mt-5`}>{error}</div>}
                {booking ? <>
                    <p>{booking.status === "cancelled" ? "La cita fue cancelada. Puedes volver al portal para elegir otro horario." : booking.confirmationStatus === "pending" ? "El negocio recibió tu solicitud. Aún falta su confirmación." : "Consulta los detalles de tu cita."}</p>
                    <dl className={styles.details}>
                        <div><dt>Servicio</dt><dd>{booking.serviceName}</dd></div>
                        <div><dt>Profesional</dt><dd>{booking.specialistName}</dd></div>
                        <div><dt>Fecha y hora · {booking.timeZone ? "horario del negocio" : "hora local"}</dt><dd>{new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeStyle: "short", timeZone: booking.timeZone }).format(new Date(booking.startsAt))}</dd></div>
                        {booking.cancellationReason && <div><dt>Motivo de cancelación</dt><dd>{booking.cancellationReason}</dd></div>}
                    </dl>
                    {booking.cancellable && (confirming ? <section className={styles.cancelPanel} aria-label="Confirmar cancelación"><h2>¿Cancelar esta cita?</h2><p>El horario quedará libre. Si deseas asistir después, necesitarás otra reserva.</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={cancelling} onClick={() => { setConfirming(false); setError(null); }}>Conservar cita</button><button type="button" className={styles.danger} disabled={cancelling} onClick={() => void cancel()}>{cancelling ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Cancelando…</> : "Sí, cancelar cita"}</button></div></section> : <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>Cancelar cita</button></div>)}
                </> : <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => void load()}>Reintentar consulta</button></div>}
                <div className={styles.actions}><Link className={styles.secondary} href={`/portal/${tenantSlug}`}>Volver al portal</Link></div>
            </>}
        </section>
    </PortalFrame>;
}
