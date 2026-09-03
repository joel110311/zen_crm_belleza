"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InvitationAcceptanceForm({ token }: { token: string }) {
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [complete, setComplete] = useState<{ displayName: string; signInPath: string } | null>(null);

    async function accept(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch("/api/public/invitations/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name, password }),
            });
            const payload = await response.json().catch(() => null) as {
                data?: { displayName?: string; signInPath?: string };
                error?: { message?: string };
            } | null;
            if (!response.ok || !payload?.data?.displayName || !payload.data.signInPath) {
                throw new Error(payload?.error?.message || "No fue posible aceptar la invitación.");
            }
            setComplete({ displayName: payload.data.displayName, signInPath: payload.data.signInPath });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible aceptar la invitación.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-5 py-10">
            <section className="w-full max-w-md rounded-3xl border bg-background p-6 shadow-xl shadow-black/5 sm:p-8">
                {complete ? <div className="text-center">
                    <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
                    <p className="mt-5 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">Invitación aceptada</p>
                    <h1 className="mt-2 text-2xl font-semibold">Ya formas parte de {complete.displayName}</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">Inicia sesión para entrar a tu espacio. Si ya tenías cuenta, usa la contraseña que ya conoces.</p>
                    <Button className="mt-6 w-full" asChild><Link href={complete.signInPath}>Iniciar sesión</Link></Button>
                </div> : <>
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UsersRound className="size-6" /></div>
                    <p className="mt-5 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">Invitación de equipo</p>
                    <h1 className="mt-2 text-2xl font-semibold">Únete al negocio</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">Si este correo aún no tiene cuenta, escribe tu nombre y crea una contraseña. Si ya tienes una, puedes dejar ambos campos vacíos.</p>
                    <form className="mt-6 space-y-4" onSubmit={accept}>
                        <label className="block space-y-2"><Label>Nombre (solo para una cuenta nueva)</Label><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} autoComplete="name" /></label>
                        <label className="block space-y-2"><Label>Contraseña nueva (solo para una cuenta nueva)</Label><Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={12} maxLength={128} autoComplete="new-password" /></label>
                        {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
                        <Button type="submit" disabled={submitting} className="w-full">{submitting ? <><Loader2 className="mr-2 size-4 animate-spin" />Aceptando…</> : "Aceptar invitación"}</Button>
                    </form>
                </>}
            </section>
        </main>
    );
}
