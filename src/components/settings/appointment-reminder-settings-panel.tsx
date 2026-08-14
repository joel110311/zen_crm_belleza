"use client";

import { Bell, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const REMINDER_PRESETS = [
    { key: "24_6", label: "24 horas y 6 horas antes", offsets: [1440, 360] },
    { key: "24_4", label: "24 horas y 4 horas antes", offsets: [1440, 240] },
    { key: "24_2", label: "24 horas y 2 horas antes", offsets: [1440, 120] },
    { key: "6", label: "Solo 6 horas antes", offsets: [360] },
    { key: "4", label: "Solo 4 horas antes", offsets: [240] },
    { key: "2", label: "Solo 2 horas antes", offsets: [120] },
] as const;

type ReminderProvider = "wuzapi" | "meta";

type Props = {
    enabled: boolean;
    offsets: number[];
    provider: ReminderProvider;
    sendOnlyConfirmed: boolean;
    wuzapiTemplate: string;
    metaTemplate24h: string;
    metaTemplate4h: string;
    metaLanguage: string;
    onEnabledChange: (value: boolean) => void;
    onOffsetsChange: (value: number[]) => void;
    onProviderChange: (value: ReminderProvider) => void;
    onSendOnlyConfirmedChange: (value: boolean) => void;
    onWuzapiTemplateChange: (value: string) => void;
    onMetaTemplate24hChange: (value: string) => void;
    onMetaTemplate4hChange: (value: string) => void;
    onMetaLanguageChange: (value: string) => void;
    onSave: () => void | boolean | Promise<void | boolean>;
    isSaving: boolean;
};

function normalizeOffsets(offsets: number[]) {
    return [...new Set(offsets)]
        .map((offset) => Number(offset))
        .filter((offset) => Number.isFinite(offset))
        .sort((left, right) => right - left)
        .join(",");
}

function getPresetKey(offsets: number[]) {
    const current = normalizeOffsets(offsets);
    return REMINDER_PRESETS.find((preset) => normalizeOffsets([...preset.offsets]) === current)?.key || "custom";
}

function offsetLabel(offset: number) {
    if (offset >= 1440 && offset % 1440 === 0) return `${offset / 1440} dia`;
    if (offset % 60 === 0) return `${offset / 60} horas`;
    return `${offset} minutos`;
}

export function AppointmentReminderSettingsPanel({
    enabled,
    offsets,
    provider,
    sendOnlyConfirmed,
    wuzapiTemplate,
    metaTemplate24h,
    metaTemplate4h,
    metaLanguage,
    onEnabledChange,
    onOffsetsChange,
    onProviderChange,
    onSendOnlyConfirmedChange,
    onWuzapiTemplateChange,
    onMetaTemplate24hChange,
    onMetaTemplate4hChange,
    onMetaLanguageChange,
    onSave,
    isSaving,
}: Props) {
    const presetKey = getPresetKey(offsets);

    return (
        <div className="space-y-5 rounded-2xl border bg-muted/15 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 font-semibold">
                        <Bell className="h-4 w-4 text-primary" />
                        Recordatorios automaticos
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Programa avisos por WhatsApp al confirmar una cita o al cambiar su horario.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Label htmlFor="appointment-reminders-enabled" className="text-sm">
                        Activo
                    </Label>
                    <Switch
                        id="appointment-reminders-enabled"
                        checked={enabled}
                        onCheckedChange={onEnabledChange}
                    />
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                    <Label>Esquema de envio</Label>
                    <Select
                        value={presetKey}
                        onValueChange={(value) => {
                            const preset = REMINDER_PRESETS.find((entry) => entry.key === value);
                            if (preset) onOffsetsChange([...preset.offsets]);
                        }}
                    >
                        <SelectTrigger className="h-11 bg-background">
                            <SelectValue placeholder="Selecciona frecuencia" />
                        </SelectTrigger>
                        <SelectContent>
                            {REMINDER_PRESETS.map((preset) => (
                                <SelectItem key={preset.key} value={preset.key}>
                                    {preset.label}
                                </SelectItem>
                            ))}
                            {presetKey === "custom" ? (
                                <SelectItem value="custom">Personalizado</SelectItem>
                            ) : null}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Actual: {offsets.map(offsetLabel).join(" + ")} antes.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Proveedor</Label>
                    <Select value={provider} onValueChange={(value) => onProviderChange(value as ReminderProvider)}>
                        <SelectTrigger className="h-11 bg-background">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="wuzapi">WuzAPI - mensaje normal</SelectItem>
                            <SelectItem value="meta">WhatsApp API - plantilla Meta</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        El canal QR usa texto editable; WhatsApp API requiere una plantilla aprobada fuera de la ventana de 24 horas.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label>Solicitudes del portal</Label>
                    <div className="flex h-11 items-center justify-between rounded-xl border bg-background px-3">
                        <span className="text-sm text-muted-foreground">
                            {sendOnlyConfirmed ? "Solo confirmadas" : "También pendientes"}
                        </span>
                        <Switch checked={sendOnlyConfirmed} onCheckedChange={onSendOnlyConfirmedChange} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Aplica solo a citas solicitadas desde la URL del paciente. Las citas creadas en el CRM programan recordatorio directo.
                    </p>
                </div>
            </div>

            {provider === "wuzapi" ? (
                <div className="space-y-2">
                    <Label>Mensaje WuzAPI</Label>
                    <Textarea
                        value={wuzapiTemplate}
                        onChange={(event) => onWuzapiTemplateChange(event.target.value)}
                        className="min-h-32 bg-background"
                    />
                    <p className="text-xs text-muted-foreground">
                        Variables: {"{{paciente}}"}, {"{{fecha}}"}, {"{{hora}}"}, {"{{especialista}}"}, {"{{clinica}}"}, {"{{motivo}}"}, {"{{modalidad}}"}, {"{{link_turno}}"}, {"{{anticipacion}}"}.
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                        <Label>Plantilla para 24h</Label>
                        <Input
                            value={metaTemplate24h}
                            onChange={(event) => onMetaTemplate24hChange(event.target.value)}
                            placeholder="recordatorio_cita_24h"
                            className="h-11 bg-background"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Plantilla mismo dia</Label>
                        <Input
                            value={metaTemplate4h}
                            onChange={(event) => onMetaTemplate4hChange(event.target.value)}
                            placeholder="recordatorio_cita_mismo_dia"
                            className="h-11 bg-background"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Idioma</Label>
                        <Input
                            value={metaLanguage}
                            onChange={(event) => onMetaLanguageChange(event.target.value)}
                            placeholder="es"
                            className="h-11 bg-background"
                        />
                    </div>
                    <p className="md:col-span-3 text-xs text-muted-foreground">
                        Las variables BODY se envian en este orden: paciente, fecha, hora, especialista, clinica, link, motivo y anticipacion.
                    </p>
                </div>
            )}

            <div className="flex flex-col gap-3 rounded-2xl border bg-background p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                    Al guardar se recalculan las citas futuras elegibles y se cancelan avisos que ya no apliquen.
                </span>
                <Button onClick={onSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Guardar recordatorios
                </Button>
            </div>
        </div>
    );
}
