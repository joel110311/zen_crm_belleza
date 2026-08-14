"use client";

import { useMemo, useState } from "react";
import { es } from "date-fns/locale";
import { CalendarClock, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { CampaignFormState } from "@/components/settings/bulk-campaign-manager-shared";
import {
    formatFollowUpCadenceLabel,
    getAudienceModeLabel,
} from "@/components/settings/bulk-campaign-manager-shared";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { shiftDateKey } from "@/lib/calendar/business-hours";
import {
    formatDateTimeInOperationZone,
    getLocalCalendarDateKey,
    operationInputValueToUtc,
    operationInstantToLocalWallDate,
} from "@/lib/operation-dates";
import { cn } from "@/lib/utils";

type BulkCampaignScheduleTabProps = {
    form: CampaignFormState;
    totalPreviewRecipients: number;
    totalPlannedTouches: number;
    estimatedDeliveryMinutes: number;
    followUpWindowDays: number;
    onFormChange: (updater: (current: CampaignFormState) => CampaignFormState) => void;
};

function padDatePart(value: number) {
    return String(value).padStart(2, "0");
}

function buildWallDateTimeValue(date: Date) {
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function parseWallDateTimeValue(value: string) {
    if (!value) return null;

    const [datePart, timePart] = value.split("T");
    if (!datePart || !timePart) return null;

    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);

    if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
        return null;
    }

    return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function formatOperationInputValue(value: string, locale: string, timeZone: string, fallback = "Inmediato") {
    const utcDate = operationInputValueToUtc(value, timeZone);
    return utcDate ? formatDateTimeInOperationZone(utcDate, locale, timeZone) : fallback;
}

function buildDefaultScheduledStartValue(timeZone: string) {
    const next = operationInstantToLocalWallDate(new Date(), timeZone);
    next.setSeconds(0, 0);

    const roundedMinutes = Math.ceil(next.getMinutes() / 5) * 5;
    if (roundedMinutes >= 60) {
        next.setHours(next.getHours() + 1, 0, 0, 0);
    } else {
        next.setMinutes(roundedMinutes, 0, 0);
    }

    return buildWallDateTimeValue(next);
}

type ScheduledStartPickerProps = {
    value: string;
    onChange: (value: string) => void;
};

function ScheduledStartPicker({ value, onChange }: ScheduledStartPickerProps) {
    const operationContext = useOperationContext();
    const [open, setOpen] = useState(false);
    const [draftValue, setDraftValue] = useState(value || buildDefaultScheduledStartValue(operationContext.timeZone));

    const draftDate = useMemo(
        () => parseWallDateTimeValue(draftValue) ?? parseWallDateTimeValue(buildDefaultScheduledStartValue(operationContext.timeZone)) ?? operationInstantToLocalWallDate(new Date(), operationContext.timeZone),
        [draftValue, operationContext.timeZone],
    );

    const draftTime = `${padDatePart(draftDate.getHours())}:${padDatePart(draftDate.getMinutes())}`;
    const triggerLabel = value
        ? formatOperationInputValue(value, operationContext.locale, operationContext.timeZone, "Seleccionar fecha y hora")
        : "Seleccionar fecha y hora";

    const handleDateChange = (date: Date | undefined) => {
        if (!date) return;

        setDraftValue(`${getLocalCalendarDateKey(date)}T${draftTime}`);
    };

    const handleTimeChange = (nextTime: string) => {
        const [hours, minutes] = nextTime.split(":").map(Number);
        if ([hours, minutes].some((part) => Number.isNaN(part))) {
            return;
        }

        setDraftValue(`${getLocalCalendarDateKey(draftDate)}T${padDatePart(hours)}:${padDatePart(minutes)}`);
    };

    const handleCancel = () => {
        setDraftValue(value || buildDefaultScheduledStartValue(operationContext.timeZone));
        setOpen(false);
    };

    const handleApply = () => {
        onChange(draftValue);
        setOpen(false);
    };

    const handleClear = () => {
        onChange("");
        setDraftValue(buildDefaultScheduledStartValue(operationContext.timeZone));
        setOpen(false);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setDraftValue(value || buildDefaultScheduledStartValue(operationContext.timeZone));
        }
        setOpen(nextOpen);
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full justify-between rounded-xl px-3 font-normal"
                >
                    <span className={cn("truncate text-left", !value && "text-muted-foreground")}>
                        {triggerLabel}
                    </span>
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
            </PopoverTrigger>

            <PopoverContent
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="flex max-h-[min(86vh,44rem)] w-[min(100vw-2rem,24rem)] flex-col overflow-hidden p-0"
            >
                <div className="shrink-0 border-b px-4 py-3">
                    <p className="font-medium">Programar inicio</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Elige fecha y hora y confirma con <span className="font-medium text-foreground">Aplicar</span>.
                    </p>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="rounded-xl border bg-background/90 p-2">
                        <Calendar
                            mode="single"
                            selected={draftDate}
                            onSelect={handleDateChange}
                            locale={es}
                            initialFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="bulk-campaign-start-time">Hora de inicio</Label>
                        <Input
                            id="bulk-campaign-start-time"
                            type="time"
                            step={60}
                            value={draftTime}
                            onChange={(event) => handleTimeChange(event.target.value)}
                        />
                    </div>

                    <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Quedara programada para{" "}
                        <span className="font-medium text-foreground">
                            {formatOperationInputValue(draftValue, operationContext.locale, operationContext.timeZone, "una fecha valida")}
                        </span>
                        .
                    </div>
                </div>

                <div className="shrink-0 border-t bg-popover px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={handleClear} disabled={!value}>
                            Quitar programacion
                        </Button>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                                Cancelar
                            </Button>
                            <Button type="button" size="sm" onClick={handleApply}>
                                Aplicar
                            </Button>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function BulkCampaignScheduleTab({
    form,
    totalPreviewRecipients,
    totalPlannedTouches,
    estimatedDeliveryMinutes,
    followUpWindowDays,
    onFormChange,
}: BulkCampaignScheduleTabProps) {
    const operationContext = useOperationContext();
    const followUpTimeline = useMemo(() => {
        if (form.followUpCount <= 0) {
            return [];
        }

        const [dateKey, time = "00:00"] = form.scheduledStartAt.split("T");
        return Array.from({ length: form.followUpCount }, (_, index) => {
            const attemptNumber = index + 1;
            const offsetDays = attemptNumber * Math.max(1, form.followUpDelayDays);
            const plannedDate = dateKey
                ? operationInputValueToUtc(`${shiftDateKey(dateKey, offsetDays)}T${time}`, operationContext.timeZone)
                : null;

            return {
                attemptNumber,
                offsetDays,
                label: plannedDate
                    ? formatDateTimeInOperationZone(plannedDate, operationContext.locale, operationContext.timeZone)
                    : `${offsetDays} ${offsetDays === 1 ? "dia" : "dias"} despues del arranque`,
            };
        });
    }, [form.followUpCount, form.followUpDelayDays, form.scheduledStartAt, operationContext.locale, operationContext.timeZone]);

    return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
            <div className="min-w-0 space-y-4">
                <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        <p className="font-medium">Disparo inicial</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Si dejas este campo vacio, la campaña inicia en cuanto pulses empezar.
                    </p>
                    <div className="mt-4 space-y-2">
                        <Label>Programar inicio</Label>
                        <ScheduledStartPicker
                            value={form.scheduledStartAt}
                            onChange={(nextValue) =>
                                onFormChange((current) => ({ ...current, scheduledStartAt: nextValue }))
                            }
                        />
                    </div>
                </div>

                <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Pacing humano</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Asi rompes el patron rigido entre mensajes y haces mas natural la campaña.
                    </p>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Delay minimo por mensaje (segundos)</Label>
                            <Input
                                type="number"
                                min={5}
                                max={1800}
                                value={String(form.randomDelayMinSeconds)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        randomDelayMinSeconds: Number.parseInt(event.target.value || "25", 10) || 25,
                                    }))
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Delay maximo por mensaje (segundos)</Label>
                            <Input
                                type="number"
                                min={5}
                                max={1800}
                                value={String(form.randomDelayMaxSeconds)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        randomDelayMaxSeconds: Number.parseInt(event.target.value || "75", 10) || 75,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Tamano de sublote</Label>
                            <Input
                                type="number"
                                min={1}
                                max={100}
                                value={String(form.batchSize)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        batchSize: Number.parseInt(event.target.value || "3", 10) || 3,
                                    }))
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Pausa larga tras cada sublote (minutos)</Label>
                            <Input
                                type="number"
                                min={0}
                                max={1440}
                                value={String(form.batchDelayMinutes)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        batchDelayMinutes: Number.parseInt(event.target.value || "0", 10) || 0,
                                    }))
                                }
                            />
                        </div>
                    </div>
                </div>

                <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Guardarrailes</p>
                    </div>
                    <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-background/85 px-4 py-3">
                            <div>
                                <p className="font-medium">Respetar horario habil del CRM</p>
                                <p className="text-sm text-muted-foreground">
                                    Usa la franja horaria definida en configuracion.
                                </p>
                            </div>
                            <Switch
                                checked={form.respectBusinessHours}
                                onCheckedChange={(checked) =>
                                    onFormChange((current) => ({ ...current, respectBusinessHours: checked }))
                                }
                                className="shrink-0"
                            />
                        </div>

                        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-background/85 px-4 py-3">
                            <div>
                                <p className="font-medium">Detener secuencia cuando el lead responda</p>
                                <p className="text-sm text-muted-foreground">
                                    {form.stopOnReply
                                        ? "Si responde cualquier cosa, ya no se enviaran seguimientos extras. 'Detener' tambien lo bloquea de futuros masivos y lo manda a Cerrado Perdido."
                                        : "Si responde algo neutral, la secuencia puede continuar. 'Detener' siempre bloquea futuros masivos y 'me interesa' activa el bot."}
                                </p>
                            </div>
                            <Switch
                                checked={form.stopOnReply}
                                onCheckedChange={(checked) =>
                                    onFormChange((current) => ({ ...current, stopOnReply: checked }))
                                }
                                className="shrink-0"
                            />
                        </div>

                        <div className="rounded-xl border bg-background/85 px-4 py-3">
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Seguimientos extra si no responde</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={12}
                                        value={String(form.followUpCount)}
                                        onChange={(event) =>
                                            onFormChange((current) => ({
                                                ...current,
                                                followUpCount: Math.min(
                                                    12,
                                                    Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                                                ),
                                            }))
                                        }
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Cadencia entre seguimientos (dias)</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={String(form.followUpDelayDays)}
                                        disabled={form.followUpCount === 0}
                                        onChange={(event) =>
                                            onFormChange((current) => ({
                                                ...current,
                                                followUpDelayDays: Math.min(
                                                    30,
                                                    Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                                                ),
                                            }))
                                        }
                                    />
                                </div>
                            </div>

                            <div className="mt-3 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                    {form.followUpCount > 0
                                        ? `Despues del primer mensaje, el CRM intentara hasta ${form.followUpCount} seguimientos adicionales por contacto, ${formatFollowUpCadenceLabel(form.followUpDelayDays)}.`
                                        : "Solo se enviara el primer mensaje; no habra seguimientos automaticos adicionales."}
                                </p>
                                {form.followUpCount > 0 ? (
                                    <div className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
                                        <p className="font-medium text-foreground">Linea de tiempo estimada</p>
                                        <div className="mt-2 space-y-1.5">
                                            {followUpTimeline.map((item) => (
                                                <p key={item.attemptNumber}>
                                                    Seguimiento {item.attemptNumber}:{" "}
                                                    <span className="font-medium text-foreground">{item.label}</span>
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="min-w-0 space-y-4">
                <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Simulacion de arranque</p>
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                        <div className="rounded-xl border bg-background/85 p-3">
                            Primer disparo: <span className="font-semibold text-foreground">{form.scheduledStartAt ? formatOperationInputValue(form.scheduledStartAt, operationContext.locale, operationContext.timeZone, "cuando pulses iniciar") : "cuando pulses iniciar"}</span>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            Luego el sistema intercalara delays de <span className="font-semibold text-foreground">{form.randomDelayMinSeconds}</span> a <span className="font-semibold text-foreground">{form.randomDelayMaxSeconds}</span> segundos por mensaje.
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            {form.followUpCount > 0 ? (
                                <>
                                    La secuencia contempla <span className="font-semibold text-foreground">{form.followUpCount}</span> seguimientos extras por contacto, <span className="font-semibold text-foreground">{formatFollowUpCadenceLabel(form.followUpDelayDays)}</span>, para un total estimado de <span className="font-semibold text-foreground">{totalPlannedTouches}</span> envios.
                                </>
                            ) : (
                                <>
                                    La secuencia contempla solo el disparo inicial y un total estimado de <span className="font-semibold text-foreground">{totalPlannedTouches}</span> envios.
                                </>
                            )}
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            Cada {form.batchSize} mensajes aplicara una pausa larga de {form.batchDelayMinutes} minutos.
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            {form.followUpCount > 0 ? (
                                <>
                                    Ventana total estimada: <span className="font-semibold text-foreground">{followUpWindowDays} {followUpWindowDays === 1 ? "dia" : "dias"}</span> entre el primer envio y el ultimo seguimiento, con <span className="font-semibold text-foreground">{estimatedDeliveryMinutes} minutos</span> aproximados de envio activo.
                                </>
                            ) : (
                                <>
                                    Duracion estimada para esta audiencia: <span className="font-semibold text-foreground">{estimatedDeliveryMinutes} minutos</span> para {totalPreviewRecipients} contactos.
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <p className="font-medium">Resumen operativo</p>
                    <div className="mt-4 grid gap-3 text-sm">
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Estado actual</p>
                            <p className="mt-2 font-medium capitalize">{form.status}</p>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Modo de audiencia</p>
                            <p className="mt-2 font-medium">{getAudienceModeLabel(form.audienceMode)}</p>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cadencia</p>
                            <p className="mt-2 font-medium">
                                {form.batchSize} mensajes por sublote, {form.batchDelayMinutes} min de pausa larga.
                            </p>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Seguimientos</p>
                            <p className="mt-2 font-medium">
                                {form.followUpCount > 0
                                    ? `${form.followUpCount} extras por contacto, ${formatFollowUpCadenceLabel(form.followUpDelayDays)}`
                                    : "Sin seguimientos extras"}
                            </p>
                            {form.followUpCount > 0 ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Ultimo toque estimado a {followUpWindowDays} {followUpWindowDays === 1 ? "dia" : "dias"} del arranque.
                                </p>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
