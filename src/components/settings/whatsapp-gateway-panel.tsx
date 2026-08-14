"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, LogOut, QrCode, RefreshCw, Save, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

type WhatsAppGatewayField =
    | "whatsappBaseUrl"
    | "whatsappAdminToken"
    | "whatsappUserToken"
    | "whatsappInstanceName"
    | "whatsappProxyUrl";

type Props = {
    whatsappBaseUrl: string;
    whatsappAdminToken: string;
    whatsappUserToken: string;
    whatsappInstanceName: string;
    whatsappProxyEnabled: boolean;
    whatsappProxyUrl: string;
    onChange: (field: WhatsAppGatewayField, value: string) => void;
    onProxyEnabledChange: (value: boolean) => void;
    onSave: () => Promise<boolean>;
    isSaving: boolean;
};

type SessionState = {
    configured: boolean;
    connected?: boolean;
    loggedIn?: boolean;
    jid?: string;
    qrCode?: string;
    error?: string;
};

export function WhatsAppGatewayPanel(props: Props) {
    const { toast } = useToast();
    const [session, setSession] = useState<SessionState>({ configured: false });
    const [isWorking, setIsWorking] = useState(false);
    const [isImportingHistory, setIsImportingHistory] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [historyImportMonths, setHistoryImportMonths] = useState("0");
    const [pendingHistoryImportMonths, setPendingHistoryImportMonths] = useState<number | null>(null);
    const [clearChatsOnDelete, setClearChatsOnDelete] = useState(false);
    const wasReadyRef = useRef(false);

    const loadSession = async (includeQr = false) => {
        try {
            const response = await fetch(`/api/whatsapp/session${includeQr ? "?includeQr=1" : ""}`, {
                cache: "no-store",
            });
            const payload = await response.json();
            setSession(payload);
        } catch (error) {
            setSession({
                configured: true,
                error: error instanceof Error ? error.message : "No se pudo consultar la sesion de WhatsApp.",
            });
        }
    };

    useEffect(() => {
        loadSession(true);
        const interval = setInterval(() => {
            loadSession(true);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    const runHistoryImport = useCallback(async (months: number, source: "manual" | "connect" = "manual") => {
        if (months < 1 || months > 3) return;

        setIsImportingHistory(true);
        try {
            const response = await fetch("/api/whatsapp/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "importHistory",
                    months,
                }),
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || "No se pudo importar el historial.");
            }

            const summary = payload.summary as {
                chatsImported?: number;
                messagesCreated?: number;
            } | undefined;

            toast({
                title: source === "connect" ? "Historial importado al vincular" : "Historial importado",
                description: summary
                    ? `${summary.chatsImported || 0} chats y ${summary.messagesCreated || 0} mensajes importados sin disparar pipelines.`
                    : "La importacion historica termino correctamente.",
            });
        } catch (error) {
            toast({
                title: "Importacion fallida",
                description: error instanceof Error ? error.message : "No se pudo importar el historial.",
                variant: "destructive",
            });
        } finally {
            setPendingHistoryImportMonths(null);
            setIsImportingHistory(false);
        }
    }, [toast]);

    useEffect(() => {
        const isSessionReady = Boolean(session.loggedIn && session.connected && session.jid);
        const justBecameReady = isSessionReady && !wasReadyRef.current;
        if (justBecameReady && pendingHistoryImportMonths && !isImportingHistory) {
            const monthsToImport = pendingHistoryImportMonths;
            void runHistoryImport(monthsToImport, "connect");
        }
        wasReadyRef.current = isSessionReady;
    }, [isImportingHistory, pendingHistoryImportMonths, runHistoryImport, session.connected, session.jid, session.loggedIn]);

    const executeAction = async (
        action: "provision" | "connect" | "disconnect" | "logout" | "delete",
        extra: Record<string, unknown> = {},
    ) => {
        setIsWorking(true);
        try {
            const saved = await props.onSave();
            if (!saved) return;

            const response = await fetch("/api/whatsapp/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || "No se pudo ejecutar la accion.");
            }

            if (action === "delete") {
                toast({
                    title: "Canal eliminado",
                    description: extra.clearChats
                        ? "Se borro la vinculacion y tambien se limpio la seccion Chats del CRM."
                        : "Se borro la vinculacion actual. Podras crear una nueva conexion cuando lo necesites.",
                });
            } else if (action === "disconnect") {
                toast({
                    title: "Canal desconectado",
                    description: "La sesion quedo pausada. Puedes reconectarla sin volver a escanear mientras siga vinculada.",
                });
            } else if (action === "logout") {
                toast({ title: "Sesion cerrada", description: "El dispositivo debera escanear un QR nuevo para volver a enlazarse." });
            } else if (action === "provision") {
                toast({ title: "Sesion QR preparada", description: "La conexion ya quedo lista para generar el QR y enlazar el telefono." });
            } else {
                toast({
                    title: "QR en preparacion",
                    description: historyImportMonths !== "0"
                        ? `Escanea el QR. Al quedar activo, importaremos hasta ${historyImportMonths === "1" ? "30 dias" : historyImportMonths === "2" ? "60 dias" : "90 dias"} de chats sin disparar pipelines.`
                        : "Escanea el QR con el telefono y espera unos segundos.",
                });
            }

            setSession(payload);
            await loadSession(true);
        } catch (error) {
            if (action === "connect") {
                setPendingHistoryImportMonths(null);
            }
            toast({
                title: "Accion fallida",
                description: error instanceof Error ? error.message : "Fallo al ejecutar la accion del canal.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const statusLabel = session.loggedIn
        ? (session.connected ? "Conectado" : "Pausado")
        : session.connected
            ? "Esperando QR"
            : "Sin conectar";

    const handleConnect = () => {
        const monthsToImport = Number.parseInt(historyImportMonths, 10);
        setPendingHistoryImportMonths(monthsToImport >= 1 && monthsToImport <= 3 ? monthsToImport : null);
        void executeAction("connect");
    };

    const handleDelete = () => {
        const description = clearChatsOnDelete
            ? "Esto eliminara la vinculacion y limpiara la seccion Chats del CRM. Esta accion no se puede deshacer."
            : "Esto eliminara la vinculacion actual. Podras crear una nueva conexion despues.";
        if (!window.confirm(description)) return;
        void executeAction("delete", { clearChats: clearChatsOnDelete });
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="font-semibold text-base text-foreground">Canal de WhatsApp por QR</h3>
                <p className="text-sm text-muted-foreground">
                    Guarda los datos del servicio, prepara la sesion QR y enlaza tu numero sin tocar la logica del CRM.
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                    <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">Datos del canal</p>
                            <p className="text-sm text-muted-foreground">
                                Aqui defines a donde se conecta el CRM y con que nombre interno se identificara esta sesion.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>URL del servicio de WhatsApp</Label>
                            <Input
                                value={props.whatsappBaseUrl}
                                onChange={(event) => props.onChange("whatsappBaseUrl", event.target.value)}
                                placeholder="http://localhost:8080"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Nombre interno del canal</Label>
                            <Input
                                value={props.whatsappInstanceName}
                                onChange={(event) => props.onChange("whatsappInstanceName", event.target.value)}
                                placeholder="zen-crm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowAdvanced((current) => !current)}
                            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                        >
                            <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                            Ver ajustes tecnicos
                        </button>

                        {showAdvanced ? (
                            <div className="space-y-4 rounded-2xl border bg-background/70 p-4">
                                <div className="space-y-2">
                                    <Label>Token maestro</Label>
                                    <Input
                                        type="password"
                                        value={props.whatsappAdminToken}
                                        onChange={(event) => props.onChange("whatsappAdminToken", event.target.value)}
                                        placeholder="Token administrativo del servicio"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Token del canal</Label>
                                    <Input
                                        value={props.whatsappUserToken}
                                        onChange={(event) => props.onChange("whatsappUserToken", event.target.value)}
                                        placeholder="Se genera automaticamente si lo dejas vacio"
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">Proxy residencial opcional</p>
                            <p className="text-sm text-muted-foreground">
                                Se enviara a WuzAPI como proxyConfig para que la sesion de WhatsApp salga por el proxy configurado.
                            </p>
                        </div>
                        <div className="flex items-start justify-between gap-4 rounded-xl border bg-background/75 px-4 py-3">
                            <div className="space-y-1">
                                <Label htmlFor="whatsapp-proxy-enabled" className="text-sm font-medium">
                                    Activar proxy para esta instancia
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Activalo antes de preparar la sesion QR. Si cambias el proxy en una sesion activa, reconecta el canal para aplicar la salida nueva.
                                </p>
                            </div>
                            <Switch
                                id="whatsapp-proxy-enabled"
                                checked={props.whatsappProxyEnabled}
                                onCheckedChange={props.onProxyEnabledChange}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Proxy URL</Label>
                            <Input
                                type="password"
                                value={props.whatsappProxyUrl}
                                onChange={(event) => props.onChange("whatsappProxyUrl", event.target.value)}
                                placeholder="http://usuario:password@gw.dataimpulse.com:10000"
                                disabled={!props.whatsappProxyEnabled}
                            />
                            <p className="text-xs text-muted-foreground">
                                Usa formato completo con protocolo y puerto: http://, https:// o socks5://. Mantén IP pegajosa para evitar cambios bruscos de ubicacion.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">Como enlazar el numero</p>
                            <p className="text-sm text-muted-foreground">
                                Este orden evita dudas y hace mas claro que esperar en cada paso.
                            </p>
                        </div>
                        <div className="space-y-2 text-sm text-muted-foreground">
                            <div className="rounded-xl border bg-background/80 px-4 py-3">
                                <span className="font-medium text-foreground">1. Guardar datos</span>
                                <p className="mt-1">Guarda la URL y el nombre del canal para dejar lista la configuracion base.</p>
                            </div>
                            <div className="rounded-xl border bg-background/80 px-4 py-3">
                                <span className="font-medium text-foreground">2. Preparar sesion QR</span>
                                <p className="mt-1">Crea la sesion tecnica que luego podra generar el QR de vinculacion.</p>
                            </div>
                            <div className="rounded-xl border bg-background/80 px-4 py-3">
                                <span className="font-medium text-foreground">3. Conectar por QR</span>
                                <p className="mt-1">Muestra el QR para que lo escanees desde WhatsApp en tu telefono.</p>
                            </div>
                            <div className="rounded-xl border bg-background/80 px-4 py-3">
                                <span className="font-medium text-foreground">4. Importacion historica opcional</span>
                                <p className="mt-1">Si eliges 1, 2 o 3 meses, el CRM trae chats/mensajes sin disparar pipelines.</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">Importacion historica opcional</p>
                            <p className="text-sm text-muted-foreground">
                                Puedes traer hasta 3 meses de chats y mensajes sin disparar pipelines ni crear automatizaciones por el historial.
                            </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                            <div className="space-y-2">
                                <Label>Historial a importar</Label>
                                <Select value={historyImportMonths} onValueChange={setHistoryImportMonths}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Selecciona un rango" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">No importar historial</SelectItem>
                                        <SelectItem value="1">Ultimos 30 dias</SelectItem>
                                        <SelectItem value="2">Ultimos 60 dias</SelectItem>
                                        <SelectItem value="3">Ultimos 90 dias</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-end">
                                <Button
                                    variant="outline"
                                    onClick={() => void runHistoryImport(Number.parseInt(historyImportMonths, 10), "manual")}
                                    disabled={!session.loggedIn || !session.connected || !session.jid || historyImportMonths === "0" || isImportingHistory || isWorking}
                                >
                                    {isImportingHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                    Importar ahora
                                </Button>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Si eliges 30, 60 o 90 dias antes de escanear el QR, la importacion corre sola cuando el numero quede activo. Solo se importan chats de contactos ya existentes en el CRM.
                        </p>
                    </div>

                    <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                        <Checkbox
                            id="clear-chats-on-delete"
                            checked={clearChatsOnDelete}
                            onCheckedChange={(checked) => setClearChatsOnDelete(Boolean(checked))}
                        />
                        <div className="space-y-1">
                            <Label htmlFor="clear-chats-on-delete" className="text-sm font-medium">
                                Al eliminar este numero, limpiar tambien Chats del CRM
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Solo vacia conversaciones y mensajes del inbox. No elimina los contactos ya importados.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={props.onSave} disabled={props.isSaving || isWorking} variant="outline">
                            {props.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar datos
                        </Button>
                        <Button onClick={() => executeAction("provision")} disabled={props.isSaving || isWorking}>
                            {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Preparar sesion QR
                        </Button>
                        <Button onClick={handleConnect} disabled={props.isSaving || isWorking || isImportingHistory}>
                            <QrCode className="mr-2 h-4 w-4" />
                            Conectar por QR
                        </Button>
                        <Button onClick={() => executeAction("disconnect")} disabled={props.isSaving || isWorking} variant="secondary">
                            <LogOut className="mr-2 h-4 w-4" />
                            Desconectar
                        </Button>
                        <Button
                            onClick={handleDelete}
                            disabled={props.isSaving || isWorking}
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                        </Button>
                    </div>
                </div>

                <Card className="border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Smartphone className="h-5 w-5 text-primary" />
                            Estado de la sesion
                        </CardTitle>
                        <CardDescription>
                            El QR aparecera aqui cuando la sesion este preparada para enlazar el telefono.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">Estado</p>
                                <p className="text-xs text-muted-foreground">{statusLabel}</p>
                            </div>
                            {session.loggedIn ? (
                                <div className="inline-flex items-center gap-2 text-emerald-600 text-sm font-medium">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Activo
                                </div>
                            ) : (
                                <Button variant="ghost" size="sm" onClick={() => loadSession(true)} disabled={isWorking}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Refrescar
                                </Button>
                            )}
                        </div>

                        {session.jid ? (
                            <div className="rounded-xl border bg-muted/30 px-4 py-3">
                                <p className="text-xs text-muted-foreground">Numero enlazado</p>
                                <p className="text-sm font-medium break-all">{session.jid}</p>
                            </div>
                        ) : null}

                        {session.error ? (
                            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                {session.error}
                            </div>
                        ) : null}

                        {session.qrCode ? (
                            <div className="rounded-2xl border border-dashed p-4 bg-background">
                                <img
                                    src={session.qrCode}
                                    alt="QR de WhatsApp"
                                    className="mx-auto w-full max-w-[260px] rounded-xl border bg-white p-3"
                                />
                                <p className="text-xs text-center text-muted-foreground mt-3">
                                    Abre WhatsApp en tu telefono, entra a Dispositivos vinculados y escanea este codigo.
                                </p>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                Todavia no hay QR disponible. Guarda los datos, prepara la sesion y luego pulsa &quot;Conectar por QR&quot;.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
