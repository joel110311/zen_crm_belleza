"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Loader2, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type Session = {
    metaConfigured?: boolean;
    metaConnected?: boolean;
    appId?: string | null;
    configId?: string | null;
    solutionId?: string | null;
    graphApiVersion?: string | null;
    displayPhoneNumber?: string | null;
    phoneNumberId?: string | null;
    wabaId?: string | null;
    businessId?: string | null;
    webhookUrl?: string | null;
};

type SignupData = { wabaId: string; phoneNumberId: string; businessId: string };
type FacebookLoginResponse = { authResponse?: { code?: string }; status?: string };
type FacebookSdk = {
    init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void;
};

declare global {
    interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void }
}

function normalizeVersion(value?: string | null) {
    const version = (value || "v26.0").trim();
    return version.startsWith("v") ? version : `v${version}`;
}

async function loadFacebookSdk(appId: string, version: string) {
    if (window.FB) {
        window.FB.init({ appId, cookie: true, xfbml: false, version });
        return;
    }
    await new Promise<void>((resolve, reject) => {
        window.fbAsyncInit = () => {
            window.FB?.init({ appId, cookie: true, xfbml: false, version });
            resolve();
        };
        const existing = document.getElementById("facebook-jssdk");
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            return;
        }
        const script = document.createElement("script");
        script.id = "facebook-jssdk";
        script.src = "https://connect.facebook.net/es_LA/sdk.js";
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error("No se pudo cargar el SDK oficial de Meta."));
        document.head.appendChild(script);
    });
}

