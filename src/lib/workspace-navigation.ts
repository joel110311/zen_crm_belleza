import {
  hasPermission,
  type AccessSubject,
  type PermissionKey,
} from "./permissions.ts";
import { tenantDashboardPath } from "./tenant-request-routing.ts";

export type WorkspaceDestination = {
  title: string;
  href: string;
  icon:
    | "home"
    | "calendar"
    | "chat"
    | "clients"
    | "reception"
    | "templates"
    | "business"
    | "services"
    | "team"
    | "ai"
    | "settings"
    | "control"
    | "billing";
  section: string;
  permission?: PermissionKey;
  primary?: boolean;
  tenantOnly?: boolean;
  platformOnly?: boolean;
};

const destinations: WorkspaceDestination[] = [
  {
    title: "Hoy",
    href: "/dashboard",
    icon: "home",
    section: "Tu negocio",
    permission: "dashboard.view",
    primary: true,
  },
  {
    title: "Agenda",
    href: "/dashboard/calendar",
    icon: "calendar",
    section: "Tu negocio",
    permission: "calendar.manage",
    primary: true,
  },
  {
    title: "Chats",
    href: "/dashboard/inbox",
    icon: "chat",
    section: "Tu negocio",
    permission: "chats.manage",
    primary: true,
  },
  {
    title: "Clientes",
    href: "/dashboard/contacts",
    icon: "clients",
    section: "Tu negocio",
    permission: "contacts.manage",
    primary: true,
  },
  {
    title: "Recepción",
    href: "/dashboard/reception",
    icon: "reception",
    section: "Operación",
    permission: "reception.manage",
  },
  {
    title: "Plantillas",
    href: "/dashboard/templates",
    icon: "templates",
    section: "Operación",
    permission: "templates.manage",
  },
  {
    title: "Asistente IA",
    href: "/dashboard/brain",
    icon: "ai",
    section: "Automatización",
    permission: "ai.manage",
  },
  {
    title: "Mi negocio",
    href: "/dashboard/business",
    icon: "business",
    section: "Administración",
    permission: "settings.manage",
  },
  {
    title: "Servicios",
    href: "/dashboard/services",
    icon: "services",
    section: "Administración",
    permission: "services.manage",
  },
  {
    title: "Especialistas",
    href: "/dashboard/specialists",
    icon: "team",
    section: "Administración",
    permission: "specialists.manage",
    tenantOnly: true,
  },
  {
    title: "Configuración",
    href: "/dashboard/settings",
    icon: "settings",
    section: "Administración",
  },
  {
    title: "Centro de mando",
    href: "/control",
    icon: "control",
    section: "Administración",
    platformOnly: true,
  },
];

/** Presentation only: every destination still enforces its authorization on the server. */
export function getWorkspaceDestinations({
  subject,
  tenantSlug,
  isPlatformAdmin = false,
  loading = false,
  canManageBilling = false,
}: {
  subject?: AccessSubject;
  tenantSlug?: string | null;
  isPlatformAdmin?: boolean;
  loading?: boolean;
  canManageBilling?: boolean;
}): WorkspaceDestination[] {
  const visible = destinations
    .filter(
      (item) =>
        (!item.tenantOnly || Boolean(tenantSlug)) &&
        (!item.platformOnly || isPlatformAdmin) &&
        (!item.permission ||
          (!loading &&
            Boolean(subject) &&
            hasPermission(subject, item.permission))),
    )
    .map((item) => ({
      ...item,
      href:
        tenantSlug && item.href.startsWith("/dashboard")
          ? tenantDashboardPath(tenantSlug, item.href)
          : item.href,
    }));
  if (tenantSlug && canManageBilling)
    visible.push({
      title: "Plan y facturación",
      href: `/billing/${encodeURIComponent(tenantSlug)}`,
      icon: "billing",
      section: "Mi cuenta",
    });
  return visible;
}

export function isWorkspaceDestinationActive(
  pathname: string,
  destination: WorkspaceDestination,
) {
  return destination.icon === "home"
    ? pathname === destination.href
    : pathname === destination.href ||
        pathname.startsWith(`${destination.href}/`);
}
