"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
    Banknote,
    BarChart3,
    Bot,
    Calendar,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    LayoutDashboard,
    LayoutTemplate,
    LogOut,
    Menu,
    Settings,
    Store,
    Users,
    X,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { BeautyLeafIcon } from "@/components/icons/beauty-leaf-icon";
import { BrandLogo } from "@/components/brand/brand-logo";
import { resolveBranding, type BrandingSettings } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

type SidebarNavItem = {
    title: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    permission?: PermissionKey;
};

const sidebarNavItems: SidebarNavItem[] = [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    { title: "Clientes", href: "/dashboard/contacts", icon: Users, permission: "contacts.manage" },
    { title: "Servicios", href: "/dashboard/services", icon: BeautyLeafIcon, permission: "services.manage" },
    { title: "Chats", href: "/dashboard/inbox", icon: WhatsAppIcon, permission: "chats.manage" },
    { title: "Mi Negocio", href: "/dashboard/business", icon: Store, permission: "settings.manage" },
    { title: "Recepción", href: "/dashboard/reception", icon: ClipboardCheck, permission: "reception.manage" },
    { title: "Caja", href: "/dashboard/billing", icon: Banknote, permission: "billing.manage" },
    { title: "Reportes", href: "/dashboard/reports", icon: BarChart3, permission: "reports.view" },
    { title: "Plantillas", href: "/dashboard/templates", icon: LayoutTemplate, permission: "templates.manage" },
    { title: "Calendario", href: "/dashboard/calendar", icon: Calendar, permission: "calendar.manage" },
    { title: "Asistente IA", href: "/dashboard/brain", icon: Bot, permission: "ai.manage" },
    { title: "Configuración", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [desktopCollapsed, setDesktopCollapsed] = useState(true);
    const [branding, setBranding] = useState<BrandingSettings>(() => resolveBranding(null));
    const { data: session, status } = useSession();
    const sessionLoading = status === "loading";
    const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined;
    const userName = session?.user?.name || (sessionLoading ? "..." : "Usuario");

    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [open]);

    const toggleDesktopSidebar = () => {
        setDesktopCollapsed((current) => !current);
    };

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

    const filteredNavItems = sidebarNavItems.filter((item) => {
        if (sessionLoading) return !item.permission;
        return !item.permission || hasPermission(sessionUser, item.permission);
    });

    const isItemActive = (item: SidebarNavItem) =>
        item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);

    return (
        <>
            <header className="apple-mobile-bar fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b px-4 md:hidden">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground transition-[background-color,transform] duration-200 active:scale-95"
                    aria-label="Abrir menú"
                >
                    <Menu className="h-4 w-4" />
                </button>
                <Link href="/dashboard" className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-gold">
                        <BrandLogo brandName={branding.brandName} logoUrl={branding.brandLogoUrl} className="h-5 w-5" />
                    </span>
                    <span className="max-w-48 truncate text-sm font-semibold text-foreground">{branding.brandName}</span>
                </Link>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {!sessionLoading && userName.charAt(0).toUpperCase()}
                </span>
            </header>

            <button
                type="button"
                aria-label="Cerrar menú"
                aria-hidden={!open}
                className={cn(
                    "fixed inset-0 z-40 bg-black/25 backdrop-blur-sm transition-opacity duration-200 md:hidden",
                    open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
                )}
                onClick={() => setOpen(false)}
            />

            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground transition-transform duration-[260ms] ease-[cubic-bezier(.22,.8,.24,1)] md:hidden",
                    open ? "translate-x-0" : "-translate-x-full",
                )}
            >
                <div className="flex items-center justify-between border-b border-sidebar-border px-2 pb-3">
                    <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-gold">
                            <BrandLogo brandName={branding.brandName} logoUrl={branding.brandLogoUrl} className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{branding.brandName}</p>
                            <p className="text-xs text-sidebar-foreground/55">Centro de operaciones</p>
                        </div>
                    </Link>
                    <button type="button" onClick={() => setOpen(false)} className="rounded-full p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <nav className="mt-3 flex-1 space-y-1 overflow-y-auto">
                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const active = isItemActive(item);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setOpen(false)}
                                className={cn(
                                    "flex h-11 items-center gap-3 rounded-full px-3 text-sm font-medium transition-[background-color,color,transform] duration-200 active:scale-[.98]",
                                    active
                                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                )}
                            >
                                <Icon className="h-[18px] w-[18px]" />
                                {item.title}
                            </Link>
                        );
                    })}
                </nav>

                <div className="border-t border-sidebar-border pt-3">
                    <div className="mb-2 flex items-center gap-3 rounded-2xl bg-sidebar-accent px-3 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
                            {!sessionLoading && userName.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{userName}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => signOut({ callbackUrl: "/login" })}
                        className="flex h-10 w-full items-center gap-3 rounded-full px-3 text-sm text-sidebar-foreground/70 transition-[background-color,color,transform] active:scale-[.98] hover:bg-destructive/15 hover:text-red-300"
                    >
                        <LogOut className="h-4 w-4" />
                        Cerrar sesión
                    </button>
                </div>
            </aside>

            <aside
                className={cn(
                    "hidden h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-[320ms] ease-[cubic-bezier(.22,.8,.24,1)] md:flex",
                    desktopCollapsed ? "w-[4.75rem]" : "w-[17rem]",
                    className,
                )}
            >
                <div className={cn(
                    "flex shrink-0 border-b border-sidebar-border p-3",
                    desktopCollapsed ? "flex-col items-center gap-2" : "items-center gap-2.5",
                )}>
                    <Link
                        href="/dashboard"
                        title={branding.brandName}
                        aria-label={branding.brandName}
                        className={cn("flex min-w-0 items-center", desktopCollapsed ? "justify-center" : "flex-1 gap-3")}
                    >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-gold">
                            <BrandLogo brandName={branding.brandName} logoUrl={branding.brandLogoUrl} className="h-6 w-6" />
                        </span>
                        <span className={cn(
                            "min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-[240ms]",
                            desktopCollapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-[11rem] translate-x-0 opacity-100",
                        )}>
                            <span className="block truncate text-sm font-semibold text-sidebar-accent-foreground">{branding.brandName}</span>
                            <span className="block truncate text-xs text-sidebar-foreground/55">Centro de operaciones</span>
                        </span>
                    </Link>
                    <button
                        type="button"
                        onClick={toggleDesktopSidebar}
                        aria-label={desktopCollapsed ? "Desplegar menú lateral" : "Plegar menú lateral"}
                        aria-expanded={!desktopCollapsed}
                        title={desktopCollapsed ? "Desplegar menú" : "Plegar menú"}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/70 transition-[background-color,color,transform] duration-200 hover:text-sidebar-accent-foreground active:scale-95"
                    >
                        {desktopCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </button>
                </div>

                <p className={cn(
                    "overflow-hidden px-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold transition-[max-height,padding,opacity] duration-200",
                    desktopCollapsed ? "max-h-0 py-0 opacity-0" : "max-h-10 pb-1 pt-4 opacity-100",
                )}>
                    Operación
                </p>

                <nav className={cn(
                    "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2",
                    desktopCollapsed ? "items-center px-2" : "px-3",
                )}>
                    {filteredNavItems.map((item) => {
                        const Icon = item.icon;
                        const active = isItemActive(item);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={item.title}
                                aria-label={item.title}
                                className={cn(
                                    "relative flex shrink-0 items-center rounded-full text-sm font-medium transition-[background-color,color,transform] duration-200 active:scale-[.97]",
                                    desktopCollapsed ? "h-10 w-10 justify-center" : "h-11 w-full gap-3 px-3",
                                    active
                                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                )}
                            >
                                {active && desktopCollapsed && <span className="absolute -left-[1.15rem] h-5 w-1 rounded-r-full bg-gold" />}
                                <Icon className="h-[18px] w-[18px]" />
                                <span className={cn(
                                    "overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-[220ms]",
                                    desktopCollapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-[11rem] translate-x-0 opacity-100",
                                )}>{item.title}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className={cn("mt-2 border-t border-sidebar-border p-3", desktopCollapsed && "flex flex-col items-center gap-2")}>
                    <span
                        title={userName}
                        className={cn(
                            "flex items-center justify-center overflow-hidden rounded-full border border-sidebar-primary/30 bg-sidebar-primary/15 text-xs font-bold text-sidebar-foreground transition-[width,height,opacity] duration-200",
                            desktopCollapsed ? "mb-2 h-9 w-9 opacity-100" : "h-0 w-0 opacity-0",
                        )}
                    >
                        {!sessionLoading && userName.charAt(0).toUpperCase()}
                    </span>
                    <div className={cn(
                        "flex items-center gap-3 overflow-hidden rounded-2xl bg-sidebar-accent transition-[max-height,margin,opacity,transform] duration-[240ms]",
                        desktopCollapsed ? "max-h-0 -translate-y-1 px-3 py-0 opacity-0" : "mb-2 max-h-14 translate-y-0 px-3 py-2.5 opacity-100",
                    )}>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
                                {!sessionLoading && userName.charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{userName}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => signOut({ callbackUrl: "/login" })}
                        title="Cerrar sesión"
                        aria-label="Cerrar sesión"
                        className={cn(
                            "flex h-9 items-center rounded-full text-sm text-sidebar-foreground/70 transition-[background-color,color,transform] duration-200 hover:bg-destructive/15 hover:text-red-300 active:scale-[.97]",
                            desktopCollapsed ? "w-9 justify-center" : "w-full gap-3 px-3",
                        )}
                    >
                        <LogOut className="h-4 w-4" />
                        <span className={cn(
                            "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200",
                            desktopCollapsed ? "max-w-0 opacity-0" : "max-w-[10rem] opacity-100",
                        )}>Cerrar sesión</span>
                    </button>
                </div>
            </aside>
        </>
    );
}
