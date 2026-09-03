"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
    const [businessName, setBusinessName] = useState("");
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => { fingerprint.current = signupFingerprint(); }, []);
    const handleCaptcha = useCallback((token: string | null) => setCaptchaToken(token), []);

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        if (!captchaToken) {
            setError("Completa la verificación de seguridad para continuar.");
            return;
        }
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
            setError(submissionError instanceof Error ? submissionError.message : "Ocurrió un error inesperado.");
        } finally {
            setIsSubmitting(false);
        }
    }

    if (message) {
        return <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm leading-6"><p className="font-semibold text-foreground">Revisa tu correo</p><p className="mt-1 text-muted-foreground">{message}</p><p className="mt-4 text-muted-foreground">El enlace vence pronto. Si ya tienes una cuenta, puedes <Link href="/login" className="font-medium text-primary hover:underline">iniciar sesión</Link>.</p></div>;
    }

    return (
        <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium"><span>Tu nombre</span><input name="name" required maxLength={160} autoComplete="name" className="h-11 w-full rounded-md border bg-background px-3" placeholder="Tu nombre" /></label>
                <label className="space-y-1.5 text-sm font-medium"><span>Nombre del negocio</span><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} required maxLength={160} className="h-11 w-full rounded-md border bg-background px-3" placeholder="Salón Luna" /></label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium"><span>Correo electrónico</span><input name="email" required type="email" autoComplete="email" className="h-11 w-full rounded-md border bg-background px-3" placeholder="tu@negocio.com" /></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>Contraseña</span><input name="password" required minLength={12} maxLength={128} type="password" autoComplete="new-password" className="h-11 w-full rounded-md border bg-background px-3" placeholder="Mínimo 12 caracteres" /></label>
            <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm leading-5"><input name="legalAccepted" required type="checkbox" className="mt-0.5 size-4" /><span>Acepto los <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">Términos de servicio</Link> y el <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">Aviso de privacidad</Link>.</span></label>
            <TurnstileWidget action="signup" onToken={handleCaptcha} siteKey={turnstileSiteKey} />
            {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <button disabled={isSubmitting} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60" type="submit">
                {isSubmitting ? <><Loader2 className="mr-2 size-4 animate-spin" />Enviando verificación...</> : "Crear mi espacio de prueba"}
            </button>
        </form>
    );
}
