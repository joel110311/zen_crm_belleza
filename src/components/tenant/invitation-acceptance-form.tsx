"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/public/auth-shell";
import styles from "@/components/public/auth-workspace.module.css";

export function InvitationAcceptanceForm({ token, displayName, requiresNewAccount = true, alreadyAccepted = false, signInPath = "/login" }: {
    token: string;
    displayName?: string;
    requiresNewAccount?: boolean;
    alreadyAccepted?: boolean;
    signInPath?: string;
}) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [visible, setVisible] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [complete, setComplete] = useState<{ displayName: string; signInPath: string } | null>(alreadyAccepted && displayName ? { displayName, signInPath } : null);

    async function accept(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submittingRef.current || complete) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch("/api/public/invitations/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, ...(requiresNewAccount ? { name, password } : {}) }),
            });
            const payload = await response.json().catch(() => null) as {
                data?: { displayName?: string; signInPath?: string };
                error?: { message?: string };
            } | null;
            if (!response.ok || !payload?.data?.displayName || !payload.data.signInPath) {
                throw new Error(payload?.error?.message || "No fue posible aceptar la invitación.");
            }
            setPassword("");
            setComplete({ displayName: payload.data.displayName, signInPath: payload.data.signInPath });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible aceptar la invitación.");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }

    return <AuthShell title={complete ? "Invitación aceptada" : "Únete a tu equipo"}
        description={complete ? `Ya formas parte de ${complete.displayName}.` : `Acepta la invitación para entrar a ${displayName || "tu negocio"}.`}>
        {complete ? <>
            <div className={styles.notice} role="status"><p>Tu acceso está listo. Inicia sesión con tu cuenta para entrar al negocio.</p></div>
            <div className={styles.links}><Link className={styles.submit} href={complete.signInPath}>Iniciar sesión</Link></div>
        </> : <>
            <div className={styles.notice}><p>{requiresNewAccount ? "Escribe tu nombre y crea una contraseña para activar tu cuenta." : "Tu correo ya tiene una cuenta en este CRM. Acepta la invitación y conserva tu contraseña actual."}</p></div>
            <form className={`${styles.form} mt-6`} onSubmit={accept} aria-busy={submitting}>
                {requiresNewAccount && <fieldset className={styles.fields} disabled={submitting}>
                    <legend className="sr-only">Crea tu cuenta</legend>
                    <div className={styles.field}><label htmlFor="invitation-name">Nombre</label><input id="invitation-name" name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={160} autoComplete="name" /></div>
                    <div className={styles.field}>
                        <label htmlFor="invitation-password">Contraseña nueva</label>
                        <div className={styles.password}>
                            <input id="invitation-password" name="password" value={password} onChange={event => setPassword(event.target.value)} type={visible ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="invitation-password-hint" />
                            <button type="button" className={styles.passwordToggle} onClick={() => setVisible(current => !current)} aria-label={`${visible ? "Ocultar" : "Mostrar"} contraseña nueva`} aria-pressed={visible} aria-controls="invitation-password">{visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}</button>
                        </div>
                        <p id="invitation-password-hint" className={styles.hint}>Usa al menos 12 caracteres.</p>
                    </div>
                </fieldset>}
                {error && <p role="alert" className={styles.error}>{error}</p>}
                <button type="submit" disabled={submitting} className={styles.submit}>{submitting ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Aceptando…</> : "Aceptar invitación"}</button>
            </form>
            <div className={styles.links}><Link href="/login">Volver a iniciar sesión</Link><p>Si el enlace venció, pide otra invitación al administrador.</p></div>
        </>}
    </AuthShell>;
}
