"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { TrialExpiryBanner, type TrialNotice } from "@/components/billing/trial-expiry-banner";

export function DashboardShell({ children, trialNotice }: { children: React.ReactNode; trialNotice?: TrialNotice | null }) {
    const pathname = usePathname();
    const workspacePath = pathname.replace(/^\/t\/[^/]+/, "/dashboard");
    const isInbox = workspacePath === "/dashboard/inbox";
    const isCalendar = workspacePath === "/dashboard/calendar";
    const isClients = workspacePath.startsWith("/dashboard/contacts");
    const isServices = workspacePath.startsWith("/dashboard/services");
    const hidesGlobalHeader = isInbox || isCalendar || isClients || isServices;

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background pt-14 md:pt-0">
            {!hidesGlobalHeader && <Header />}
            {trialNotice ? <TrialExpiryBanner notice={trialNotice} /> : null}
            <main
                className={cn(
                    "min-h-0 flex-1 overflow-auto",
                    isInbox
                        ? "p-0"
                        : isCalendar || isClients || isServices
                            ? "overflow-hidden px-3 pb-3 pt-3 md:px-5 md:pb-4 md:pt-4 lg:px-6"
                        : "px-3.5 pb-5 pt-3 md:px-5 md:pb-6 md:pt-3.5 lg:px-6 xl:px-7",
                )}
            >
                {children}
            </main>
        </div>
    );
}
