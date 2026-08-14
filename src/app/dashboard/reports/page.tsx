"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BarChart3, Download, Loader2, RefreshCw } from "lucide-react";
import { getBillingReport } from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getOperationTodayKey } from "@/lib/operation-dates";

type ReportData = Awaited<ReturnType<typeof getBillingReport>>;

function groupCount(row: { _count?: number | { _all?: number } }) {
    if (typeof row._count === "number") return row._count;
    return row._count?._all || 0;
}

function statusLabel(value: string) {
    const labels: Record<string, string> = {
        scheduled: "Agendadas",
        waiting: "En sala",
        called: "Llamadas",
        in_progress: "En consulta",
        completed: "Completadas",
        cancelled: "Canceladas",
        no_show: "No asistio",
        paid: "Pagadas",
        pending: "Pendientes",
        unpaid: "Sin pago",
    };
    return labels[value] || value;
}

export default function ReportsPage() {
    const [isPending, startTransition] = useTransition();
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [report, setReport] = useState<ReportData | null>(null);
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        defaultCurrency: "MXN",
        timeZone: "America/Mexico_City",
    });
    const datesTouchedRef = useRef(false);

    const formatDateTime = useCallback(
        (date: string | Date) =>
            new Intl.DateTimeFormat(operationContext.locale, {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: operationContext.timeZone,
            }).format(new Date(date)),
        [operationContext.locale, operationContext.timeZone],
    );

    const formatMoney = useCallback(
        (amount: number, currency = operationContext.defaultCurrency) =>
            new Intl.NumberFormat(operationContext.locale, {
                style: "currency",
                currency,
            }).format(amount || 0),
        [operationContext.defaultCurrency, operationContext.locale],
    );

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active) return;
                const timeZone = context?.timeZone || "America/Mexico_City";
                const today = getOperationTodayKey(timeZone);
                setOperationContext({
                    locale: context?.locale || "es-MX",
                    defaultCurrency: context?.defaultCurrency || "MXN",
                    timeZone,
                });
                if (!datesTouchedRef.current) {
                    setDateFrom(today);
                    setDateTo(today);
                } else {
                    setDateFrom((current) => current || today);
                    setDateTo((current) => current || today);
                }
            })
            .catch(() => {
                if (!active) return;
                const today = getOperationTodayKey("America/Mexico_City");
                setDateFrom((current) => current || today);
                setDateTo((current) => current || today);
            });

        return () => {
            active = false;
        };
    }, []);

    const load = useCallback(() => {
        if (!dateFrom || !dateTo) return;
        startTransition(async () => {
            const data = await getBillingReport(dateFrom, dateTo);
            setReport(data);
        });
    }, [dateFrom, dateTo]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!dateFrom || !dateTo) return;

        const intervalId = window.setInterval(() => {
            load();
        }, 10000);

        return () => window.clearInterval(intervalId);
    }, [dateFrom, dateTo, load]);

    const movementCsv = useMemo(() => {
        const rows = [
            ["Fecha", "Tipo", "Concepto", "Metodo", "Monto", "Moneda", "Paciente", "Especialista"],
            ...(report?.movements || []).map((movement) => [
                formatDateTime(movement.occurredAt),
                movement.type,
                movement.concept,
                movement.paymentMethod || "",
                String(movement.amount),
                movement.currency,
                [movement.patient?.firstName, movement.patient?.lastName].filter(Boolean).join(" "),
                movement.specialist?.displayName || movement.specialist?.name || "",
            ]),
        ];
        return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    }, [formatDateTime, report]);

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold">
                        <BarChart3 className="h-6 w-6 text-primary" />
                        Reportes
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Estadisticas de citas, cobranza y movimientos exportables.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input type="date" value={dateFrom} onChange={(event) => {
                        datesTouchedRef.current = true;
                        setDateFrom(event.target.value);
                    }} className="h-10 bg-background sm:w-[170px]" />
                    <Input type="date" value={dateTo} onChange={(event) => {
                        datesTouchedRef.current = true;
                        setDateTo(event.target.value);
                    }} className="h-10 bg-background sm:w-[170px]" />
                    <Button variant="outline" onClick={load} disabled={isPending || !dateFrom || !dateTo}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Refrescar
                    </Button>
                    <Button variant="outline" asChild>
                        <a download={`reporte-${dateFrom}-${dateTo}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(movementCsv)}`}>
                            <Download className="mr-2 h-4 w-4" />
                            CSV
                        </a>
                    </Button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Ingresos</p>
                        <p className="mt-2 text-2xl font-bold text-emerald-600">{formatMoney(report?.income || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Egresos</p>
                        <p className="mt-2 text-2xl font-bold text-red-600">{formatMoney(report?.expense || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Balance</p>
                        <p className="mt-2 text-2xl font-bold">{formatMoney(report?.balance || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Movimientos</p>
                        <p className="mt-2 text-2xl font-bold">{report?.movements.length || 0}</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Citas por estado</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {report?.appointmentsByStatus.map((row) => (
                            <div key={row.status} className="flex items-center justify-between rounded-xl border px-4 py-3">
                                <span className="font-medium">{statusLabel(row.status)}</span>
                                <Badge variant="secondary">{groupCount(row)}</Badge>
                            </div>
                        ))}
                        {report && report.appointmentsByStatus.length === 0 ? (
                            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Sin citas en el rango.</p>
                        ) : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Pagos por estado</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {report?.appointmentsByPayment.map((row) => (
                            <div key={row.paymentStatus} className="flex items-center justify-between rounded-xl border px-4 py-3">
                                <div>
                                    <p className="font-medium">{statusLabel(row.paymentStatus)}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Programado: {formatMoney(row._sum.paymentAmount || 0)}
                                    </p>
                                </div>
                                <Badge variant="secondary">{groupCount(row)}</Badge>
                            </div>
                        ))}
                        {report && report.appointmentsByPayment.length === 0 ? (
                            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Sin pagos en el rango.</p>
                        ) : null}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Movimientos recientes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {report?.movements.slice(-12).reverse().map((movement) => (
                        <div key={movement.id} className="grid gap-2 rounded-xl border px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-center">
                            <span className="text-sm text-muted-foreground">{formatDateTime(movement.occurredAt)}</span>
                            <div className="min-w-0">
                                <p className="truncate font-medium">{movement.concept}</p>
                                <p className="text-xs text-muted-foreground">{movement.paymentMethod || "metodo"} - {movement.appointment?.title || "sin cita"}</p>
                            </div>
                            <span className={movement.type === "income" ? "font-bold text-emerald-600" : "font-bold text-red-600"}>
                                {movement.type === "expense" ? "-" : ""}{formatMoney(movement.amount, movement.currency)}
                            </span>
                        </div>
                    ))}
                    {report && report.movements.length === 0 ? (
                        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No hay movimientos para exportar.</p>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}
