"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, RefreshCw, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

type Channel = {
    id: string;
    provider: "META_CLOUD" | "WUZAPI";
    externalAccountId: string;
    status: string;
    credentialConfigured: boolean;
    connectedAt: string | null;
    lastWebhookAt: string | null;
    lastError: string | null;
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
    const [busy, setBusy] = useState<"meta" | "wuzapi" | null>(null);
    const [wuzapiAccount, setWuzapiAccount] = useState("");
    const [wuzapiToken, setWuzapiToken] = useState("");
    const [manualCallback, setManualCallback] = useState<string | null>(null);

    const endpoint = `/api/t/${encodeURIComponent(tenantSlug)}/v1/channels`;

    async function refresh() {
        if (!enabled) return;
        setLoading(true);
        try {
            const response = await fetch(endpoint, { cache: "no-store" });
            const body = await responseBody(response) as { data?: { channels?: Channel[] }; error?: { message?: string } };
            if (!response.ok) throw new Error(body.error?.message || "No fue posible consultar los canales.");
            setChannels(body.data?.channels || []);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible consultar los canales.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void refresh(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
            setMessage("Meta Cloud API quedó conectada a este negocio.");
            onConfigured?.("META_CLOUD");
            await refresh();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible conectar Meta.");
        } finally {
            setBusy(null);
        }
    }

    async function connectWuzapi() {
        setBusy("wuzapi");
        setMessage(null);
        try {
            const response = await fetch(`${endpoint}/wuzapi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ externalAccountId: wuzapiAccount, userToken: wuzapiToken }),
            });
            const body = await responseBody(response) as { data?: { callbackUrl?: string; configuredRemotely?: boolean }; error?: { message?: string } };
            if (!response.ok) throw new Error(body.error?.message || "No fue posible conectar WuzAPI.");
            setWuzapiToken("");
            setManualCallback(body.data?.configuredRemotely ? null : body.data?.callbackUrl || null);
            setMessage(body.data?.configuredRemotely ? "WuzAPI quedó conectado y su webhook fue configurado." : "WuzAPI quedó registrado. Copia la URL una sola vez en la configuración del gateway.");
            onConfigured?.("WUZAPI");
            await refresh();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "No fue posible conectar WuzAPI.");
        } finally {
            setBusy(null);
        }
    }

    if (!enabled) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">La conexión segura por tenant se habilitará cuando se configuren las credenciales de plataforma.</p>;

    return <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-medium">Conexiones de este negocio</p><p className="text-sm text-muted-foreground">Las credenciales se cifran y el webhook se procesa fuera de la web.</p></div><Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className="mr-2 size-4" />Actualizar</Button></div>
        {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Consultando canales…</p> : channels.length > 0 ? <div className="space-y-2">{channels.map((channel) => <div key={channel.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background p-3 text-sm"><span><span className="font-medium">{channel.provider === "META_CLOUD" ? "Meta Cloud API" : "WuzAPI"}</span><span className="ml-2 text-muted-foreground">{channel.externalAccountId}</span></span><span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />{channel.status.toLocaleLowerCase()}</span></div>)}</div> : <p className="text-sm text-muted-foreground">Todavía no hay un canal conectado.</p>}
        <div className="flex flex-wrap gap-3"><Button type="button" onClick={() => void connectMeta()} disabled={busy !== null}>{busy === "meta" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Wifi className="mr-2 size-4" />}Conectar Meta Cloud</Button></div>
        <div className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-[1fr_1fr_auto]"><input value={wuzapiAccount} onChange={(event) => setWuzapiAccount(event.target.value)} placeholder="Instancia WuzAPI" className="h-10 rounded-md border bg-transparent px-3 text-sm" autoComplete="off" /><input value={wuzapiToken} onChange={(event) => setWuzapiToken(event.target.value)} placeholder="Token de usuario WuzAPI" type="password" className="h-10 rounded-md border bg-transparent px-3 text-sm" autoComplete="new-password" /><Button type="button" variant="outline" onClick={() => void connectWuzapi()} disabled={busy !== null || !wuzapiAccount.trim() || !wuzapiToken.trim()}>{busy === "wuzapi" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Conectar WuzAPI</Button></div>
        {manualCallback ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p className="font-medium">Configura esta URL una sola vez en WuzAPI</p><p className="mt-1 break-all font-mono text-xs">{manualCallback}</p><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void navigator.clipboard.writeText(manualCallback)}><Copy className="mr-2 size-4" />Copiar</Button></div> : null}
        {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>;
}
