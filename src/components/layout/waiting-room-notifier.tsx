"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, CalendarPlus, Clock3, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTimeInOperationZone, formatDateTimeInOperationZone, getOperationDateKey } from "@/lib/operation-dates";
import { tenantDashboardPath, tenantSlugFromPath } from "@/lib/tenant-request-routing";

const POLL_INTERVAL_MS = 5000;
const DISMISSED_STORAGE_KEY = "zen-crm-waiting-room-dismissed";

type WaitingRoomNotification = {
    type?: "waiting_room" | "appointment_request";
    id: string;
    title: string;
    serviceName?: string | null;
    patientId: string | null;
    patientName: string;
    phone: string | null;
    specialistName: string | null;
    startTime: string;
    endTime: string;
    arrivalAt: string | null;
    createdAt?: string | null;
};

type WaitingRoomPayload = {
    locale?: string;
    timeZone?: string;
    notifications?: WaitingRoomNotification[];
};

function readDismissed() {
    if (typeof window === "undefined") return new Set<string>();
    try {
        const raw = window.sessionStorage.getItem(DISMISSED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
    } catch {
        return new Set<string>();
    }
}

function writeDismissed(values: Set<string>) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(values).slice(-100)));
}

export function WaitingRoomNotifier() {
    const pathname = usePathname();
    const isReception = pathname === "/dashboard/reception" || /^\/t\/[^/]+\/reception\/?$/.test(pathname);
    const isInbox = pathname === "/dashboard/inbox" || /^\/t\/[^/]+\/inbox\/?$/.test(pathname);
    const pollInFlightRef = useRef(false);
    const [items, setItems] = useState<WaitingRoomNotification[]>([]);
    const [locale, setLocale] = useState("es-MX");
    const [timeZone, setTimeZone] = useState("America/Mexico_City");
    const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        setDismissed(readDismissed());
    }, []);

    const dismiss = useCallback((id: string) => {
        setDismissed((current) => {
            const next = new Set(current);
            next.add(id);
            writeDismissed(next);
            return next;
        });
    }, []);

    useEffect(() => {
        if (isReception) return;
        let disposed = false;

        const poll = async () => {
            if (disposed || pollInFlightRef.current) return;
            pollInFlightRef.current = true;
            try {
                const response = await fetch("/api/professional-notifications/waiting-room", { cache: "no-store" });
                if (!response.ok) {
                    setItems([]);
                    return;
                }
                const payload = (await response.json()) as WaitingRoomPayload;
                if (disposed) return;
                setLocale(payload.locale || "es-MX");
                setTimeZone(payload.timeZone || "America/Mexico_City");
                setItems(Array.isArray(payload.notifications) ? payload.notifications : []);
            } catch (error) {
                console.error("Failed to poll waiting room notifications:", error);
            } finally {
                pollInFlightRef.current = false;
            }
        };

        void poll();
        const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
        return () => {
            disposed = true;
            window.clearInterval(interval);
        };
    }, [pathname, isReception]);

    const visibleItems = useMemo(
        () => items.filter((item) => !dismissed.has(`${item.type || "waiting_room"}:${item.id}`)).slice(0, 3),
        [dismissed, items],
    );

    if (isReception || visibleItems.length === 0) return null;

    return (
        <div className={cn("pointer-events-none fixed right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto", isInbox ? "top-20 max-h-[calc(100dvh-13rem)] sm:top-4 sm:max-h-[calc(100dvh-8rem)]" : "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-7rem)] sm:bottom-5")}>
            {visibleItems.map((item) => {
                const itemType = item.type || "waiting_room";
                const dismissKey = `${itemType}:${item.id}`;
                const isAppointmentRequest = itemType === "appointment_request";
                const arrivalLabel = item.arrivalAt
                    ? formatTimeInOperationZone(item.arrivalAt, locale, timeZone, { hour12: true })
                    : "Ahora";
                const appointmentLabel = formatTimeInOperationZone(item.startTime, locale, timeZone, { hour12: true });
                const tenantSlug = tenantSlugFromPath(pathname);
                const destination = isAppointmentRequest ? "/dashboard/reception" : "/dashboard/contacts";
                const primaryHref = (tenantSlug ? tenantDashboardPath(tenantSlug, destination) : destination)
                    + (isAppointmentRequest ? `?date=${getOperationDateKey(item.startTime, timeZone)}&request=${encodeURIComponent(item.id)}` : "");

                return (
                    <div
                        key={item.id}
                        className={cn(
                            "pointer-events-auto overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-2xl shadow-slate-950/15",
                            "animate-in slide-in-from-bottom-3 fade-in duration-200",
                        )}
                    >
                        <div className="flex items-start gap-3 border-b bg-primary/5 p-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                {isAppointmentRequest ? <CalendarPlus className="h-5 w-5" /> : <UserCheck className="h-5 w-5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">
                                            {isAppointmentRequest ? "Nueva solicitud de cita" : "Cliente listo para atención"}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">Cliente</p>
                                        <p className="mt-0.5 break-words text-base font-bold text-foreground">{item.patientName}</p>
                                    </div>
                                    {!isAppointmentRequest && <button
                                        type="button"
                                        onClick={() => dismiss(dismissKey)}
                                        className="rounded-full p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                                        aria-label="Cerrar notificacion"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>}
                                </div>
                                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                                    {isAppointmentRequest ? (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Clock3 className="h-3.5 w-3.5 text-primary" />
                                            {formatDateTimeInOperationZone(item.startTime, locale, timeZone, { weekday: "short", hour12: true })}
                                        </span>
                                    ) : null}
                                    <span className={cn("inline-flex items-center gap-1.5", isAppointmentRequest && "hidden")}>
                                        <Clock3 className="h-3.5 w-3.5 text-primary" />
                                        Cita {appointmentLabel} · llego {arrivalLabel}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <BellRing className="h-3.5 w-3.5 text-primary" />
                                        {item.serviceName || item.title}
                                    </span>
                                    {isAppointmentRequest && <span>Profesional: {item.specialistName || "Por asignar"}</span>}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 p-3">
                            <Button asChild variant="outline" className="min-h-11">
                                <Link href={primaryHref}>{isAppointmentRequest ? "Revisar solicitud" : "Abrir ficha"}</Link>
                            </Button>
                            {!isAppointmentRequest && <Button size="sm" onClick={() => dismiss(dismissKey)}>
                                Entendido
                            </Button>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
