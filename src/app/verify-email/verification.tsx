"use client";

import styles from "@/components/public/auth-workspace.module.css";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

export function EmailVerification() {
    const params = useSearchParams();
    const token = params.get("token");
    const [state, setState] = useState<"checking" | "verified" | "invalid">(() => token ? "checking" : "invalid");
    const [onboardingPath, setOnboardingPath] = useState<string | null>(null);
    const [trialEligible, setTrialEligible] = useState(true);

    useEffect(() => {
        if (!token) return;
        let active = true;
        void fetch("/api/public/signup-intents/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        }).then(async (response) => {
            const data = await response.json() as { verified?: boolean; onboardingPath?: string; trialEligible?: boolean };
            if (!active) return;
            if (response.ok && data.verified && data.onboardingPath) {
                setOnboardingPath(data.onboardingPath);
                setTrialEligible(data.trialEligible !== false);
                setState("verified");
            } else setState("invalid");
        }).catch(() => { if (active) setState("invalid"); });
        return () => { active = false; };
    }, [token]);

    return <div aria-live="polite" aria-busy={state === "checking"}>
        {state === "checking" && <div role="status" className={styles.notice}><Loader2 className="mb-3 size-7 animate-spin text-primary" aria-hidden="true" /><strong>Estamos confirmando tu correo</strong><p>Esto tarda sólo unos segundos.</p></div>}
        {state === "verified" && <>
            <div role="status" className={styles.notice}><CheckCircle2 className="mb-3 size-8 text-primary" aria-hidden="true" /><strong>Correo confirmado</strong><p>{trialEligible ? "Tu espacio se está preparando. Inicia sesión para continuar con la configuración inicial." : "Este correo ya utilizó su período de prueba. Prepararemos tu espacio y podrás continuar eligiendo un plan."}</p></div>
            <div className={styles.links}><Link href={`/login?redirectTo=${encodeURIComponent(onboardingPath || "/tenants")}`} className={styles.submit}>Iniciar sesión y continuar</Link></div>
        </>}
        {state === "invalid" && <>
            <div role="status" className={styles.notice}><TriangleAlert className="mb-3 size-8 text-primary" aria-hidden="true" /><strong>Enlace no válido</strong><p>El enlace venció o ya fue utilizado. Vuelve al registro para recibir uno nuevo.</p></div>
            <div className={styles.links}><Link href="/signup">Volver al registro</Link><Link href="/login">Ya tengo cuenta: iniciar sesión</Link></div>
        </>}
    </div>;
}
