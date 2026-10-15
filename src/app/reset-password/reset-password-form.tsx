"use client";

import { PasswordField } from "@/components/public/password-field";
import styles from "@/components/public/auth-workspace.module.css";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export function ResetPasswordForm() {
    const params = useSearchParams();
    const token = params.get("token");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [pending, setPending] = useState(false);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending || !token) return;
        setError(null);
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") || "");
        if (password !== String(form.get("confirmPassword") || "")) { setError("Las contraseñas no coinciden."); return; }
        setPending(true);
        try {
            const response = await fetch("/api/public/password-reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
            const data = await response.json() as { updated?: boolean; error?: string };
            if (!response.ok) throw new Error(data.error || "No fue posible restablecer la contraseña.");
            if (!data.updated) throw new Error("Este enlace ya no es válido. Solicita uno nuevo.");
            setSuccess(true);
        } catch (resetError) { setError(resetError instanceof Error ? resetError.message : "Ocurrió un error inesperado."); } finally { setPending(false); }
    }
    if (!token) return <>
        <div className={styles.notice} role="status"><strong>Necesitas un enlace de recuperación</strong><p>Solicita uno nuevo para elegir tu contraseña.</p></div>
        <div className={styles.links}><Link href="/forgot-password">Solicitar enlace</Link><Link href="/login">Volver a iniciar sesión</Link></div>
    </>;
    return <>
        {success ? <div className={styles.notice} role="status"><strong>Contraseña actualizada</strong><p>Las sesiones anteriores se cerraron. Ya puedes iniciar sesión.</p></div> : <form className={styles.form} onSubmit={submit} aria-busy={pending}>
            <fieldset disabled={pending} className={styles.fields}>
                <PasswordField id="reset-password" name="password" label="Nueva contraseña" autoComplete="new-password" minLength={12} maxLength={128} />
                <PasswordField id="confirm-password" name="confirmPassword" label="Confirma la contraseña" autoComplete="new-password" minLength={12} maxLength={128} />
                {error && <p role="alert" className={styles.error}>{error}</p>}
                <button disabled={pending} className={styles.submit}>{pending ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Guardando…</> : "Actualizar contraseña"}</button>
            </fieldset>
        </form>}
        <div className={styles.links}><Link href="/login">{success ? "Iniciar sesión" : "Volver a iniciar sesión"}</Link>{!success && <Link href="/forgot-password">Solicitar otro enlace</Link>}</div>
    </>;
}
