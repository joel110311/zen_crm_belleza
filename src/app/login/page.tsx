"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand/brand-logo";
import { resolveBranding, type BrandingSettings } from "@/lib/branding";
import { loginAction } from "./actions";

export default function LoginPage() {
    const [errorMessage, formAction, isPending] = useActionState(loginAction, undefined);
    const [showPassword, setShowPassword] = useState(false);
    const [branding, setBranding] = useState<BrandingSettings>(() => resolveBranding(null));

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

    return (
        <div className="relative min-h-dvh overflow-hidden bg-[#f7f8f6] text-foreground">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute -left-40 top-1/3 h-80 w-80 rounded-full bg-primary/[0.045] blur-3xl sm:h-[30rem] sm:w-[30rem]" />
                <div className="absolute -right-40 bottom-0 h-96 w-96 rounded-full bg-[#dfe8df]/50 blur-3xl sm:h-[34rem] sm:w-[34rem]" />
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </div>

            <main className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1280px] items-center gap-10 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-12 xl:gap-24">
                <section className="hidden max-w-xl lg:block">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                        Gestión para negocios de belleza
                    </p>
                    <h1 className="mt-5 text-balance text-5xl font-semibold leading-[1.06] tracking-[-0.04em] xl:text-6xl">
                        Tu negocio, organizado y siempre cerca de tus clientes.
                    </h1>
                    <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">
                        Administra citas, clientes y conversaciones desde un solo espacio diseñado para trabajar con claridad.
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-foreground/75">
                        <span>Agenda</span>
                        <span className="h-1 w-1 rounded-full bg-primary/60" />
                        <span>Clientes</span>
                        <span className="h-1 w-1 rounded-full bg-primary/60" />
                        <span>Conversaciones</span>
                    </div>
                </section>

                <section className="mx-auto w-full max-w-[540px]">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-3">
                            <BrandLogo
                                brandName={branding.brandName}
                                logoUrl={branding.brandLogoUrl}
                                className="h-12 w-12 shrink-0 text-foreground sm:h-14 sm:w-14"
                            />
                            <div className="min-w-0 text-left">
                                <p className="truncate text-sm font-semibold sm:text-base">{branding.brandName}</p>
                                <p className="text-xs text-muted-foreground">CRM para belleza</p>
                            </div>
                        </div>
                        <h2 className="mt-6 text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                            Bienvenido a {branding.brandName}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                            Gestión inteligente de clientes con IA
                        </p>
                    </div>

                    <div className="mt-7 rounded-[1.5rem] border border-black/[0.08] bg-white p-5 shadow-[0_24px_70px_-28px_rgba(22,28,18,0.28)] sm:mt-8 sm:p-8">
                        <div className="mb-6">
                            <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">Iniciar sesión</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Ingresa tus credenciales para continuar</p>
                        </div>

                        <form action={formAction} className="space-y-5">
                            <input type="hidden" name="redirectTo" value="/dashboard" />

                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-sm font-semibold">
                                    Correo electrónico
                                </Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="tu@email.com"
                                    required
                                    className="h-12 rounded-xl border-black/[0.08] bg-[#f2f5f8] px-4 text-base shadow-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/15 sm:h-13"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-sm font-semibold">
                                    Contraseña
                                </Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        name="password"
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="current-password"
                                        placeholder="••••••••"
                                        required
                                        className="h-12 rounded-xl border-black/[0.08] bg-[#f2f5f8] px-4 pr-12 text-base shadow-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/15 sm:h-13"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((current) => !current)}
                                        aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                        className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                                    >
                                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>

                            {errorMessage ? (
                                <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.07] px-4 py-3 text-sm text-destructive">
                                    {errorMessage}
                                </div>
                            ) : null}

                            <Button
                                type="submit"
                                disabled={isPending}
                                className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-none transition hover:bg-primary/90 sm:h-13"
                            >
                                {isPending ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Verificando...
                                    </>
                                ) : (
                                    "Iniciar sesión"
                                )}
                            </Button>
                        </form>
                    </div>

                    <p className="mt-6 text-center text-xs text-muted-foreground sm:mt-7">
                        v1.0 · © 2026 {branding.brandName}
                    </p>
                    <p className="mt-4 text-center text-xs font-medium text-foreground/55 lg:hidden">
                        Agenda · Clientes · Conversaciones
                    </p>
                </section>
            </main>
        </div>
    );
}
