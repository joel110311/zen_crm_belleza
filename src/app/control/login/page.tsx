"use client";
import Link from "next/link";
import { useActionState } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformAdminLoginAction } from "./actions";

export default function PlatformAdminLogin() {
    const [error, action, pending] = useActionState(platformAdminLoginAction, undefined);
    return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12"><section className="w-full max-w-md rounded-2xl border bg-card p-8"><BrandLogo brandName="Zen CRM" className="h-12 w-12 text-primary" /><p className="mt-5 text-sm font-semibold text-primary">Administración de plataforma</p><h1 className="mt-2 text-2xl font-semibold">Entrar al centro de mando</h1><p className="mt-3 text-sm text-muted-foreground">Acceso interno para administrar la IA, las pruebas y los planes. No es el acceso de tus clientes.</p><form action={action} className="mt-6 space-y-4"><div className="space-y-2"><Label htmlFor="admin-username">Usuario</Label><Input id="admin-username" name="username" autoComplete="username" required maxLength={64} placeholder="adminjoel" /></div><div className="space-y-2"><Label htmlFor="admin-password">Contraseña</Label><Input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></div>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<Button type="submit" className="w-full" disabled={pending}>{pending ? "Ingresando…" : "Entrar al panel administrativo"}</Button></form><Link className="mt-5 block text-center text-sm text-primary" href="/login?redirectTo=%2Fcontrol">Entrar con una cuenta administradora por correo</Link><Link className="mt-3 block text-center text-sm text-muted-foreground" href="/">Volver al CRM</Link></section></main>;
}
