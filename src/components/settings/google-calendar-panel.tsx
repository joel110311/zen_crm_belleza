"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CalendarSync,
    Check,
    CheckCircle2,
    Link2,
    Loader2,
    RefreshCw,
    Save,
    ShieldCheck,
    Sparkles,
    Unlink,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useOperationContext } from "@/components/shared/use-operation-context";
import type { GoogleCalendarSourceInput, GoogleCalendarSourceSummary, GoogleCalendarStatus } from "@/lib/google-calendar";

type Props = {
    googleClientId: string;
    googleClientSecret: string;
    onChange: (
        field: "googleClientId" | "googleClientSecret",
        value: string,
    ) => void;
    onSave: () => Promise<boolean>;
    isSaving: boolean;
};

function sortSources(sources: GoogleCalendarSourceSummary[]) {
    return [...sources].sort((a, b) => a.sortOrder - b.sortOrder || a.summary.localeCompare(b.summary, "es"));
}

export function GoogleCalendarPanel(props: Props) {
    const operationContext = useOperationContext();
    const { toast } = useToast();
    const [status, setStatus] = useState<GoogleCalendarStatus>({
        configured: false,
        connected: false,
        sources: [],
        specialistCount: 0,
        maxSpecialists: 5,
    });
    const [draftSources, setDraftSources] = useState<GoogleCalendarSourceSummary[]>([]);
    const [isWorking, setIsWorking] = useState(false);
    const [redirectUri, setRedirectUri] = useState("https://tu-dominio/api/google-calendar/callback");

    const selectedSpecialists = useMemo(
        () => draftSources.filter((source) => source.isSelected && source.isSpecialist).length,
        [draftSources],
    );

    const loadStatus = useCallback(async () => {
        try {
            const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
            if (!response.ok) throw new Error("No se pudo consultar el estado.");
            const payload = (await response.json()) as GoogleCalendarStatus & { redirectUri?: string };
            setStatus(payload);
            setDraftSources(sortSources(payload.sources || []));
            if (payload.redirectUri) {
                setRedirectUri(payload.redirectUri);
            }
        } catch (error) {
            toast({
                title: "No se pudo cargar Google Calendar",
                description: error instanceof Error ? error.message : "Fallo al consultar el estado.",
                variant: "destructive",
            });
        }
    }, [toast]);

    useEffect(() => {
        void loadStatus();
    }, [loadStatus]);

    const mutateSource = (calendarId: string, updater: (source: GoogleCalendarSourceSummary) => GoogleCalendarSourceSummary) => {
        setDraftSources((current) => sortSources(current.map((source) => (
            source.calendarId === calendarId ? updater(source) : source
        ))));
    };

    const handleConnect = async () => {
        setIsWorking(true);
        try {
            const saved = await props.onSave();
            if (!saved) return;
            window.location.href = "/api/google-calendar/auth";
        } finally {
            setIsWorking(false);
        }
    };

    const postStatusAction = async (action: string, body?: Record<string, unknown>) => {
        const response = await fetch("/api/google-calendar/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...(body || {}) }),
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "No se pudo completar la accion.");
        }
        return payload as GoogleCalendarStatus;
    };

    const handleSync = async () => {
        setIsWorking(true);
        try {
            const payload = await postStatusAction("sync");
            setStatus(payload);
            setDraftSources(sortSources(payload.sources || []));
            toast({
                title: "Sincronizacion completada",
                description: "Se actualizaron las citas importadas desde Google Calendar.",
            });
        } catch (error) {
            toast({
                title: "Error al sincronizar",
                description: error instanceof Error ? error.message : "Fallo la sincronizacion.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const handleDisconnect = async () => {
        setIsWorking(true);
        try {
            const payload = await postStatusAction("disconnect");
            setStatus(payload);
            setDraftSources(sortSources(payload.sources || []));
            toast({
                title: "Google Calendar desconectado",
                description: "La cuenta quedo desvinculada del CRM.",
            });
        } catch (error) {
            toast({
                title: "Error al desconectar",
                description: error instanceof Error ? error.message : "No se pudo desconectar.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const handleDiscover = async () => {
        setIsWorking(true);
        try {
            const payload = await postStatusAction("discover");
            setStatus(payload);
            setDraftSources(sortSources(payload.sources || []));
            toast({
                title: "Calendarios cargados",
                description: "Ya puedes elegir que calendarios usar en el CRM.",
            });
        } catch (error) {
            toast({
                title: "No se pudieron cargar los calendarios",
                description: error instanceof Error ? error.message : "No se pudieron descubrir los calendarios.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const handleSaveSources = async () => {
        setIsWorking(true);
        try {
            const payload = await postStatusAction("save_sources", {
                sources: draftSources.map<GoogleCalendarSourceInput>((source, index) => ({
                    calendarId: source.calendarId,
                    isSelected: source.isSelected,
                    blocksAvailability: source.blocksAvailability,
                    importToCrm: source.importToCrm,
                    isWriteTarget: source.isWriteTarget,
                    isSpecialist: source.isSpecialist,
                    specialistName: source.specialistName || source.summary,
                    sortOrder: index,
                })),
            });
            setStatus(payload);
            setDraftSources(sortSources(payload.sources || []));
            toast({
                title: "Calendarios guardados",
                description: "La configuracion de especialistas y disponibilidad ya quedo aplicada.",
            });
        } catch (error) {
            toast({
                title: "No se pudo guardar",
                description: error instanceof Error ? error.message : "Fallo al guardar la configuracion.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="font-semibold text-base text-foreground">Google Calendar</h3>
                <p className="text-sm text-muted-foreground">
                    Conecta una cuenta Google y elige que calendarios se muestran en el CRM, cuales bloquean horarios y cuales representan especialistas.
                </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                <div className="min-w-0 space-y-4">
                    <Card className="min-w-0">
                        <CardHeader className="min-w-0">
                            <CardTitle>Credenciales OAuth</CardTitle>
                            <CardDescription>
                                Usa un cliente OAuth tipo Web Application creado en Google Cloud.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Google Client ID</Label>
                                <Input
                                    value={props.googleClientId}
                                    onChange={(event) => props.onChange("googleClientId", event.target.value)}
                                    placeholder="Client ID del OAuth Web Application"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Google Client Secret</Label>
                                <Input
                                    type="password"
                                    value={props.googleClientSecret}
                                    onChange={(event) => props.onChange("googleClientSecret", event.target.value)}
                                    placeholder="Client Secret de Google"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Agrega esta URL de redireccion en Google Cloud:
                                    <br />
                                    <span className="font-mono break-all">{redirectUri}</span>
                                </p>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <Button onClick={props.onSave} disabled={props.isSaving || isWorking} variant="outline" className="w-full justify-center sm:w-auto">
                                    {props.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar credenciales
                                </Button>
                                <Button onClick={handleConnect} disabled={props.isSaving || isWorking} className="w-full justify-center sm:w-auto">
                                    {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                                    Conectar cuenta Google
                                </Button>
                                <Button onClick={handleDiscover} disabled={!status.connected || isWorking} variant="secondary" className="w-full justify-center sm:w-auto">
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Traer calendarios
                                </Button>
                                <Button onClick={handleSync} disabled={!status.connected || isWorking} variant="secondary" className="w-full justify-center sm:w-auto">
                                    <CalendarSync className="mr-2 h-4 w-4" />
                                    Sincronizar ahora
                                </Button>
                                <Button onClick={handleDisconnect} disabled={isWorking} variant="ghost" className="w-full justify-center text-destructive hover:text-destructive sm:w-auto">
                                    <Unlink className="mr-2 h-4 w-4" />
                                    Desconectar
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="min-w-0">
                        <CardHeader className="min-w-0">
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-primary" />
                                Calendarios disponibles
                            </CardTitle>
                            <CardDescription>
                                Marca solo los calendarios que quieres usar en el CRM. Los demas quedaran fuera de la operacion.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!status.connected ? (
                                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                    Conecta Google primero para cargar la lista de calendarios.
                                </div>
                            ) : draftSources.length === 0 ? (
                                <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                    Tu cuenta ya esta conectada. Pulsa <span className="font-medium">Traer calendarios</span> para cargarlos dentro del CRM.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {draftSources.map((source) => {
                                        const specialistLimitReached =
                                            !source.isSpecialist &&
                                            selectedSpecialists >= status.maxSpecialists;

                                        return (
                                            <div key={source.calendarId} className="min-w-0 rounded-2xl border border-border/60 bg-card/60 p-4">
                                                <div className="flex items-start gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => mutateSource(source.calendarId, (current) => ({
                                                            ...current,
                                                            isSelected: !current.isSelected,
                                                            blocksAvailability: !current.isSelected ? true : false,
                                                            importToCrm: !current.isSelected ? true : false,
                                                            isWriteTarget: !current.isSelected ? current.isWriteTarget : false,
                                                            isSpecialist: !current.isSelected ? current.isSpecialist : false,
                                                            specialistName: !current.isSelected ? current.specialistName : null,
                                                        }))}
                                                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition"
                                                        style={{
                                                            borderColor: source.backgroundColor || "#94A3B8",
                                                            backgroundColor: source.isSelected ? (source.backgroundColor || "#3B82F6") : "transparent",
                                                        }}
                                                    >
                                                        {source.isSelected ? <Check className="h-4 w-4 text-white" /> : null}
                                                    </button>

                                                    <div className="min-w-0 flex-1 space-y-3">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-medium text-sm text-foreground">{source.summary}</span>
                                                            {source.isPrimary ? <Badge variant="secondary">Principal</Badge> : null}
                                                            <Badge variant={source.writable ? "default" : "outline"}>
                                                                {source.accessRole || "reader"}
                                                            </Badge>
                                                            {source.isWriteTarget ? <Badge variant="outline">Escritura</Badge> : null}
                                                            {source.isSpecialist ? <Badge variant="outline">Especialista</Badge> : null}
                                                        </div>

                                                        {source.description ? (
                                                            <p className="text-xs text-muted-foreground">{source.description}</p>
                                                        ) : null}

                                                        {source.isSelected ? (
                                                            <div className="grid gap-3 lg:grid-cols-2">
                                                                <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                                                                    <div>
                                                                        <p className="text-sm font-medium">Bloquea disponibilidad</p>
                                                                        <p className="text-xs text-muted-foreground">Se toma en cuenta para ofrecer horarios.</p>
                                                                    </div>
                                                                    <Switch
                                                                        checked={source.blocksAvailability}
                                                                        onCheckedChange={(checked) => mutateSource(source.calendarId, (current) => ({
                                                                            ...current,
                                                                            blocksAvailability: checked,
                                                                        }))}
                                                                    />
                                                                </div>

                                                                <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                                                                    <div>
                                                                        <p className="text-sm font-medium">Importar al CRM</p>
                                                                        <p className="text-xs text-muted-foreground">Muestra sus eventos dentro del calendario del CRM.</p>
                                                                    </div>
                                                                    <Switch
                                                                        checked={source.importToCrm}
                                                                        onCheckedChange={(checked) => mutateSource(source.calendarId, (current) => ({
                                                                            ...current,
                                                                            importToCrm: checked,
                                                                        }))}
                                                                    />
                                                                </div>

                                                                <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                                                                    <div>
                                                                        <p className="text-sm font-medium">Calendario de escritura</p>
                                                                        <p className="text-xs text-muted-foreground">Es donde el CRM crea o actualiza citas.</p>
                                                                    </div>
                                                                    <Switch
                                                                        checked={source.isWriteTarget}
                                                                        disabled={!source.writable}
                                                                        onCheckedChange={(checked) => {
                                                                            setDraftSources((current) => sortSources(current.map((entry) => ({
                                                                                ...entry,
                                                                                isWriteTarget: entry.calendarId === source.calendarId ? checked : false,
                                                                            }))));
                                                                        }}
                                                                    />
                                                                </div>

                                                                <div className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                                                                    <div>
                                                                        <p className="text-sm font-medium">Es especialista</p>
                                                                        <p className="text-xs text-muted-foreground">Disponible para que la IA agende directamente con esa persona.</p>
                                                                    </div>
                                                                    <Switch
                                                                        checked={source.isSpecialist}
                                                                        disabled={!source.writable || specialistLimitReached}
                                                                        onCheckedChange={(checked) => mutateSource(source.calendarId, (current) => ({
                                                                            ...current,
                                                                            isSpecialist: checked,
                                                                            specialistName: checked ? (current.specialistName || current.summary) : null,
                                                                        }))}
                                                                    />
                                                                </div>

                                                                {source.isSpecialist ? (
                                                                    <div className="md:col-span-2 space-y-2">
                                                                        <Label>Nombre visible del especialista</Label>
                                                                        <Input
                                                                            value={source.specialistName || ""}
                                                                            onChange={(event) => mutateSource(source.calendarId, (current) => ({
                                                                                ...current,
                                                                                specialistName: event.target.value,
                                                                            }))}
                                                                            placeholder="Ej. Patricia"
                                                                        />
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-muted-foreground">
                                                                Marca su casilla para activar este calendario dentro del CRM.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {draftSources.length > 0 ? (
                                <Button onClick={handleSaveSources} disabled={!status.connected || isWorking} className="w-full sm:w-auto">
                                    {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar configuracion de calendarios
                                </Button>
                            ) : null}
                        </CardContent>
                    </Card>
                </div>

                <div className="min-w-0 space-y-4">
                    <Card className="min-w-0 border-primary/20">
                        <CardHeader className="min-w-0">
                            <CardTitle className="flex items-start gap-2 leading-snug">
                                <CalendarSync className="h-5 w-5 text-primary" />
                                <span className="min-w-0">Estado de la conexion</span>
                            </CardTitle>
                            <CardDescription className="max-w-none leading-relaxed">
                                Aqui veras la cuenta enlazada, el calendario principal y el uso actual de especialistas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <p className="text-sm font-medium">Conexion</p>
                                    <p className="text-xs text-muted-foreground">
                                        {status.connected ? "Activa" : status.configured ? "Lista para conectar" : "Faltan credenciales"}
                                    </p>
                                </div>
                                {status.connected ? (
                                    <div className="inline-flex items-center gap-2 text-emerald-600 text-sm font-medium">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Conectado
                                    </div>
                                ) : null}
                            </div>

                            <div className="rounded-xl border bg-muted/30 px-4 py-3">
                                <p className="text-xs text-muted-foreground">Cuenta enlazada</p>
                                <p className="text-sm font-medium break-all">{status.connectedEmail || "Todavia no hay una cuenta conectada."}</p>
                            </div>

                            <div className="rounded-xl border bg-muted/30 px-4 py-3">
                                <p className="text-xs text-muted-foreground">Calendario actual de escritura</p>
                                <p className="text-sm font-medium break-all">{status.calendarId || "Sin calendario activo"}</p>
                            </div>

                            <div className="rounded-xl border bg-muted/30 px-4 py-3">
                                <p className="text-xs text-muted-foreground">Especialistas activos</p>
                                <p className="text-sm font-medium">{selectedSpecialists}/{status.maxSpecialists}</p>
                            </div>

                            <div className="rounded-xl border bg-muted/30 px-4 py-3">
                                <p className="text-xs text-muted-foreground">Ultima sincronizacion</p>
                                <p className="text-sm font-medium">
                                    {status.lastSyncedAt
                                        ? new Date(status.lastSyncedAt).toLocaleString(operationContext.locale, { timeZone: operationContext.timeZone })
                                        : "Aun no se ha sincronizado"}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="min-w-0">
                        <CardHeader className="min-w-0">
                            <CardTitle className="flex items-start gap-2 leading-snug">
                                <Sparkles className="h-5 w-5 text-primary" />
                                <span className="min-w-0">Como lo usa el CRM</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-muted-foreground">
                            <div className="rounded-xl border px-4 py-3">
                                <p className="font-medium text-foreground">1. Calendarios marcados</p>
                                <p>Solo los calendarios chuleados se toman en cuenta dentro del CRM.</p>
                            </div>
                            <div className="rounded-xl border px-4 py-3">
                                <p className="font-medium text-foreground">2. Bloquea disponibilidad</p>
                                <p>Si un calendario lo tiene activo, sus eventos ocupados tambien bloquean horarios al ofrecer citas.</p>
                            </div>
                            <div className="rounded-xl border px-4 py-3">
                                <p className="font-medium text-foreground">3. Especialistas</p>
                                <p>Hasta {status.maxSpecialists} calendarios pueden actuar como especialistas para que la IA agende con Juan, Luis, Patricia, etc.</p>
                            </div>
                            <div className="rounded-xl border px-4 py-3">
                                <p className="font-medium text-foreground">4. Calendario de escritura</p>
                                <p>Solo uno queda como destino principal para crear citas cuando no se haya elegido un especialista concreto.</p>
                            </div>
                            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                                <div className="flex items-start gap-2">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
                                    <p>
                                        Si un calendario solo tiene permiso <span className="font-medium text-foreground">reader</span>, el CRM puede verlo pero no usarlo como especialista ni escribir citas nuevas ahi.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
