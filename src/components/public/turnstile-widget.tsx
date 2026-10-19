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

function verificationFailure(code: unknown): string {
    const value = typeof code === "string" ? code : "";
    if (/^(300|600)\d{3}$/.test(value)) {
        return "No pudimos verificar este navegador. Reintenta la verificación. Si continúa el problema, abre esta página directamente en otro navegador o en tu teléfono.";
    }
    if (value === "110600" || value === "110620") {
        return "La verificación venció. Reinténtala para continuar; tus datos siguen en el formulario.";
    }
    if (["110100", "110110", "110200", "400020", "400021", "400070"].includes(value)) {
        return "La verificación de seguridad no está disponible. Inténtalo más tarde o contacta a soporte.";
    }
    if (value === "200500") return "No se pudo cargar la verificación. Revisa tu conexión e inténtalo de nuevo.";
    return "No se pudo completar la verificación de seguridad. Inténtalo de nuevo.";
}

/** A small client wrapper; the server still verifies every token before any write. */
export function TurnstileWidget({ action, onToken, siteKey }: TurnstileWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [rendered, setRendered] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!siteKey || !containerRef.current) return;
        let active = true;
        const render = () => {
            if (!active || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
            try {
                setFailure(null);
                widgetIdRef.current = window.turnstile.render(containerRef.current, {
                sitekey: siteKey,
                action,
                theme: "auto",
                size: "compact",
                // This component owns recovery: do not keep retrying an invisible failed widget.
                retry: "never",
                "refresh-expired": "manual",
                "refresh-timeout": "manual",
                callback: (token: string) => { if (active) { setFailure(null); onToken(token); } },
                "expired-callback": () => { if (active) { setFailure(verificationFailure("110600")); onToken(null); } },
                "timeout-callback": () => { if (active) { setFailure(verificationFailure("110620")); onToken(null); } },
                "error-callback": (code: unknown) => { if (active) { setFailure(verificationFailure(code)); onToken(null); } },
                });
                setRendered(true);
            } catch {
                setFailure("No se pudo cargar la verificación. Revisa tu conexión e inténtalo de nuevo.");
                onToken(null);
            }
        };
        const fail = () => { if (active) { setFailure("No se pudo cargar la verificación. Revisa tu conexión e inténtalo de nuevo."); onToken(null); } };
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
            {!rendered && !failure && <p role="status" className="text-sm text-muted-foreground">Cargando verificación de seguridad…</p>}
            <div ref={containerRef} className="min-h-[140px]" hidden={Boolean(failure)} />
            {failure ? <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3"><p role="alert" className="text-sm leading-6 text-foreground">{failure}</p><button type="button" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={() => {
                onToken(null);
                if (!window.turnstile) document.getElementById(scriptId)?.remove();
                setFailure(null);
                setRendered(false);
                setAttempt(value => value + 1);
            }}>Reintentar verificación</button></div> : null}
        </div>
    );
}