export function MetaWhatsAppPanel() {
    const { toast } = useToast();
    const [session, setSession] = useState<Session>({});
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ appId: "", appSecret: "", configId: "", solutionId: "", graphApiVersion: "v26.0", registrationPin: "", webhookVerifyToken: "", webhookBaseUrl: "" });
    const signupData = useRef<SignupData | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [settingsResponse, sessionResponse] = await Promise.all([
                fetch("/api/settings", { cache: "no-store" }),
                fetch("/api/whatsapp/embedded-signup", { cache: "no-store" }),
            ]);
            const settings = await settingsResponse.json();
            const snapshot = await sessionResponse.json();
            setSession(snapshot);
            setForm({
                appId: settings.whatsappMetaAppId || "",
                appSecret: "",
                configId: settings.whatsappEmbeddedSignupConfigId || "",
                solutionId: settings.whatsappTechProviderSolutionId || "",
                graphApiVersion: settings.whatsappGraphApiVersion || "v26.0",
                registrationPin: "",
                webhookVerifyToken: "",
                webhookBaseUrl: settings.whatsappWebhookBaseUrl || window.location.origin,
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (!event.origin.endsWith("facebook.com")) return;
            let payload = event.data;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch { return; }
            }
            if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP" || payload.event !== "FINISH") return;
            signupData.current = {
                wabaId: String(payload.data?.waba_id || ""),
                phoneNumberId: String(payload.data?.phone_number_id || ""),
                businessId: String(payload.data?.business_id || ""),
            };
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    whatsappMetaAppId: form.appId,
                    whatsappMetaAppSecret: form.appSecret,
                    whatsappEmbeddedSignupConfigId: form.configId,
                    whatsappTechProviderSolutionId: form.solutionId,
                    whatsappGraphApiVersion: normalizeVersion(form.graphApiVersion),
                    whatsappRegistrationPin: form.registrationPin,
                    whatsappWebhookVerifyToken: form.webhookVerifyToken,
                    whatsappWebhookBaseUrl: form.webhookBaseUrl.replace(/\/$/, ""),
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se pudo guardar.");
            toast({ title: "Configuracion guardada", description: "Ya puedes iniciar Embedded Signup v4." });
            await refresh();
            return true;
        } catch (error) {
            toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
            return false;
        } finally { setSaving(false); }
    };

    const connect = async () => {
        setWorking(true);
        signupData.current = null;
        try {
            if (!(await save())) return;
            const configResponse = await fetch("/api/whatsapp/embedded-signup", { cache: "no-store" });
            const config = await configResponse.json();
            if (!configResponse.ok || !config.appId || !config.configId) throw new Error(config.error || "Configuracion incompleta.");
            await loadFacebookSdk(config.appId, normalizeVersion(config.graphApiVersion));
            if (!window.FB) throw new Error("El SDK de Meta no quedo disponible.");
            await new Promise<void>((resolve, reject) => {
                window.FB?.login(async (response) => {
                    const code = response.authResponse?.code;
                    if (!code) { reject(new Error("Meta no devolvio el codigo de autorizacion o se cancelo el flujo.")); return; }
                    for (let attempt = 0; attempt < 40 && !signupData.current; attempt += 1) {
                        await new Promise((wait) => window.setTimeout(wait, 250));
                    }
                    if (!signupData.current?.wabaId || !signupData.current.phoneNumberId) {
                        reject(new Error("Meta no devolvio los identificadores del numero seleccionado.")); return;
                    }
                    const result = await fetch("/api/whatsapp/embedded-signup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code, ...signupData.current }),
                    });
                    const payload = await result.json();
                    if (!result.ok) { reject(new Error(payload.error || "No se pudo finalizar la conexion.")); return; }
                    resolve();
                }, {
                    config_id: config.configId,
                    response_type: "code",
                    override_default_response_type: true,
                    extras: { setup: config.solutionId ? { solutionID: config.solutionId } : {} },
                });
            });
            toast({ title: "WhatsApp oficial conectado", description: "El numero quedo registrado y el webhook suscrito." });
            await refresh();
        } catch (error) {
            toast({ title: "No se pudo conectar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
        } finally { setWorking(false); }
    };

    const disconnect = async () => {
        if (!window.confirm("¿Desconectar WhatsApp oficial de este CRM?")) return;
        setWorking(true);
        try {
            const response = await fetch("/api/whatsapp/meta-session", { method: "DELETE" });
            if (!response.ok) throw new Error("No se pudo desconectar.");
            await refresh();
            toast({ title: "WhatsApp desconectado" });
        } catch (error) {
            toast({ title: "No se pudo desconectar", description: error instanceof Error ? error.message : "Error desconocido", variant: "destructive" });
        } finally { setWorking(false); }
    };

    const field = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
    if (loading) return <div className="flex min-h-40 items-center justify-center rounded-2xl border"><Loader2 className="h-5 w-5 animate-spin" /></div>;

    return (
        <div className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="font-semibold">WhatsApp API oficial</h2></div>
                    <p className="mt-1 text-sm text-muted-foreground">Conecta el WABA y el numero mediante Embedded Signup v4 de Meta.</p>
                </div>
                <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${session.metaConnected ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
                    {session.metaConnected ? <CheckCircle2 className="h-4 w-4" /> : null}{session.metaConnected ? "Conectado" : "Pendiente"}
                </div>
            </div>

            {session.metaConnected ? (
                <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-xs text-muted-foreground">Numero</p><p className="font-medium">{session.displayPhoneNumber || "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Phone Number ID</p><p className="break-all text-sm font-medium">{session.phoneNumberId}</p></div>
                    <div><p className="text-xs text-muted-foreground">WABA ID</p><p className="break-all text-sm font-medium">{session.wabaId}</p></div>
                    <div><p className="text-xs text-muted-foreground">Business ID</p><p className="break-all text-sm font-medium">{session.businessId || "—"}</p></div>
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Meta App ID</Label><Input value={form.appId} onChange={(e) => field("appId", e.target.value)} placeholder="App ID" /></div>
                <div className="space-y-2"><Label>App Secret</Label><Input type="password" value={form.appSecret} onChange={(e) => field("appSecret", e.target.value)} placeholder="Dejar vacio para conservarlo" /></div>
                <div className="space-y-2"><Label>Configuration ID (v4)</Label><Input value={form.configId} onChange={(e) => field("configId", e.target.value)} /></div>
                <div className="space-y-2"><Label>Solution ID (Tech Provider)</Label><Input value={form.solutionId} onChange={(e) => field("solutionId", e.target.value)} /></div>
                <div className="space-y-2"><Label>Version Graph API</Label><Input value={form.graphApiVersion} onChange={(e) => field("graphApiVersion", e.target.value)} /></div>
                <div className="space-y-2"><Label>PIN de registro (6 digitos)</Label><Input type="password" inputMode="numeric" maxLength={6} value={form.registrationPin} onChange={(e) => field("registrationPin", e.target.value.replace(/\D/g, ""))} placeholder="Dejar vacio para conservarlo" /></div>
                <div className="space-y-2"><Label>Token de verificacion del webhook</Label><Input type="password" value={form.webhookVerifyToken} onChange={(e) => field("webhookVerifyToken", e.target.value)} placeholder="Dejar vacio para conservarlo" /></div>
                <div className="space-y-2"><Label>URL publica del CRM</Label><Input value={form.webhookBaseUrl} onChange={(e) => field("webhookBaseUrl", e.target.value)} placeholder="https://crm.tudominio.com" /></div>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={save} disabled={saving || working}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar configuracion</Button>
                {!session.metaConnected ? <Button onClick={connect} disabled={working}>{working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Conectar mi WhatsApp</Button> : <Button variant="destructive" onClick={disconnect} disabled={working}><Trash2 className="mr-2 h-4 w-4" />Desconectar</Button>}
                <Button variant="ghost" size="icon" onClick={refresh} title="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Callback URL</p>
                <div className="mt-1 flex items-center gap-2"><code className="break-all">{session.webhookUrl || `${form.webhookBaseUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`}</code><button type="button" onClick={() => navigator.clipboard.writeText(session.webhookUrl || `${form.webhookBaseUrl.replace(/\/$/, "")}/api/webhooks/whatsapp`)}><Copy className="h-3.5 w-3.5" /></button></div>
                <p className="mt-2">Permisos requeridos: whatsapp_business_management y whatsapp_business_messaging. No se solicitan permisos de Messenger ni Instagram.</p>
            </div>
        </div>
    );
}
