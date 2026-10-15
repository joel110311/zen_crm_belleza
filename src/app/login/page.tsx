"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/public/auth-shell";
import { PasswordField } from "@/components/public/password-field";
import styles from "@/components/public/auth-workspace.module.css";
import { resolveBranding, type BrandingSettings } from "@/lib/branding";
import { googleLoginAction, loginAction } from "./actions";

export default function LoginPage() {
    const [errorMessage, formAction, isPending] = useActionState(loginAction, undefined);
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [branding, setBranding] = useState<BrandingSettings>(() => resolveBranding(null));
    const searchParams = useSearchParams();
    const redirectTo = searchParams.get("redirectTo") || searchParams.get("callbackUrl") || "/dashboard";
    const oauthError = (() => {
        switch (searchParams.get("error")) {
            case "google_account_not_ready":
                return "Este correo todavía no tiene una cuenta activa. Completa primero el registro y la verificación por correo.";
            case "google_email_unverified":
                return "Google no confirmó que el correo esté verificado.";
            case "google_not_configured":
                return "El acceso con Google todavía no está habilitado.";
            case "AccessDenied":
                return "No fue posible autorizar esta cuenta de Google.";
            default:
                return null;
        }
    })();

    useEffect(() => {
        let ignore = false;

        fetch("/api/branding", { cache: "no-store" })
            .then((response) => response.json())
            .then((data) => {
                if (!ignore) setBranding(resolveBranding(data));
            })
            .catch(() => {
                if (!ignore) setBranding(resolveBranding(null));
            });

        return () => {
            ignore = true;
        };
    }, []);

    useEffect(() => {
        let ignore = false;
        fetch("/api/auth/capabilities", { cache: "no-store" })
            .then((response) => response.json())
            .then((data: { google?: boolean }) => {
                if (!ignore) setGoogleEnabled(data.google === true);
            })
            .catch(() => {
                if (!ignore) setGoogleEnabled(false);
            });
        return () => {
            ignore = true;
        };
    }, []);

    return <AuthShell title="Inicia sesión" description="Accede a tu agenda, clientes y conversaciones." branding={branding}>
        {googleEnabled && <>
            <form action={googleLoginAction}>
                <input type="hidden" name="redirectTo" value={redirectTo.startsWith("/") ? redirectTo : "/tenants"} />
                <Button type="submit" variant="secondary" className={styles.secondary}>
                                        <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-3 h-5 w-5">
                                            <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
                                            <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
                                            <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.07 12c0-.67.11-1.32.32-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z" />
                                            <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
                                        </svg>
                    Continuar con Google
                </Button>
            </form>
            <p className={styles.divider}>O usa tu correo</p>
        </>}
        <form action={formAction} className={styles.form} aria-busy={isPending}>
            <input type="hidden" name="redirectTo" value={redirectTo.startsWith("/") ? redirectTo : "/dashboard"} />
            <fieldset disabled={isPending} className={styles.fields}>
                <div className={styles.field}><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
                <PasswordField id="password" name="password" label="Contraseña" autoComplete="current-password" />
                {(errorMessage || oauthError) && <div role="alert" className={styles.error}>{errorMessage || oauthError}</div>}
                <button type="submit" disabled={isPending} className={styles.submit}>
                    {isPending ? <><Loader2 className="size-5 animate-spin" aria-hidden="true" />Verificando…</> : "Iniciar sesión"}
                </button>
            </fieldset>
        </form>
        <div className={styles.links}>
            <Link href="/forgot-password">¿Olvidaste tu contraseña?</Link>
            <p>¿Aún no tienes cuenta? <Link href="/signup">Crear cuenta</Link></p>
        </div>
    </AuthShell>;
}
