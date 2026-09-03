"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export function ResetPasswordForm() {
    const params = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [pending, setPending] = useState(false);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(null);
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") || "");
        if (password !== String(form.get("confirmPassword") || "")) { setError("Las contraseñas no coinciden."); return; }
        setPending(true);
        try {
            const response = await fetch("/api/public/password-reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: params.get("token"), password }) });
            const data = await response.json() as { updated?: boolean; error?: string };
            if (!response.ok) throw new Error(data.error || "No fue posible restablecer la contraseña.");
            if (!data.updated) throw new Error("Este enlace ya no es válido. Solicita uno nuevo.");
            setSuccess(true);
        } catch (resetError) { setError(resetError instanceof Error ? resetError.message : "Ocurrió un error inesperado."); } finally { setPending(false); }
    }
    return <section className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-semibold">Elige una contraseña nueva</h1>{success ? <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"><p>Tu contraseña se actualizó y las sesiones anteriores se cerraron.</p><Link href="/login" className="mt-4 inline-block font-semibold text-primary hover:underline">Iniciar sesión</Link></div> : <form className="mt-6 space-y-4" onSubmit={submit}><label className="block text-sm font-medium">Nueva contraseña<input name="password" required minLength={12} maxLength={128} type="password" autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border bg-background px-3" /></label><label className="block text-sm font-medium">Confirma la contraseña<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" className="mt-1 h-11 w-full rounded-md border bg-background px-3" /></label>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<button disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? <><Loader2 className="mr-2 size-4 animate-spin" />Guardando...</> : "Actualizar contraseña"}</button></form>}</section>;
}
