"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

type Channel = {
    id: string;
    provider: "META_CLOUD" | "WUZAPI";
    status: string;
};

type QrSession = {
    configured: boolean;
    active: boolean;
    connected: boolean;
    phone: string | null;
    qrCode: string | null;
};

type MetaSdkWindow = Window & {
    FB?: {
        init: (options: Record<string, unknown>) => void;
        login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
    };
};

function parseMetaMessage(data: unknown) {
    const raw = typeof data === "string" ? (() => { try { return JSON.parse(data) as unknown; } catch { return null; } })() : data;
    if (!raw || typeof raw !== "object") return null;
    const value = raw as { type?: unknown; event?: unknown; data?: unknown };
    if (value.type !== "WA_EMBEDDED_SIGNUP" || value.event !== "FINISH" || !value.data || typeof value.data !== "object") return null;
    const details = value.data as { waba_id?: unknown; phone_number_id?: unknown; business_id?: unknown };
    return {
        wabaId: typeof details.waba_id === "string" ? details.waba_id : "",
        phoneNumberId: typeof details.phone_number_id === "string" ? details.phone_number_id : "",
        businessId: typeof details.business_id === "string" ? details.business_id : "",
    };
}

async function responseBody(response: Response) {
    return await response.json().catch(() => ({})) as { data?: unknown; error?: { message?: string } };
}

