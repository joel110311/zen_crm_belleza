"use client";

import { useEffect, useRef, useState } from "react";

declare global {
    interface Window {
        turnstile?: {
            render: (element: HTMLElement, options: Record<string, unknown>) => string;
            remove: (widgetId: string) => void;
        };
    }
}

type TurnstileWidgetProps = {
    action: "signup" | "password_reset";
    onToken: (token: string | null) => void;
    siteKey: string;
};

const scriptId = "cloudflare-turnstile-script";

/** A small client wrapper; the server still verifies every token before any write. */
export function TurnstileWidget({ action, onToken, siteKey }: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [rendered, setRendered] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!siteKey || !containerRef.current) return;
        let active = true;
        const render = () => {
            if (!active || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
            try {
                setFailed(false);
                widgetIdRef.current = window.turnstile.render(containerRef.current, {
                sitekey: siteKey,
                action,
                theme: "auto",
                size: "compact",
                callback: (token: string) => { if (active) { setFailed(false); onToken(token); } },
                "expired-callback": () => { if (active) onToken(null); },
                "error-callback": () => { if (active) { setFailed(true); onToken(null); } },
                });
                setRendered(true);
            } catch {
                setFailed(true);
                onToken(null);
            }
        };
        const fail = () => { if (active) { setFailed(true); onToken(null); } };
        const timeout = window.setTimeout(() => { if (!widgetIdRef.current) fail(); }, 15000);
        let script = document.getElementById(scriptId) as HTMLScriptElement | null;
        const isNew = !script;
        if (!script) {
            script = document.createElement("script");
            script.id = scriptId;
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
        }
        script.addEventListener("load", render);
        script.addEventListener("error", fail);
        if (isNew) document.head.appendChild(script);
        render();
        return () => {
            active = false;
            window.clearTimeout(timeout);
            script.removeEventListener("load", render);
            script.removeEventListener("error", fail);
            if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
            widgetIdRef.current = null;
        };
    }, [action, onToken, siteKey, attempt]);

    if (!siteKey) return <p role="alert" className="text-sm text-destructive">La verificación de seguridad no está configurada.</p>;
    return (
        <div className="space-y-2">
            {!rendered && !failed && <p role="status" className="text-sm text-muted-foreground">Cargando verificación de seguridad…</p>}
            <div ref={containerRef} className="min-h-[140px]" hidden={failed} />
            {failed ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">No se pudo cargar la verificación. Inténtalo de nuevo.</p><button type="button" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => {
                onToken(null);
                if (!window.turnstile) document.getElementById(scriptId)?.remove();
                setFailed(false);
                setRendered(false);
                setAttempt(value => value + 1);
            }}>Reintentar verificación</button></div> : null}
        </div>
    );
}
