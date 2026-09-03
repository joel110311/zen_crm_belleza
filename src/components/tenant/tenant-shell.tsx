"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
    BriefcaseBusiness,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    LayoutDashboard,
    LogOut,
    Menu,
    Scissors,
    Settings,
    Store,
    Users,
    X,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

const ITEMS = [
    { href: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "contacts", label: "Clientes", icon: Users },
    { href: "services", label: "Servicios", icon: Scissors },
    { href: "calendar", label: "Calendario", icon: CalendarDays },
    { href: "pipeline", label: "Pipeline", icon: BriefcaseBusiness },
    { href: "onboarding", label: "Mi negocio", icon: Store },
    { href: "settings", label: "Configuración", icon: Settings },
] as const;

const TenantRoleContext = createContext("RECEPTION");

export function useTenantRole() {
    return useContext(TenantRoleContext);
}

export function TenantShell({
    tenantSlug,
    displayName,
    userName,
    role,
    children,
}: {
    tenantSlug: string;
    displayName: string;
    userName: string;
    role: string;
    children: ReactNode;
}) {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [desktopCollapsed, setDesktopCollapsed] = useState(false);
    const base = `/t/${tenantSlug}`;
    const initials = (userName || displayName).trim().charAt(0).toUpperCase() || "U";

    useEffect(() => {
        document.body.style.overflow = mobileOpen ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [mobileOpen]);

    const availableItems = ITEMS.filter((item) => role !== "PROFESSIONAL" || item.href !== "pipeline");
    const isActive = (href: string) => {
        const destination = `${base}/${href}`;
        return pathname === destination || pathname.startsWith(`${destination}/`);
    };

    const navigation = (compact = false) => (
        <nav className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2", compact ? "items-center px-2" : "px-3")} aria-label="Módulos del CRM">
            {availableItems.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                    <Link
                        key={href}
                        href={`${base}/${href}`}
                        title={label}
                        aria-label={label}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                            "relative flex shrink-0 items-center rounded-full text-sm font-medium transition-[background-color,color,transform] duration-200 active:scale-[.97]",
                            compact ? "h-10 w-10 justify-center" : "h-11 w-full gap-3 px-3",
                            active
                                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                    >
                        {active && compact ? <span className="absolute -left-[1.15rem] h-5 w-1 rounded-r-full bg-gold" /> : null}
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        <span className={cn(
                            "overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-[220ms]",
                            compact ? "max-w-0 -translate-x-1 opacity-0" : "max-w-[11rem] translate-x-0 opacity-100",
                        )}>{label}</span>
                    </Link>
                );
            })}
        </nav>
    );

    const account = (compact = false) => (
        <div className={cn("mt-2 border-t border-sidebar-border p-3", compact && "flex flex-col items-center gap-2")}>
            <div className={cn(
                "flex items-center gap-3 overflow-hidden rounded-2xl bg-sidebar-accent transition-[max-height,margin,opacity,transform] duration-[240ms]",
                compact ? "max-h-0 -translate-y-1 px-3 py-0 opacity-0" : "mb-2 max-h-14 translate-y-0 px-3 py-2.5 opacity-100",
            )}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">{initials}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{userName || "Mi cuenta"}</span>
            </div>
            {compact ? <span title={userName} className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-sidebar-primary/30 bg-sidebar-primary/15 text-xs font-bold text-sidebar-foreground">{initials}</span> : null}
            <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/" })}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className={cn(
                    "flex h-9 items-center rounded-full text-sm text-sidebar-foreground/70 transition-[background-color,color,transform] duration-200 hover:bg-destructive/15 hover:text-red-300 active:scale-[.97]",
                    compact ? "w-9 justify-center" : "w-full gap-3 px-3",
                )}
            >
                <LogOut className="h-4 w-4" />
                <span className={cn("overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200", compact ? "max-w-0 opacity-0" : "max-w-[10rem] opacity-100")}>Cerrar sesión</span>
            </button>
        </div>
    );

    return (
        <TenantRoleContext.Provider value={role}>
            <div className="apple-workspace flex h-dvh w-full overflow-hidden bg-background" data-apple-workspace>
                <header className="apple-mobile-bar fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b px-4 md:hidden">
                    <button type="button" onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground transition-transform active:scale-95" aria-label="Abrir menú">
                        <Menu className="h-4 w-4" />
                    </button>
                    <Link href={`${base}/dashboard`} className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-gold"><BrandLogo brandName="SynapseLogik CRM" className="h-5 w-5" /></span>
                        <span className="max-w-44 truncate text-sm font-semibold text-foreground">{displayName}</span>
                    </Link>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials}</span>
                </header>

                <button type="button" aria-label="Cerrar menú" aria-hidden={!mobileOpen} className={cn("fixed inset-0 z-40 bg-black/25 backdrop-blur-sm transition-opacity duration-200 md:hidden", mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")} onClick={() => setMobileOpen(false)} />

                <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground transition-transform duration-[260ms] ease-[cubic-bezier(.22,.8,.24,1)] md:hidden", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
                    <div className="flex items-center justify-between border-b border-sidebar-border px-2 pb-3">
                        <Link href={`${base}/dashboard`} className="flex min-w-0 items-center gap-3" onClick={() => setMobileOpen(false)}>
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-gold"><BrandLogo brandName="SynapseLogik CRM" className="h-6 w-6" /></span>
                            <div className="min-w-0"><p className="truncate text-sm font-semibold">SynapseLogik CRM</p><p className="text-xs text-sidebar-foreground/55">Centro de operaciones</p></div>
                        </Link>
                        <button type="button" onClick={() => setMobileOpen(false)} className="rounded-full p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" aria-label="Cerrar menú"><X className="h-4 w-4" /></button>
                    </div>
                    <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">Operación</p>
                    {navigation()}
                    {account()}
                </aside>

                <aside className={cn("hidden h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-[320ms] ease-[cubic-bezier(.22,.8,.24,1)] md:flex", desktopCollapsed ? "w-[4.75rem]" : "w-[17rem]")}>
                    <div className={cn("flex shrink-0 border-b border-sidebar-border p-3", desktopCollapsed ? "flex-col items-center gap-2" : "items-center gap-2.5")}>
                        <Link href={`${base}/dashboard`} title="SynapseLogik CRM" aria-label="SynapseLogik CRM" className={cn("flex min-w-0 items-center", desktopCollapsed ? "justify-center" : "flex-1 gap-3")}>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-gold"><BrandLogo brandName="SynapseLogik CRM" className="h-6 w-6" /></span>
                            <span className={cn("min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-[240ms]", desktopCollapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-[11rem] translate-x-0 opacity-100")}><span className="block truncate text-sm font-semibold text-sidebar-accent-foreground">SynapseLogik CRM</span><span className="block truncate text-xs text-sidebar-foreground/55">Centro de operaciones</span></span>
                        </Link>
                        <button type="button" onClick={() => setDesktopCollapsed((value) => !value)} aria-label={desktopCollapsed ? "Desplegar menú lateral" : "Plegar menú lateral"} aria-expanded={!desktopCollapsed} title={desktopCollapsed ? "Desplegar menú" : "Plegar menú"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/70 transition-[background-color,color,transform] duration-200 hover:text-sidebar-accent-foreground active:scale-95">{desktopCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
                    </div>
                    <p className={cn("overflow-hidden px-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold transition-[max-height,padding,opacity] duration-200", desktopCollapsed ? "max-h-0 py-0 opacity-0" : "max-h-10 pb-1 pt-4 opacity-100")}>Operación</p>
                    {navigation(desktopCollapsed)}
                    {account(desktopCollapsed)}
                </aside>

                <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background pt-14 md:pt-0">
                    <header className="sticky top-0 z-10 hidden px-4 pt-3 md:block lg:px-5 xl:px-6">
                        <div className="apple-frosted-bar flex min-h-[52px] items-center justify-between gap-3 rounded-[18px] border px-4">
                            <div className="min-w-0"><p className="truncate text-sm font-semibold">{displayName}</p><p className="text-xs text-muted-foreground">Centro de operaciones</p></div>
                            <Link href={`${base}/settings`} className="inline-flex h-8 items-center rounded-full border border-border/80 bg-secondary/65 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">Configuración</Link>
                        </div>
                    </header>
                    <main className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-3 md:px-5 md:pb-4 md:pt-4 lg:px-6"><div className="min-h-full">{children}</div></main>
                </div>
            </div>
        </TenantRoleContext.Provider>
    );
}
