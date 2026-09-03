"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

export function EmailVerification() {
    const params = useSearchParams();
    const token = params.get("token");
    const [state, setState] = useState<"checking" | "verified" | "invalid">(() => token ? "checking" : "invalid");
    const [onboardingPath, setOnboardingPath] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        let active = true;
        void fetch("/api/public/signup-intents/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        }).then(async (response) => {
            const data = await response.json() as { verified?: boolean; onboardingPath?: string };
            if (!active) return;
            if (response.ok && data.verified && data.onboardingPath) {
                setOnboardingPath(data.onboardingPath);
                setState("verified");
            } else setState("invalid");
        }).catch(() => { if (active) setState("invalid"); });
        return () => { active = false; };
    }, [token]);

    return <section className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        {state === "checking" ? <><Loader2 className="size-7 animate-spin text-primary" /><h1 className="mt-5 text-2xl font-semibold">Estamos confirmando tu correo</h1><p className="mt-2 text-sm text-muted-foreground">Esto tarda sólo unos segundos.</p></> : null}
        {state === "verified" ? <><CheckCircle2 className="size-8 text-emerald-600" /><h1 className="mt-5 text-2xl font-semibold">Correo confirmado</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Tu espacio se está preparando. Inicia sesión para continuar con la configuración inicial.</p><Link href={`/login?redirectTo=${encodeURIComponent(onboardingPath || "/tenants")}`} className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Iniciar sesión y continuar</Link></> : null}
        {state === "invalid" ? <><TriangleAlert className="size-8 text-amber-600" /><h1 className="mt-5 text-2xl font-semibold">Este enlace ya no es válido</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Por seguridad, los enlaces de confirmación vencen o sólo pueden usarse una vez. Vuelve a registrarte para recibir uno nuevo.</p><Link href="/signup" className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Volver al registro</Link></> : null}
    </section>;
}
