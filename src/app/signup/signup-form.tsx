"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PasswordField } from "@/components/public/password-field";
import styles from "@/components/public/auth-workspace.module.css";
import { TurnstileWidget } from "@/components/public/turnstile-widget";

function slugify(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

function signupFingerprint() {
    const key = "zen-signup-fingerprint";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const value = crypto.randomUUID();
    window.sessionStorage.setItem(key, value);
    return value;
}

function currentUtm() {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries([...params.entries()].filter(([key]) => key.startsWith("utm_")));
}

type SignupFormProps = {
    turnstileSiteKey: string;
};

export function SignupForm({ turnstileSiteKey }: SignupFormProps) {
    const idempotencyKey = useRef(crypto.randomUUID());
    const fingerprint = useRef("");
    const submitting = useRef(false);
    const [businessName, setBusinessName] = useState("");
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [captchaAttempt, setCaptchaAttempt] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => { fingerprint.current = signupFingerprint(); }, []);
    const handleCaptcha = useCallback((token: string | null) => {
        setCaptchaToken(token);
        setError(current => current === "Completa la verificación de seguridad para continuar." ? null : current);
    }, []);

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current) return;
        setError(null);
        if (!captchaToken) {
            setError("Completa la verificación de seguridad para continuar.");
            return;
        }
        submitting.current = true;
        setIsSubmitting(true);

        const formData = new FormData(event.currentTarget);
        const displayName = businessName.trim();
        try {
            const response = await fetch("/api/public/signup-intents", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-signup-fingerprint": fingerprint.current },
                body: JSON.stringify({
                    name: formData.get("name"),
                    email: formData.get("email"),
                    password: formData.get("password"),
                    displayName,
                    slug: slugify(displayName),
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City",
                    idempotencyKey: idempotencyKey.current,
                    legalAccepted: formData.get("legalAccepted") === "on",
                    captchaToken,
                    fingerprint: fingerprint.current,
                    utm: currentUtm(),
                }),
            });
            const payload = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(payload.error || "No fue posible iniciar el registro.");
            setMessage(payload.message || "Revisa tu correo para continuar.");
        } catch (submissionError) {
            idempotencyKey.current = crypto.randomUUID();
            setCaptchaToken(null);
            setCaptchaAttempt(value => value + 1);
            setError(submissionError instanceof Error ? submissionError.message : "Ocurrió un error inesperado.");
        } finally {
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    if (message) {
        return <div className={styles.notice} role="status"><strong>Solicitud recibida</strong><p>Si este correo aún no tiene cuenta, recibirás un enlace para confirmar el registro. Revisa también Spam.</p><p>Si ya tienes cuenta, inicia sesión abajo. Registrarte de nuevo no crea otro negocio ni cambia tu contraseña.</p></div>;
    }

    return <form className={styles.form} onSubmit={onSubmit} aria-busy={isSubmitting}>
        <fieldset disabled={isSubmitting} className={styles.fields}>
            <div className={styles.row}>
                <div className={styles.field}><label htmlFor="signup-name">Tu nombre</label><input id="signup-name" name="name" required maxLength={160} autoComplete="name" /></div>
                <div className={styles.field}><label htmlFor="signup-business">Nombre del negocio</label><input id="signup-business" value={businessName} onChange={event => setBusinessName(event.target.value)} required maxLength={160} autoComplete="organization" /></div>
            </div>
            <div className={styles.field}><label htmlFor="signup-email">Correo electrónico</label><input id="signup-email" name="email" required type="email" autoComplete="email" aria-describedby="signup-email-hint" /><p id="signup-email-hint" className={styles.hint}>Te enviaremos un enlace para confirmar tu cuenta.</p></div>
            <PasswordField id="signup-password" name="password" label="Contraseña" autoComplete="new-password" minLength={12} maxLength={128} hint="Usa al menos 12 caracteres." />
            <label className={styles.legalConsent}><input name="legalAccepted" required type="checkbox" /><span>Acepto los <Link href="/terms" target="_blank" rel="noopener noreferrer">Términos de servicio</Link> y el <Link href="/privacy" target="_blank" rel="noopener noreferrer">Aviso de privacidad</Link>.</span></label>
            <TurnstileWidget key={captchaAttempt} action="signup" onToken={handleCaptcha} siteKey={turnstileSiteKey} />
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <button disabled={isSubmitting} className={styles.submit} type="submit">{isSubmitting ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Enviando verificación…</> : "Crear cuenta"}</button>
        </fieldset>
    </form>;
}