export function TenantChannelSetup({
    tenantSlug,
    enabled,
    onConfigured,
}: {
    tenantSlug: string;
    enabled: boolean;
    onConfigured?: (provider: "META_CLOUD" | "WUZAPI") => void;
}) {
    const [channels, setChannels] = useState<Channel[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState<"meta" | "qr" | "disconnect" | null>(null);
    const [qrSession, setQrSession] = useState<QrSession>({ configured: false, active: false, connected: false, phone: null, qrCode: null });
    const [qrRiskAccepted, setQrRiskAccepted] = useState(false);

    const endpoint = `/api/t/${encodeURIComponent(tenantSlug)}/v1/channels`;

    async function refresh() {
        if (!enabled) return;
        setLoading(true);
        try {
            const response = await fetch(endpoint, { cache: "no-store" });
            const body = await responseBody(response) as { data?: { channels?: Channel[] }; error?: { message?: string } };
            if (!response.ok) throw new Error(body.error?.message || "No fue posible consultar los canales.");
            setChannels(body.data?.channels || []);
            await refreshQr(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible consultar los canales.");
        } finally {
            setLoading(false);
        }
    }

    async function refreshQr(includeQr: boolean) {
        const response = await fetch(`${endpoint}/wuzapi${includeQr ? "?includeQr=1" : ""}`, { cache: "no-store" });
        const body = await responseBody(response) as { data?: QrSession; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message || "No fue posible consultar la conexión mediante QR.");
        if (body.data) setQrSession(body.data);
        return body.data;
    }

    useEffect(() => { void refresh(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!enabled || !qrSession.configured || qrSession.active) return;
        const timer = window.setInterval(() => { void refreshQr(true).catch(() => undefined); }, 5_000);
        return () => window.clearInterval(timer);
    }, [enabled, qrSession.configured, qrSession.active]); // eslint-disable-line react-hooks/exhaustive-deps

    async function ensureFacebookSdk(appId: string) {
        const browser = window as MetaSdkWindow;
        if (!browser.FB) {
            await new Promise<void>((resolve, reject) => {
                const existing = document.querySelector<HTMLScriptElement>('script[data-meta-facebook-sdk="true"]');
                if (existing) {
                    existing.addEventListener("load", () => resolve(), { once: true });
                    existing.addEventListener("error", () => reject(new Error("No fue posible cargar Facebook.")), { once: true });
                    return;
                }
                const script = document.createElement("script");
                script.async = true;
                script.defer = true;
                script.dataset.metaFacebookSdk = "true";
                script.src = "https://connect.facebook.net/es_LA/sdk.js";
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("No fue posible cargar Facebook."));
                document.head.appendChild(script);
            });
        }
        if (!browser.FB) throw new Error("Facebook no terminó de inicializarse.");
        browser.FB.init({ appId, cookie: true, xfbml: false, version: "v26.0" });
        return browser.FB;
    }

    async function connectMeta() {
        setBusy("meta");
        setMessage(null);
        try {
            const beginResponse = await fetch(`${endpoint}/meta/embedded-signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: "{}",
            });
            const begin = await responseBody(beginResponse) as { data?: { state?: string; appId?: string; configId?: string }; error?: { message?: string } };
            if (!beginResponse.ok || !begin.data?.state || !begin.data.appId || !begin.data.configId) throw new Error(begin.error?.message || "No fue posible iniciar Meta Embedded Signup.");
            const signupStart = {
                state: begin.data.state,
                appId: begin.data.appId,
                configId: begin.data.configId,
            };

            const details = await new Promise<{ wabaId: string; phoneNumberId: string; businessId: string; code: string }>((resolve, reject) => {
                let signup: { wabaId: string; phoneNumberId: string; businessId: string } | null = null;
                let code = "";
                let settled = false;
                const finish = () => {
                    if (settled || !signup || !code) return;
                    settled = true;
                    window.removeEventListener("message", receive);
                    resolve({ ...signup, code });
                };
                const receive = (event: MessageEvent) => {
                    if (!/^https:\/\/(www|web)\.facebook\.com$/i.test(event.origin)) return;
                    signup = parseMetaMessage(event.data);
                    finish();
                };
                window.addEventListener("message", receive);
                void ensureFacebookSdk(signupStart.appId).then((fb) => {
                    fb.login((response) => {
                        code = response.authResponse?.code || "";
                        finish();
                        if (!code && !settled) {
                            window.removeEventListener("message", receive);
                            reject(new Error("Meta no devolvió el código de autorización."));
                        }
                    }, {
                        config_id: signupStart.configId,
                        response_type: "code",
                        override_default_response_type: true,
                        extras: { setup: {} },
                    });
                }).catch((error) => {
                    window.removeEventListener("message", receive);
                    reject(error);
                });
                window.setTimeout(() => {
                    if (!settled) {
                        window.removeEventListener("message", receive);
                        reject(new Error("Meta no completó la conexión a tiempo."));
                    }
                }, 180_000);
            });
            const completeResponse = await fetch(`${endpoint}/meta/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ state: signupStart.state, ...details }),
            });
            const complete = await responseBody(completeResponse);
            if (!completeResponse.ok) throw new Error(complete.error?.message || "Meta no pudo terminar la conexión.");
            setMessage("La conexión oficial de WhatsApp quedó activa.");
            onConfigured?.("META_CLOUD");
            await refresh();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible conectar Meta.");
        } finally {
            setBusy(null);
        }
    }

    async function connectQr() {
        setBusy("qr");
        setMessage(null);
        try {
            const response = await fetch(`${endpoint}/wuzapi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ action: "connect", riskAccepted: qrRiskAccepted }),
            });
            const body = await responseBody(response) as { data?: QrSession; error?: { message?: string } };
            if (!response.ok) throw new Error(body.error?.message || "No fue posible preparar la conexión mediante QR.");
            if (body.data) setQrSession(body.data);
            setMessage(body.data?.active ? "WhatsApp quedó vinculado correctamente." : "Escanea el código desde WhatsApp para terminar la vinculación.");
            onConfigured?.("WUZAPI");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible preparar la conexión mediante QR.");
        } finally {
            setBusy(null);
        }
    }

    async function disconnectQr() {
        setBusy("disconnect");
        setMessage(null);
        try {
            const response = await fetch(`${endpoint}/wuzapi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ action: "disconnect" }),
            });
            const body = await responseBody(response);
            if (!response.ok) throw new Error(body.error?.message || "No fue posible desvincular WhatsApp.");
            setQrSession({ configured: true, active: false, connected: false, phone: null, qrCode: null });
            setMessage("El teléfono quedó desvinculado. Puedes enlazarlo de nuevo cuando quieras.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible desvincular WhatsApp.");
        } finally {
            setBusy(null);
        }
    }

    if (!enabled) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">La conexión segura por negocio se habilitará cuando se configuren las credenciales de plataforma.</p>;

    const official = channels.find((channel) => channel.provider === "META_CLOUD" && channel.status === "CONNECTED");

    return <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Conecta WhatsApp</p><p className="text-sm text-muted-foreground">Elige una forma de conexión. La configuración técnica se administra de manera segura por la plataforma.</p></div><Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className="mr-2 size-4" />Actualizar</Button></div>
        {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Consultando conexiones…</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
            <section className="flex flex-col rounded-2xl border bg-background p-4">
                <div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700"><ShieldCheck className="size-5" /></span>{official ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" />Activa</span> : <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">Oficial</span>}</div>
                <h3 className="mt-4 font-semibold">Conexión oficial de WhatsApp</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">Recomendada para operar con la plataforma oficial de Meta, plantillas aprobadas y mayor estabilidad.</p>
                <Button type="button" className="mt-4 w-full" onClick={() => void connectMeta()} disabled={busy !== null || Boolean(official)}>{busy === "meta" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}{official ? "Conexión activa" : "Conectar oficialmente"}</Button>
            </section>

            <section className="flex flex-col rounded-2xl border bg-background p-4">
                <div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><QrCode className="size-5" /></span>{qrSession.active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" />Activa</span> : <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">No oficial</span>}</div>
                <h3 className="mt-4 font-semibold">Conexión (no oficial) mediante QR</h3>
                <p className="mt-1 text-sm text-muted-foreground">Vincula el WhatsApp de tu teléfono escaneando un código, sin capturar datos técnicos.</p>
                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">Esta modalidad no utiliza la API oficial de Meta. WhatsApp puede limitar o suspender el número, especialmente ante automatizaciones, envíos masivos o incumplimientos de sus políticas. Úsala bajo tu responsabilidad.</p>
                {!qrSession.active ? <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><input type="checkbox" checked={qrRiskAccepted} onChange={(event) => setQrRiskAccepted(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />Entiendo que es una conexión no oficial y acepto el riesgo antes de vincular este número.</label> : null}
                {qrSession.phone ? <div className="mt-3 rounded-xl border bg-muted/30 px-3 py-2"><p className="text-xs text-muted-foreground">Número vinculado</p><p className="break-all text-sm font-medium">{qrSession.phone.replace(/@.+$/, "")}</p></div> : null}
                {qrSession.qrCode && !qrSession.active ? <div className="mt-4 rounded-2xl border border-dashed bg-white p-3"><Image src={qrSession.qrCode} alt="Código QR para vincular WhatsApp" width={224} height={224} unoptimized className="mx-auto h-auto w-full max-w-56" /><p className="mt-2 text-center text-xs text-slate-600">En WhatsApp abre Dispositivos vinculados, toca Vincular dispositivo y escanea este código.</p></div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                    {qrSession.active ? <Button type="button" variant="outline" className="flex-1" onClick={() => void disconnectQr()} disabled={busy !== null}>{busy === "disconnect" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Unplug className="mr-2 size-4" />}Desvincular</Button> : <Button type="button" variant="outline" className="flex-1" onClick={() => void connectQr()} disabled={busy !== null || !qrRiskAccepted}>{busy === "qr" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Smartphone className="mr-2 size-4" />}{qrSession.qrCode ? "Generar otro código" : "Conectar por QR bajo mi responsabilidad"}</Button>}
                    {qrSession.configured && !qrSession.active ? <Button type="button" variant="ghost" onClick={() => void refreshQr(true)} disabled={busy !== null}><RefreshCw className="mr-2 size-4" />Revisar estado</Button> : null}
                </div>
            </section>
        </div>
        {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>;
}
