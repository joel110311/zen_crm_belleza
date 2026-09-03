"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    BriefcaseBusiness,
    CalendarDays,
    LayoutDashboard,
    Menu,
    Scissors,
    Stethoscope,
    UserRound,
    Users,
    X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";

const ITEMS = [
    { href: "dashboard", label: "Inicio", icon: LayoutDashboard },
    { href: "calendar", label: "Agenda", icon: CalendarDays },
    { href: "contacts", label: "Contactos", icon: Users },
    { href: "patients", label: "Pacientes", icon: Stethoscope },
    { href: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
    { href: "services", label: "Servicios", icon: Scissors },
    { href: "specialists", label: "Equipo", icon: UserRound },
] as const;

const TenantRoleContext = createContext("RECEPTION");

export function useTenantRole() {
    return useContext(TenantRoleContext);
}

export function TenantShell({
    tenantSlug,
    displayName,
    role,
    children,
}: {
    tenantSlug: string;
    displayName: string;
    role: string;
    children: ReactNode;
}) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const base = `/t/${tenantSlug}`;

    const navigation = (
        <nav className="space-y-1 p-3" aria-label="Módulos del negocio">
            {ITEMS.filter((item) => role !== "PROFESSIONAL" || item.href !== "pipeline").map(({ href, label, icon: Icon }) => {
                const destination = `${base}/${href}`;
                const active = pathname === destination || pathname.startsWith(`${destination}/`);
                return (
                    <Link
                        key={href}
                        href={destination}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                        <Icon className="size-[18px]" aria-hidden="true" />
                        {label}
                    </Link>
                );
            })}
        </nav>
    );

    return (
        <TenantRoleContext.Provider value={role}>
        <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="sticky top-0 hidden h-dvh border-r bg-card/85 backdrop-blur-xl lg:flex lg:flex-col">
                <div className="border-b px-5 py-5">
                    <p className="truncate text-base font-semibold">{displayName}</p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">{role.toLowerCase()} · {tenantSlug}</p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
                <div className="border-t p-4 text-xs leading-5 text-muted-foreground">Espacio de trabajo aislado</div>
            </aside>

            <div className="min-w-0">
                <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-xl lg:hidden">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{displayName}</p>
                        <p className="text-[11px] text-muted-foreground">{tenantSlug}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setOpen((value) => !value)} aria-label="Abrir navegación">
                        {open ? <X className="size-5" /> : <Menu className="size-5" />}
                    </Button>
                </header>
                {open ? <div className="fixed inset-x-0 top-14 z-30 border-b bg-background/95 shadow-lg backdrop-blur-xl lg:hidden">{navigation}</div> : null}
                <div className="min-w-0">{children}</div>
            </div>
        </div>
        </TenantRoleContext.Provider>
    );
}
