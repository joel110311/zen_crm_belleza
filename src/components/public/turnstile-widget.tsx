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
    useEffect(() => {
        if (!siteKey || !containerRef.current) return;
        let active = true;
        const render = () => {
            if (!active || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
            widgetIdRef.current = window.turnstile.render(containerRef.current, {
                sitekey: siteKey,
                action,
                theme: "auto",
                callback: (token: string) => onToken(token),
                "expired-callback": () => onToken(null),
                "error-callback": () => { setFailed(true); onToken(null); },
            });
        };
        const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener("load", render);
            render();
        } else {
            const script = document.createElement("script");
            script.id = scriptId;
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
            script.addEventListener("load", render);
            script.addEventListener("error", () => setFailed(true));
            document.head.appendChild(script);
        }
        return () => {
            active = false;
            if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
            widgetIdRef.current = null;
        };
    }, [action, onToken, siteKey]);

    if (!siteKey) return <p className="text-sm text-destructive">La verificación de seguridad no está configurada.</p>;
    return (
        <div className="space-y-2">
            <div ref={containerRef} />
            {failed ? <p className="text-sm text-destructive">No se pudo cargar la verificación. Recarga la página e inténtalo de nuevo.</p> : null}
        </div>
    );
}
