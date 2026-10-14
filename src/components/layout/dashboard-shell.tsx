"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission, type AccessSubject } from "@/lib/permissions";
import {
  tenantDashboardPath,
  tenantSlugFromPath,
} from "@/lib/tenant-request-routing";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import {
  TrialExpiryBanner,
  type TrialNotice,
} from "@/components/billing/trial-expiry-banner";
import { ExpiredWorkspaceNotice } from "@/components/billing/expired-workspace-notice";
import type { ExpiredWorkspaceNotice as ExpiryNotice } from "@/lib/billing/workspace-access";
import styles from "./workspace.module.css";
import { WorkspaceAccessContext } from "./workspace-access-context";

export function DashboardShell({
  children,
  trialNotice,
  expiryNotice,
  readOnly = Boolean(expiryNotice),
}: {
  children: React.ReactNode;
  trialNotice?: TrialNotice | null;
  expiryNotice?: ExpiryNotice | null;
  readOnly?: boolean;
}) {
  const pathname = usePathname();
  const workspacePath = pathname.replace(/^\/t\/[^/]+/, "/dashboard");
  const isHome =
    workspacePath === "/dashboard" || workspacePath === "/dashboard/dashboard";
  const tenantSlug = tenantSlugFromPath(pathname);
  const { data: session } = useSession();
  const canCreate =
    !readOnly &&
    Boolean(session?.user) &&
    hasPermission(
      session?.user as AccessSubject | undefined,
      "calendar.manage",
    );
  const newAppointmentHref = `${tenantSlug ? tenantDashboardPath(tenantSlug, "/dashboard/calendar") : "/dashboard/calendar"}?new=1`;
  const isInbox = workspacePath === "/dashboard/inbox";
  const isCalendar = workspacePath === "/dashboard/calendar";
  const isClients = workspacePath.startsWith("/dashboard/contacts");
  const isServices = workspacePath.startsWith("/dashboard/services");
  const hidesGlobalHeader = isInbox || isCalendar || isClients || isServices;

  return (
    <WorkspaceAccessContext.Provider value={{ readOnly }}>
      <div
        data-workspace-body
        className={cn(
          styles.body,
          "flex min-w-0 flex-1 flex-col overflow-hidden bg-background",
        )}
      >
        {!hidesGlobalHeader && <Header />}
        {trialNotice ? <TrialExpiryBanner notice={trialNotice} /> : null}
        {expiryNotice ? (
          <ExpiredWorkspaceNotice
            key={`${expiryNotice.expiredAt}:${expiryNotice.phase}`}
            notice={expiryNotice}
          />
        ) : null}
        <main
          className={cn(
            styles.main,
            (isInbox || isCalendar || isClients || isServices) && styles.fixedMain,
            isHome ? styles.homeContent : "",
            !isHome &&
              (isInbox
                ? "p-0"
                : isCalendar || isClients || isServices
                  ? "overflow-hidden px-3 pb-3 pt-3 md:px-5 md:pb-4 md:pt-4 lg:px-6"
                  : "px-3.5 pb-5 pt-3 md:px-5 md:pb-6 md:pt-3.5 lg:px-6 xl:px-7"),
          )}
        >
          {children}
        </main>
        {isHome && (canCreate || expiryNotice?.canManage) ? (
          <div className={styles.homeAction} data-home-action>
            <Button asChild className="min-h-11 w-full rounded-xl">
              <Link
                href={
                  expiryNotice
                    ? `/billing/${encodeURIComponent(expiryNotice.tenantSlug)}`
                    : newAppointmentHref
                }
              >
                {!expiryNotice && (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                {expiryNotice ? "Seleccionar un plan" : "Nueva cita"}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </WorkspaceAccessContext.Provider>
  );
}
