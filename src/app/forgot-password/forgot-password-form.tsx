"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { TurnstileWidget } from "@/components/public/turnstile-widget";

type ForgotPasswordFormProps = {
    turnstileSiteKey: string;
};

export function ForgotPasswordForm({ turnstileSiteKey }: ForgotPasswordFormProps) {
    const fingerprint = useRef("");
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    useEffect(() => {
        const key = "zen-signup-fingerprint";
        fingerprint.current = window.sessionStorage.getItem(key) || crypto.randomUUID();
        window.sessionStorage.setItem(key, fingerprint.current);
    }, []);
    const handleCaptcha = useCallback((token: string | null) => setCaptchaToken(token), []);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(null);
        if (!captchaToken) { setError("Completa la verificación de seguridad para continuar."); return; }
        setPending(true);
        const email = String(new FormData(event.currentTarget).get("email") || "");
        try {
            const response = await fetch("/api/public/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, captchaToken, fingerprint: fingerprint.current }) });
            const data = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(data.error || "No fue posible procesar la solicitud.");
            setMessage(data.message || "Revisa tu correo para continuar.");
        } catch (requestError) { setCaptchaToken(null); setError(requestError instanceof Error ? requestError.message : "Ocurrió un error inesperado."); }
        finally { setPending(false); }
    }
    return <section className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-semibold">Restablece tu contraseña</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Te enviaremos un enlace si existe una cuenta asociada al correo.</p>{message ? <p className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">{message}</p> : <form className="mt-6 space-y-4" onSubmit={submit}><label className="block space-y-1.5 text-sm font-medium">Correo electrónico<input name="email" type="email" required autoComplete="email" className="mt-1 h-11 w-full rounded-md border bg-background px-3" /></label><TurnstileWidget action="password_reset" onToken={handleCaptcha} siteKey={turnstileSiteKey} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<button disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? <><Loader2 className="mr-2 size-4 animate-spin" />Enviando...</> : "Enviar enlace"}</button></form>}<p className="mt-5 text-center text-sm text-muted-foreground"><Link href="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link></p></section>;
}
