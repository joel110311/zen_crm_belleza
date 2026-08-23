"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Banknote, CheckCircle2, CreditCard, Loader2, Minus, Plus, Printer, ReceiptText, RefreshCw, Search, Send, ShoppingCart, Trash2, X } from "lucide-react";
import {
    closeCashDesk,
    createPaymentLink,
    deleteCashMovement,
    getBillableServices,
    getCashDesk,
    markPaymentLinkPaid,
    saveCashMovement,
    sendPaymentLink,
} from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { getOperationTodayKey } from "@/lib/operation-dates";

type CashDeskData = Awaited<ReturnType<typeof getCashDesk>>;
type BillableService = Awaited<ReturnType<typeof getBillableServices>>[number];
type SaleItem = BillableService & {
    tempId: string;
    quantity: number;
};

export default function BillingPage() {
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [selectedDate, setSelectedDate] = useState(getOperationTodayKey());
    const [desk, setDesk] = useState<CashDeskData | null>(null);
    const [services, setServices] = useState<BillableService[]>([]);
    const [movementForm, setMovementForm] = useState({
        type: "income",
        concept: "",
        amount: "",
        currency: "MXN",
        paymentMethod: "efectivo",
    });
    const [serviceSearch, setServiceSearch] = useState("");
    const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
    const [customItem, setCustomItem] = useState({
        name: "",
        category: "Otro",
        price: "",
    });
    const [linkForm, setLinkForm] = useState({
        title: "Servicio",
        amount: "",
        currency: "MXN",
        url: "",
    });
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        currencies: ["MXN"],
        defaultCurrency: "MXN",
        timeZone: "America/Mexico_City",
    });
    const dateTouchedRef = useRef(false);

    const load = useCallback(async () => {
        const [data, catalog] = await Promise.all([
            getCashDesk(selectedDate),
            getBillableServices(),
        ]);
        setDesk(data);
        setServices(catalog);
    }, [selectedDate]);

    const formatMoney = useCallback(
        (amount: number, currency = operationContext.defaultCurrency) =>
            new Intl.NumberFormat(operationContext.locale, {
                style: "currency",
                currency,
            }).format(amount),
        [operationContext.defaultCurrency, operationContext.locale],
    );

    const filteredServices = useMemo(() => {
        const query = serviceSearch.trim().toLowerCase();
        if (!query) return services;
        return services.filter((service) =>
            [service.name, service.description || "", service.category].some((value) => value.toLowerCase().includes(query)),
        );
    }, [serviceSearch, services]);

    const saleSubtotal = useMemo(
        () => saleItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        [saleItems],
    );

    const movementAmount = saleItems.length > 0 ? saleSubtotal : Number(movementForm.amount || 0);

    useEffect(() => {
        let active = true;
        const loadInitial = async () => {
            const context = await fetch("/api/operation-context", { cache: "no-store" })
                .then(async (response) => (response.ok ? response.json() : null))
                .catch(() => null);

            let effectiveDate = selectedDate;
            if (context) {
                const nextTimeZone = context.timeZone || "America/Mexico_City";
                const today = getOperationTodayKey(nextTimeZone);
                const currencies = Array.isArray(context.currencies) && context.currencies.length > 0 ? context.currencies : ["MXN"];
                const defaultCurrency = context.defaultCurrency || currencies[0] || "MXN";
                if (!dateTouchedRef.current) {
                    effectiveDate = today;
                    setSelectedDate(today);
                }
                setOperationContext({
                    locale: context.locale || "es-MX",
                    currencies,
                    defaultCurrency,
                    timeZone: nextTimeZone,
                });
                setMovementForm((current) => ({ ...current, currency: currencies.includes(current.currency) ? current.currency : defaultCurrency }));
                setLinkForm((current) => ({ ...current, currency: currencies.includes(current.currency) ? current.currency : defaultCurrency }));
            }

            const [data, catalog] = await Promise.all([
                getCashDesk(effectiveDate),
                getBillableServices(),
            ]);
            if (!active) return;
            setDesk(data);
            setServices(catalog);
        };

        void loadInitial();
        return () => {
            active = false;
        };
    }, [selectedDate]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            void load();
        }, 10000);

        return () => window.clearInterval(intervalId);
    }, [load]);

    const movementCsv = useMemo(() => {
        const rows = [
            ["Fecha", "Tipo", "Concepto", "Metodo", "Monto", "Moneda", "Paciente", "Especialista", "Reportado por"],
            ...(desk?.movements || []).map((movement) => [
                new Date(movement.occurredAt).toLocaleString(operationContext.locale, {
                    timeZone: operationContext.timeZone,
                }),
                movement.type,
                movement.concept,
                movement.paymentMethod || "",
                String(movement.amount),
                movement.currency,
                [movement.patient?.firstName, movement.patient?.lastName].filter(Boolean).join(" "),
                movement.specialist?.displayName || movement.specialist?.name || "",
                movement.recordedBy?.name || movement.recordedBy?.email || "Sin usuario asignado",
            ]),
        ];
        return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    }, [desk, operationContext.locale, operationContext.timeZone]);

    const formatMovementTime = useCallback(
        (date: string | Date) =>
            new Intl.DateTimeFormat(operationContext.locale, {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: operationContext.timeZone,
            }).format(new Date(date)),
        [operationContext.locale, operationContext.timeZone],
    );

    const printHtml = useCallback((title: string, html: string) => {
        const printWindow = window.open("", "_blank", "width=420,height=720");
        if (!printWindow) {
            toast({ title: "No se pudo abrir impresion", description: "Permite ventanas emergentes para imprimir.", variant: "destructive" });
            return;
        }
        printWindow.document.write(`<!doctype html><html><head><title>${title}</title><style>
            body{font-family:Inter,Arial,sans-serif;margin:0;background:#f3f6fb;color:#0f172a}
            .page{width:80mm;margin:16px auto;background:white;padding:16px;box-shadow:0 18px 50px rgba(15,23,42,.16)}
            .mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.45}
            .center{text-align:center}.bold{font-weight:800}.muted{color:#64748b}.row{display:flex;justify-content:space-between;gap:12px}
            .line{border-top:1px dashed #94a3b8;margin:10px 0}.total{font-size:18px;font-weight:900}
            @media print{body{background:white}.page{box-shadow:none;margin:0;width:auto}.no-print{display:none}}
        </style></head><body><div class="page mono">${html}</div><script>window.onload=()=>{window.print()}</script></body></html>`);
        printWindow.document.close();
    }, [toast]);

    const printTicket = useCallback((movement: NonNullable<CashDeskData>["movements"][number]) => {
        if (!desk?.pos?.ticketEnabled) {
            toast({ title: "Ticket desactivado", description: "Activalo en Mi Negocio > Operacion > Caja, IVA y ticket." });
            return;
        }
        const header = String(desk.pos.ticketHeader || operationContext.defaultCurrency)
            .split("\n")
            .filter(Boolean)
            .map((line) => `<div class="center ${line === String(desk.pos.ticketHeader || "").split("\n")[0] ? "bold" : ""}">${line}</div>`)
            .join("");
        const footer = String(desk.pos.ticketFooter || "")
            .split("\n")
            .filter(Boolean)
            .map((line) => `<div class="center">${line}</div>`)
            .join("");
        const taxRate = desk.pos.taxEnabled ? Number(desk.pos.taxRate || 0) : 0;
        const subtotal = taxRate > 0 ? movement.amount / (1 + taxRate / 100) : movement.amount;
        const tax = movement.amount - subtotal;
        printHtml("Ticket de venta", `
            ${header}
            <div class="line"></div>
            <div>${new Date(movement.occurredAt).toLocaleString(operationContext.locale, { timeZone: operationContext.timeZone })}</div>
            <div class="line"></div>
            <div class="row"><span>1 ${movement.concept}</span><span>${formatMoney(movement.amount, movement.currency)}</span></div>
            ${desk.pos.ticketShowUnitPrice ? `<div class="muted">P.U. ${formatMoney(movement.amount, movement.currency)}</div>` : ""}
            ${desk.pos.taxEnabled ? `<div class="line"></div><div class="row"><span>Subtotal</span><span>${formatMoney(subtotal, movement.currency)}</span></div><div class="row"><span>IVA ${taxRate}%</span><span>${formatMoney(tax, movement.currency)}</span></div>` : ""}
            <div class="line"></div>
            <div class="row total"><span>Total</span><span>${formatMoney(movement.amount, movement.currency)}</span></div>
            <div class="row"><span>Metodo</span><span>${movement.paymentMethod || "N/A"}</span></div>
            <div class="line"></div>
            ${footer}
        `);
    }, [desk?.pos, formatMoney, operationContext.defaultCurrency, operationContext.locale, operationContext.timeZone, printHtml, toast]);

    const printClosure = useCallback(() => {
        if (!desk) return;
        const methodRows = Object.entries(desk.methodSummary || {})
            .map(([method, summary]) => `<div class="row"><span>${method}</span><span>${formatMoney(summary.income - summary.expense)}</span></div>`)
            .join("");
        const userRows = Object.entries(desk.openUserSummary || {})
            .map(([, summary]) => `
                <div>
                    <div class="bold">${summary.name}</div>
                    <div class="row"><span>Ingresos</span><span>${formatMoney(summary.income)}</span></div>
                    <div class="row"><span>Egresos</span><span>${formatMoney(summary.expense)}</span></div>
                    <div class="row"><span>Balance</span><span>${formatMoney(summary.income - summary.expense)}</span></div>
                </div>
            `)
            .join('<div class="line"></div>');
        printHtml("Corte de caja", `
            <div class="center bold">CORTE DE CAJA</div>
            <div class="center muted">${selectedDate}</div>
            <div class="line"></div>
            <div class="row"><span>Ingresos</span><span>${formatMoney(desk.income)}</span></div>
            <div class="row"><span>Egresos</span><span>${formatMoney(desk.expense)}</span></div>
            <div class="row total"><span>Saldo</span><span>${formatMoney(desk.balance)}</span></div>
            <div class="line"></div>
            <div class="bold">Responsables del corte</div>
            ${userRows || `<div class="muted">Sin movimientos reportados</div>`}
            <div class="line"></div>
            <div class="bold">Pagos por método</div>
            ${methodRows || `<div class="muted">Sin movimientos</div>`}
            <div class="line"></div>
            <div class="row"><span>Movimientos</span><span>${desk.count}</span></div>
            <div class="row"><span>Turnos pagados</span><span>${desk.paidAppointments}</span></div>
        `);
    }, [desk, formatMoney, printHtml, selectedDate]);

    const runAction = (task: () => Promise<{ success: boolean; error?: string }>, successTitle: string, afterSuccess?: () => void) => {
        startTransition(async () => {
            const result = await task();
            if (!result.success) {
                toast({ title: "No se pudo completar", description: result.error, variant: "destructive" });
                return;
            }
            afterSuccess?.();
            toast({ title: successTitle });
            await load();
        });
    };

    const addSaleItem = (service: BillableService) => {
        setMovementForm((current) => ({ ...current, type: "income" }));
        setSaleItems((current) => {
            const existing = current.find((item) => item.id === service.id);
            if (existing) {
                return current.map((item) =>
                    item.tempId === existing.tempId ? { ...item, quantity: item.quantity + 1 } : item,
                );
            }
            return [
                ...current,
                {
                    ...service,
                    tempId: `${service.id}-${Date.now()}-${Math.random()}`,
                    quantity: 1,
                },
            ];
        });
    };

    const updateSaleItemQuantity = (tempId: string, delta: number) => {
        setSaleItems((current) =>
            current
                .map((item) => item.tempId === tempId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item)
                .filter((item) => item.quantity > 0),
        );
    };

    const addCustomSaleItem = () => {
        const name = customItem.name.trim();
        const price = Number(customItem.price);
        if (!name || !Number.isFinite(price) || price <= 0) {
            toast({ title: "Captura nombre y precio del concepto", variant: "destructive" });
            return;
        }
        addSaleItem({
            id: `custom-${Date.now()}`,
            name,
            description: null,
            category: customItem.category.trim() || "Otro",
            price,
            currency: movementForm.currency,
            durationMinutes: 0,
        });
        setCustomItem({ name: "", category: "Otro", price: "" });
    };

    const saveMovement = () => {
        const saleConcept = saleItems.length > 0
            ? saleItems.map((item) => `${item.quantity}x ${item.name}`).join(", ")
            : movementForm.concept;
        const saleNotes = saleItems.length > 0
            ? saleItems.map((item) => `${item.quantity} x ${item.name} - ${formatMoney(item.price * item.quantity, item.currency)}`).join("\n")
            : undefined;
        runAction(
            () => saveCashMovement({
                type: movementForm.type as "income" | "expense",
                concept: saleItems.length > 0 ? `Venta: ${saleConcept}` : movementForm.concept,
                amount: movementAmount,
                currency: movementForm.currency,
                paymentMethod: movementForm.paymentMethod,
                occurredAt: selectedDate,
                notes: saleNotes,
            }),
            "Movimiento guardado",
            () => {
                setMovementForm((current) => ({ ...current, amount: "" }));
                setSaleItems([]);
            },
        );
    };

    const saveLink = () => {
        runAction(
            () => createPaymentLink({
                title: linkForm.title,
                amount: Number(linkForm.amount),
                currency: linkForm.currency,
                url: linkForm.url,
                provider: linkForm.url ? "manual" : "manual",
            }),
            "Link de pago creado",
        );
    };

    const closeDesk = () => {
        runAction(
            () => closeCashDesk(selectedDate),
            "Corte de caja realizado",
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold">
                        <Banknote className="h-6 w-6 text-primary" />
                        Caja diaria
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Ingresos, egresos, links de pago y corte operativo.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input type="date" value={selectedDate} onChange={(event) => {
                        dateTouchedRef.current = true;
                        setSelectedDate(event.target.value);
                    }} className="h-10 bg-background sm:w-[170px]" />
                    <Button variant="outline" onClick={load} disabled={isPending}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refrescar
                    </Button>
                    <Button onClick={closeDesk} disabled={isPending || !desk || desk.openMovementCount === 0}>
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Hacer corte
                    </Button>
                    <Button variant="outline" onClick={printClosure} disabled={!desk}>
                        <Printer className="mr-2 h-4 w-4" />
                        Imprimir corte
                    </Button>
                    <Button variant="outline" asChild>
                        <a
                            download={`caja-${selectedDate}.csv`}
                            href={`data:text/csv;charset=utf-8,${encodeURIComponent(movementCsv)}`}
                        >
                            Exportar CSV
                        </a>
                    </Button>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Ingresos</p>
                        <p className="mt-2 text-2xl font-bold text-emerald-600">{formatMoney(desk?.income || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Egresos</p>
                        <p className="mt-2 text-2xl font-bold text-red-600">{formatMoney(desk?.expense || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Saldo</p>
                        <p className="mt-2 text-2xl font-bold">{formatMoney(desk?.balance || 0)}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">Turnos pagados</p>
                        <p className="mt-2 text-2xl font-bold">{desk?.paidAppointments || 0}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div>
                        <p className="text-sm font-semibold">Corte de caja</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {desk?.lastClosure
                                ? `Último corte: ${formatMovementTime(desk.lastClosure.closedAt)} por ${desk.lastClosure.closedBy?.name || desk.lastClosure.closedBy?.email || "usuario"}`
                                : "Sin corte registrado para esta fecha."}
                        </p>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-4 lg:min-w-[560px]">
                        <div className="rounded-xl border bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">Desde corte</p>
                            <p className="font-bold">{formatMoney(desk?.openBalance || 0)}</p>
                        </div>
                        <div className="rounded-xl border bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">Ingresos</p>
                            <p className="font-bold text-emerald-600">{formatMoney(desk?.openIncome || 0)}</p>
                        </div>
                        <div className="rounded-xl border bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">Egresos</p>
                            <p className="font-bold text-red-600">{formatMoney(desk?.openExpense || 0)}</p>
                        </div>
                        <div className="rounded-xl border bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">Movimientos</p>
                            <p className="font-bold">{desk?.openMovementCount || 0}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ReceiptText className="h-5 w-5 text-primary" />
                            Dinero en caja
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
                            <span>Ventas / entradas</span>
                            <span className="font-bold">{formatMoney(desk?.income || 0)}</span>
                        </div>
                        <div className="flex justify-between rounded-xl bg-red-50 px-3 py-2 text-red-800">
                            <span>Pagos / egresos</span>
                            <span className="font-bold">{formatMoney(desk?.expense || 0)}</span>
                        </div>
                        <div className="flex justify-between border-t px-3 pt-3 text-lg font-bold">
                            <span>Total en caja</span>
                            <span>{formatMoney(desk?.balance || 0)}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Responsables del corte</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {Object.entries(desk?.openUserSummary || {}).length > 0 ? Object.entries(desk?.openUserSummary || {}).map(([userId, summary]) => (
                            <div key={userId} className="rounded-xl border px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-semibold">{summary.name}</p>
                                        <p className="text-xs text-muted-foreground">{summary.count} movimiento(s) desde el último corte</p>
                                    </div>
                                    <p className="font-bold">{formatMoney(summary.income - summary.expense)}</p>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">
                                        Ingresos {formatMoney(summary.income)}
                                    </div>
                                    <div className="rounded-lg bg-red-50 px-2 py-1 text-red-700">
                                        Egresos {formatMoney(summary.expense)}
                                    </div>
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-xl border border-dashed px-3 py-6 text-center text-muted-foreground">
                                Sin responsables en el corte abierto.
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Pagos por método</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {Object.entries(desk?.methodSummary || {}).length > 0 ? Object.entries(desk?.methodSummary || {}).map(([method, summary]) => (
                            <div key={method} className="flex justify-between rounded-xl border px-3 py-2">
                                <span className="capitalize">{method.replace("_", " ")}</span>
                                <span className="font-bold">{formatMoney(summary.income - summary.expense)}</span>
                            </div>
                        )) : (
                            <div className="rounded-xl border border-dashed px-3 py-6 text-center text-muted-foreground">
                                Sin pagos en este corte.
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="xl:col-span-3">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Ventas por concepto</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(desk?.conceptSummary || {}).length > 0 ? Object.entries(desk?.conceptSummary || {}).slice(0, 9).map(([concept, summary]) => (
                            <div key={concept} className="rounded-xl border px-3 py-2 text-sm">
                                <p className="truncate font-semibold">{concept}</p>
                                <p className="mt-1 text-muted-foreground">{summary.count} movimiento(s)</p>
                                <p className="mt-2 font-bold">{formatMoney(summary.income - summary.expense)}</p>
                            </div>
                        )) : (
                            <div className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                                Sin conceptos registrados.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Movimientos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {desk?.movements.map((movement) => (
                            <div key={movement.id} className="grid gap-3 rounded-2xl border p-4 lg:grid-cols-[150px_minmax(0,1fr)_auto] lg:items-center">
                                <div>
                                    <p className="font-semibold">{formatMovementTime(movement.occurredAt)}</p>
                                    <Badge variant={movement.type === "income" ? "secondary" : "outline"}>
                                        {movement.type === "income" ? "Ingreso" : "Egreso"}
                                    </Badge>
                                </div>
                                <div className="min-w-0">
                                    <p className="font-semibold">{movement.concept}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Reportado por: {movement.recordedBy?.name || movement.recordedBy?.email || "Sin usuario asignado"}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {movement.paymentMethod || "metodo"} · {[movement.patient?.firstName, movement.patient?.lastName].filter(Boolean).join(" ") || "Sin paciente"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 lg:justify-end">
                                    <p className={movement.type === "income" ? "font-bold text-emerald-600" : "font-bold text-red-600"}>
                                        {formatMoney(movement.amount, movement.currency)}
                                    </p>
                                    {movement.type === "income" ? (
                                        <Button size="icon-sm" variant="ghost" onClick={() => printTicket(movement)} title="Imprimir ticket">
                                            <Printer className="h-4 w-4" />
                                        </Button>
                                    ) : null}
                                    <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => runAction(() => deleteCashMovement(movement.id), "Movimiento cancelado")}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}

                        {!desk || desk.movements.length === 0 ? (
                            <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                                No hay movimientos registrados para esta fecha.
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Nuevo movimiento</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {movementForm.type === "income" ? (
                                <div className="space-y-3 rounded-2xl border bg-muted/10 p-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <ShoppingCart className="h-4 w-4 text-primary" />
                                        Agregar servicios al cobro
                                    </div>
                                    {services.length > 0 ? (
                                        <>
                                            <div className="relative">
                                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    value={serviceSearch}
                                                    onChange={(event) => setServiceSearch(event.target.value)}
                                                    placeholder="Buscar servicio..."
                                                    className="pl-9"
                                                />
                                            </div>
                                            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                                                {filteredServices.slice(0, 10).map((service) => (
                                                    <button
                                                        key={service.id}
                                                        type="button"
                                                        onClick={() => addSaleItem(service)}
                                                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-background px-3 py-2 text-left hover:border-primary/40 hover:bg-primary/5"
                                                    >
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-semibold">{service.name}</span>
                                                            <span className="block truncate text-xs text-muted-foreground">
                                                                {service.category} · {service.durationMinutes} min
                                                            </span>
                                                        </span>
                                                        <span className="text-sm font-bold text-emerald-600">{formatMoney(service.price, service.currency)}</span>
                                                    </button>
                                                ))}
                                                {filteredServices.length === 0 ? (
                                                    <div className="rounded-xl border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                                                        No hay servicios que coincidan con la búsqueda.
                                                    </div>
                                                ) : null}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="rounded-xl border border-dashed bg-background px-4 py-5 text-center">
                                            <p className="text-sm font-semibold">Aún no hay servicios capturados</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Los servicios activos que registres en el catálogo aparecerán aquí automáticamente.
                                            </p>
                                            <Button type="button" variant="outline" size="sm" className="mt-3" asChild>
                                                <a href="/dashboard/services">Ir a Servicios</a>
                                            </Button>
                                        </div>
                                    )}
                                    <div className="rounded-xl border bg-background p-3">
                                        <p className="text-sm font-semibold">Concepto libre</p>
                                        <div className="mt-2 grid gap-2">
                                            <Input
                                                value={customItem.name}
                                                onChange={(event) => setCustomItem((current) => ({ ...current, name: event.target.value }))}
                                                placeholder="Nombre del producto o servicio"
                                            />
                                            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                                                <Input
                                                    value={customItem.category}
                                                    onChange={(event) => setCustomItem((current) => ({ ...current, category: event.target.value }))}
                                                    placeholder="Categoria"
                                                />
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={customItem.price}
                                                    onChange={(event) => setCustomItem((current) => ({ ...current, price: event.target.value }))}
                                                    placeholder="Precio"
                                                />
                                            </div>
                                        </div>
                                        <Button type="button" variant="outline" className="mt-2 w-full" onClick={addCustomSaleItem}>
                                            <Plus className="mr-2 h-4 w-4" />
                                            Agregar
                                        </Button>
                                    </div>
                                    {saleItems.length > 0 ? (
                                        <div className="rounded-xl border bg-background p-3">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold">Resumen</p>
                                                <Badge variant="secondary">{saleItems.reduce((sum, item) => sum + item.quantity, 0)} articulo(s)</Badge>
                                            </div>
                                            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                                                {saleItems.map((item) => (
                                                    <div key={item.tempId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-muted/40 p-2">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-semibold">{item.name}</p>
                                                            <p className="text-xs text-muted-foreground">{item.quantity} x {formatMoney(item.price, movementForm.currency)}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <Button type="button" size="icon-xs" variant="ghost" onClick={() => updateSaleItemQuantity(item.tempId, -1)}>
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                                                            <Button type="button" size="icon-xs" variant="ghost" onClick={() => updateSaleItemQuantity(item.tempId, 1)}>
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button type="button" size="icon-xs" variant="ghost" className="text-destructive" onClick={() => setSaleItems((current) => current.filter((entry) => entry.tempId !== item.tempId))}>
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-3 flex items-center justify-between border-t pt-3 text-lg font-bold">
                                                <span>Total</span>
                                                <span>{formatMoney(saleSubtotal, movementForm.currency)}</span>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Tipo</Label>
                                    <Select value={movementForm.type} onValueChange={(value) => {
                                        setMovementForm((current) => ({ ...current, type: value }));
                                        if (value !== "income") setSaleItems([]);
                                    }}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="income">Ingreso</SelectItem>
                                            <SelectItem value="expense">Egreso</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Metodo</Label>
                                    <Select value={movementForm.paymentMethod} onValueChange={(value) => setMovementForm((current) => ({ ...current, paymentMethod: value }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="efectivo">Efectivo</SelectItem>
                                            <SelectItem value="tarjeta">Tarjeta</SelectItem>
                                            <SelectItem value="transferencia">Transferencia</SelectItem>
                                            <SelectItem value="link">Link</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Concepto</Label>
                                <Input
                                    value={saleItems.length > 0 ? saleItems.map((item) => `${item.quantity}x ${item.name}`).join(", ") : movementForm.concept}
                                    onChange={(event) => setMovementForm((current) => ({ ...current, concept: event.target.value }))}
                                    disabled={saleItems.length > 0}
                                />
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                                <div className="space-y-2">
                                    <Label>Monto</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={saleItems.length > 0 ? String(saleSubtotal) : movementForm.amount}
                                        onChange={(event) => setMovementForm((current) => ({ ...current, amount: event.target.value }))}
                                        disabled={saleItems.length > 0}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Moneda</Label>
                                    <Select value={movementForm.currency} onValueChange={(value) => setMovementForm((current) => ({ ...current, currency: value }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {operationContext.currencies.map((currency) => (
                                                <SelectItem key={currency} value={currency}>
                                                    {currency}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <Button onClick={saveMovement} disabled={isPending || (!saleItems.length && (!movementForm.concept || !movementForm.amount)) || movementAmount <= 0} className="w-full">
                                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Guardar movimiento
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <CreditCard className="h-5 w-5 text-primary" />
                                Links de pago
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-2">
                                <Label>Titulo</Label>
                                <Input value={linkForm.title} onChange={(event) => setLinkForm((current) => ({ ...current, title: event.target.value }))} />
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                                <div className="space-y-2">
                                    <Label>Monto</Label>
                                    <Input type="number" min="0" step="0.01" value={linkForm.amount} onChange={(event) => setLinkForm((current) => ({ ...current, amount: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Moneda</Label>
                                    <Select value={linkForm.currency} onValueChange={(value) => setLinkForm((current) => ({ ...current, currency: value }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {operationContext.currencies.map((currency) => (
                                                <SelectItem key={currency} value={currency}>
                                                    {currency}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>URL manual</Label>
                                <Input value={linkForm.url} onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." />
                            </div>
                            <Button variant="outline" onClick={saveLink} disabled={isPending || !linkForm.title || !linkForm.amount} className="w-full">
                                Crear link
                            </Button>

                            <div className="space-y-2 pt-2">
                                {desk?.pendingLinks.map((link) => (
                                    <div key={link.id} className="rounded-xl border p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold">{link.title}</p>
                                                <p className="text-xs text-muted-foreground">{formatMoney(link.amount, link.currency)} · {link.status}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button size="icon-xs" variant="ghost" onClick={() => runAction(() => sendPaymentLink(link.id), "Link enviado")}>
                                                    <Send className="h-3 w-3" />
                                                </Button>
                                                <Button size="icon-xs" variant="ghost" onClick={() => runAction(() => markPaymentLinkPaid(link.id), "Pago registrado")}>
                                                    <CheckCircle2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
