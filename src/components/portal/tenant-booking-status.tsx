"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Booking = {
    clinicName: string;
    status: string;
    confirmationStatus: string;
    startsAt: string;
    serviceName: string;
    specialistName: string;
    payment: { status: string; amount: number; currency: string; method: string | null };
    cancellationReason: string | null;
    cancellable: boolean;
};

export function TenantBookingStatus({ tenantSlug, token }: { tenantSlug: string; token: string }) {
    const [booking, setBooking] = useState<Booking | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [cancelling, setCancelling] = useState(false);
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
        if (!booking || !window.confirm("¿Deseas cancelar esta cita?")) return;
        setCancelling(true);
        try {
            const response = await fetch(`${endpoint}/cancel`, { method: "POST" });
            const payload = await response.json().catch(() => null) as { data?: Booking; error?: { message?: string } } | null;
            if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || "No fue posible cancelar la cita.");
            setBooking(payload.data);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible cancelar la cita.");
        } finally {
            setCancelling(false);
        }
    }

    return <main className="flex min-h-dvh items-center justify-center bg-[#f4f4ef] px-4 py-10"><section className="w-full max-w-lg rounded-3xl border bg-background p-7 shadow-xl shadow-black/5 sm:p-9">
        {loading ? <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Consultando tu cita…</p> : error ? <div className="text-center"><XCircle className="mx-auto size-12 text-destructive" /><h1 className="mt-4 text-xl font-semibold">No pudimos abrir la cita</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p><Button className="mt-5" variant="outline" asChild><Link href={`/portal/${tenantSlug}`}>Volver al portal</Link></Button></div> : booking ? <div className="text-center"><CalendarCheck2 className="mx-auto size-12 text-primary" /><p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">{booking.status === "cancelled" ? "Cita cancelada" : booking.confirmationStatus === "confirmed" ? "Cita confirmada" : "Solicitud recibida"}</p><h1 className="mt-2 text-2xl font-semibold">{booking.clinicName}</h1><div className="mt-6 rounded-2xl border bg-muted/25 p-4 text-left text-sm"><p className="font-semibold">{booking.serviceName}</p><p className="mt-1 text-muted-foreground">{booking.specialistName}</p><p className="mt-2 text-muted-foreground">{new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeStyle: "short" }).format(new Date(booking.startsAt))}</p>{booking.cancellationReason ? <p className="mt-3 text-destructive">{booking.cancellationReason}</p> : null}</div>{booking.cancellable ? <Button className="mt-6 w-full" variant="outline" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? <><Loader2 className="mr-2 size-4 animate-spin" />Cancelando…</> : "Cancelar cita"}</Button> : <Button className="mt-6 w-full" variant="outline" asChild><Link href={`/portal/${tenantSlug}`}>Volver al portal</Link></Button>}</div> : null}
    </section></main>;
}
