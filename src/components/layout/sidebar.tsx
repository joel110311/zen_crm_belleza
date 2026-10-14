"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Grid2X2,
  House,
  LayoutTemplate,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Store,
  UserRoundCog,
  Users,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { BeautyLeafIcon } from "@/components/icons/beauty-leaf-icon";
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resolveBranding, type BrandingSettings } from "@/lib/branding";
import {
  getWorkspaceDestinations,
  isWorkspaceDestinationActive,
  type WorkspaceDestination,
} from "@/lib/workspace-navigation";
import { tenantSlugFromPath } from "@/lib/tenant-request-routing";
import { cn } from "@/lib/utils";
import styles from "./workspace.module.css";

const icons = {
  home: House,
  calendar: CalendarDays,
  chat: WhatsAppIcon,
  clients: Users,
  reception: ClipboardCheck,
  templates: LayoutTemplate,
  business: Store,
  services: BeautyLeafIcon,
  team: UserRoundCog,
  ai: Bot,
  settings: Settings,
  control: ShieldCheck,
  billing: CreditCard,
};

export function Sidebar({
  className,
  initialBranding,
  canManageBilling = false,
}: React.HTMLAttributes<HTMLDivElement> & {
  initialBranding?: BrandingSettings;
  canManageBilling?: boolean;
}) {
  const pathname = usePathname();
  const tenantSlug = tenantSlugFromPath(pathname);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [legacyBranding, setBranding] = useState<BrandingSettings>(() =>
    resolveBranding(null),
  );
  const branding = initialBranding || legacyBranding;
  const { data: session, status } = useSession();
  const user = session?.user as
    | { role?: string; permissions?: unknown; isPlatformAdmin?: boolean }
    | undefined;
  const userName = session?.user?.name || "Mi cuenta";
  const home = tenantSlug
    ? `/t/${encodeURIComponent(tenantSlug)}/dashboard`
    : "/dashboard";
  const items = getWorkspaceDestinations({
    subject: user,
    tenantSlug,
    isPlatformAdmin: user?.isPlatformAdmin,
    loading: status === "loading",
    canManageBilling,
  });
  const primary = items.filter((item) => item.primary);
  const moreActive = items.some(
    (item) => !item.primary && isWorkspaceDestinationActive(pathname, item),
  );

  useEffect(() => {
    if (initialBranding) return;
    let ignore = false;
    fetch("/api/branding", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!ignore) setBranding(resolveBranding(data));
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [initialBranding, tenantSlug]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      const editing = document.activeElement?.matches(
        "input, textarea, select, [contenteditable=true]",
      );
      setKeyboardOpen(
        Boolean(
          editing && viewport && window.innerHeight - viewport.height > 150,
        ),
      );
    };
    viewport?.addEventListener("resize", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    };
  }, []);

  const navigationLink = (item: WorkspaceDestination, compact = false) => {
    const Icon = icons[item.icon];
    const active = isWorkspaceDestinationActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        title={compact ? item.title : undefined}
        aria-label={item.title}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 min-w-0 items-center rounded-xl px-3 text-sm font-medium transition-colors",
          compact ? "justify-center" : "gap-3",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        <span className={compact ? "sr-only" : "min-w-0 break-words"}>
          {item.title}
        </span>
      </Link>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <header
        data-mobile-workspace-header
        className={cn(
          styles.mobileHeader,
          "border-b border-border bg-card px-4",
        )}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground"
            aria-label="Abrir menú"
          >
            <Menu className="size-5" />
          </button>
        </DialogTrigger>
        <Link
          href={home}
          className="flex min-w-0 flex-1 items-center justify-center gap-2.5 px-2"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BrandLogo
              brandName={branding.brandName}
              logoUrl={branding.brandLogoUrl}
              className="size-5"
            />
          </span>
          <span
            className="min-w-0 truncate text-sm font-semibold"
            title={branding.brandName}
          >
            {branding.brandName}
          </span>
        </Link>
        <span
          title={userName}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {status === "loading" ? "…" : userName.charAt(0).toUpperCase()}
        </span>
      </header>

      <aside
        className={cn(
          styles.sidebar,
          collapsed && styles.collapsed,
          "border-r border-border bg-card",
          className,
        )}
        aria-label="Menú principal"
      >
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border px-3 py-5",
            collapsed && "flex-col",
          )}
        >
          <Link
            href={home}
            aria-label={branding.brandName}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BrandLogo
                brandName={branding.brandName}
                logoUrl={branding.brandLogoUrl}
                className="size-6"
              />
            </span>
            {!collapsed && (
              <span className="min-w-0 break-words text-sm font-semibold leading-snug">
                {branding.brandName}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={
              collapsed ? "Desplegar menú lateral" : "Plegar menú lateral"
            }
            aria-expanded={!collapsed}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary"
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </button>
        </div>
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
          aria-label="Módulos del CRM"
        >
          {Array.from(new Set(items.map((item) => item.section))).map(
            (section) => (
              <section key={section} className="mb-4 last:mb-0">
                {!collapsed && (
                  <h2 className="mb-2 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    {section}
                  </h2>
                )}
                <div className="space-y-1">
                  {items
                    .filter((item) => item.section === section)
                    .map((item) => navigationLink(item, collapsed))}
                </div>
              </section>
            ),
          )}
        </nav>
        <div className="shrink-0 border-t border-border p-3">
          {!collapsed && (
            <p className="mb-2 break-words px-3 text-sm font-medium">
              {userName}
            </p>
          )}
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className={cn(
              "flex min-h-11 w-full items-center rounded-xl px-3 text-sm text-muted-foreground hover:bg-secondary",
              collapsed ? "justify-center" : "gap-3",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && "Cerrar sesión"}
          </button>
        </div>
      </aside>

      <nav
        aria-label="Navegación móvil"
        data-mobile-workspace-navigation
        hidden={keyboardOpen}
        className={cn(
          styles.mobileNavigation,
          "border-t border-border bg-card",
        )}
      >
        {primary.map((item) => {
          const Icon = icons[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={
                isWorkspaceDestinationActive(pathname, item)
                  ? "page"
                  : undefined
              }
              className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-primary"
            >
              <Icon className="size-5" aria-hidden="true" />
              {item.title}
            </Link>
          );
        })}
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Más herramientas"
            aria-current={moreActive ? "page" : undefined}
            className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            <Grid2X2 className="size-5" aria-hidden="true" />
            Más
          </button>
        </DialogTrigger>
      </nav>

      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border p-5 pr-12 text-left">
          <DialogTitle>Tu negocio</DialogTitle>
          <DialogDescription>
            Módulos y opciones de tu cuenta.
          </DialogDescription>
        </DialogHeader>
        <nav
          className="min-h-0 flex-1 overflow-y-auto p-4"
          aria-label="Todos los módulos"
        >
          {Array.from(new Set(items.map((item) => item.section))).map(
            (section) => (
              <section key={section} className="mb-4 last:mb-0">
                <h2 className="mb-2 px-3 text-xs font-medium text-muted-foreground">
                  {section}
                </h2>
                <div className="space-y-1">
                  {items
                    .filter((item) => item.section === section)
                    .map((item) => navigationLink(item))}
                </div>
              </section>
            ),
          )}
        </nav>
        <div className="shrink-0 border-t border-border px-5 py-3">
          <p className="break-words text-sm font-medium">{userName}</p>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
