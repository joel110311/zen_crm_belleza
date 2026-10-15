"use client";

import styles from "@/components/public/auth-workspace.module.css";
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
        event.preventDefault();
        if (pending) return;
        setError(null);
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
    return <>
        {message ? <div role="status" className={styles.notice}><strong>Revisa tu correo</strong><p>{message}</p><p>Si no lo encuentras, revisa la carpeta de spam.</p></div> : <form className={styles.form} onSubmit={submit} aria-busy={pending}>
            <fieldset disabled={pending} className={styles.fields}>
                <div className={styles.field}><label htmlFor="recovery-email">Correo electrónico</label><input id="recovery-email" name="email" type="email" required autoComplete="email" /></div>
                <TurnstileWidget action="password_reset" onToken={handleCaptcha} siteKey={turnstileSiteKey} />
                {error && <p role="alert" className={styles.error}>{error}</p>}
                <button disabled={pending} className={styles.submit}>{pending ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Enviando…</> : "Enviar enlace"}</button>
            </fieldset>
        </form>}
        <div className={styles.links}><Link href="/login">Volver a iniciar sesión</Link></div>
    </>;
}
