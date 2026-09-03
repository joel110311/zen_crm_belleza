"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Building2, Clock3, Palette, ShieldCheck, UsersRound } from "lucide-react";
import { SpecialistsWorkspace } from "@/components/tenant/specialists-workspace";
import { ResourcePage } from "@/components/tenant/resource-ui";
import { cn } from "@/lib/utils";

export function SettingsWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const searchParams = useSearchParams();
    const activeTab = searchParams.get("tab") === "team" ? "team" : "general";
    const base = `/t/${tenantSlug}`;

    return (
        <ResourcePage title="Configuración" description="Administra los datos de tu negocio, el equipo y las reglas de atención.">
            <div className="space-y-6">
                <nav className="flex w-full gap-1 overflow-x-auto rounded-[15px] border bg-muted/45 p-1.5" aria-label="Secciones de configuración">
                    <Link href={base + "/settings"} className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-[11px] px-3 text-sm font-medium transition-colors", activeTab === "general" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Building2 className="size-4" />Negocio</Link>
                    <Link href={base + "/settings?tab=team"} className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-[11px] px-3 text-sm font-medium transition-colors", activeTab === "team" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><UsersRound className="size-4" />Equipo</Link>
                </nav>

                {activeTab === "team" ? (
                    <section>
                        <div className="max-w-2xl"><h2 className="text-xl font-semibold">Equipo</h2><p className="mt-1.5 text-sm leading-6 text-muted-foreground">Agrega los profesionales que trabajan contigo y define la información que necesitarás para organizar su agenda. No se envían invitaciones ni correos desde esta sección.</p></div>
                        <div className="mt-5"><SpecialistsWorkspace tenantSlug={tenantSlug} embedded /></div>
                    </section>
                ) : (
                    <section className="grid gap-4 lg:grid-cols-2">
                        <SettingsCard href={`${base}/onboarding`} icon={Building2} title="Datos del negocio" description="Nombre, giro, país, zona horaria y datos visibles." />
                        <SettingsCard href={`${base}/onboarding`} icon={Clock3} title="Horarios de atención" description="Días y horarios disponibles para tu agenda." />
                        <SettingsCard href={`${base}/onboarding`} icon={ShieldCheck} title="Políticas de atención" description="Cancelaciones, anticipos y reglas del servicio." />
                        <SettingsCard href={`${base}/onboarding`} icon={Palette} title="Portal de reservas" description="Personaliza la página pública de tu negocio." />
                    </section>
                )}
            </div>
        </ResourcePage>
    );
}

function SettingsCard({ href, icon: Icon, title, description }: { href: string; icon: typeof Building2; title: string; description: string }) {
    return (
        <Link href={href} className="group flex items-start gap-4 rounded-[18px] border bg-card p-5 transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span></span>
            <ArrowUpRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
    );
}
