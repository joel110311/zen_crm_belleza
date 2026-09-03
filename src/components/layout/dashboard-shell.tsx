"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ApplePageTransition } from "@/components/layout/apple-page-transition";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isInbox = pathname === "/dashboard/inbox";
    const isCalendar = pathname === "/dashboard/calendar";
    const isClients = pathname.startsWith("/dashboard/contacts");
    const isServices = pathname.startsWith("/dashboard/services");
    const hidesGlobalHeader = isInbox || isCalendar || isClients || isServices;

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background pt-14 md:pt-0">
            {!hidesGlobalHeader && <Header />}
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
                <ApplePageTransition>{children}</ApplePageTransition>
            </main>
        </div>
    );
}
