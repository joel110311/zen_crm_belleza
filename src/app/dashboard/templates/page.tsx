"use client";

import { useMemo, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutTemplate, Loader2, Megaphone, ShieldAlert, MessageSquare, ReceiptText } from "lucide-react";
import { QuoteBuilderPanel } from "@/components/quotes/quote-builder-panel";
import { BulkCampaignManagerPanel } from "@/components/settings/bulk-campaign-manager-panel";
import { TemplateManagerPanel } from "@/components/settings/template-manager-panel";
import { MetaTemplateRequestPanel } from "@/components/templates/ycloud-template-request-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

const TEMPLATE_TAB_ITEMS: Array<{
    value: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    permission: PermissionKey;
}> = [
    { value: "templates", label: "Respuestas guardadas", icon: LayoutTemplate, permission: "templates.manage" },
    { value: "meta", label: "Plantillas WhatsApp API", icon: MessageSquare, permission: "templates.manage" },
    { value: "campaigns", label: "Envios masivos", icon: Megaphone, permission: "campaigns.manage" },
    { value: "quotes", label: "Cotizaciones", icon: ReceiptText, permission: "templates.manage" },
];

const TEMPLATE_TABS = new Set(TEMPLATE_TAB_ITEMS.map((tab) => tab.value));

export default function TemplatesPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { data: session, status } = useSession();
    const sessionUser = session?.user as { role?: string; permissions?: unknown } | undefined;
    const visibleTabs = TEMPLATE_TAB_ITEMS.filter((tab) => hasPermission(sessionUser, tab.permission));
    const hasTemplateAccess = visibleTabs.length > 0;
    const currentUserName = session?.user?.name || "";
    const requestedTab = searchParams.get("tab") || "templates";
    const fallbackTab = visibleTabs[0]?.value || "templates";
    const activeTab = TEMPLATE_TABS.has(requestedTab) && visibleTabs.some((tab) => tab.value === requestedTab)
        ? requestedTab
        : fallbackTab;
    const quoteInitialContact = useMemo(() => ({
        name: searchParams.get("contactName") || "",
        phone: searchParams.get("phone") || "",
        company: searchParams.get("company") || "",
    }), [searchParams]);

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", value);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    if (status === "loading") {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando plantillas...
                </div>
            </div>
        );
    }

    if (!hasTemplateAccess) {
        return (
            <div className="mx-auto max-w-3xl space-y-5">
                <div className="rounded-xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                    <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight">
                        <LayoutTemplate className="h-6 w-6 text-primary" />
                        Plantillas
                    </h1>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        Modulo de respuestas guardadas del CRM.
                    </p>
                </div>

                <div className="rounded-xl border bg-card p-7 text-center shadow-[0_12px_28px_-22px_rgba(15,23,42,0.22)]">
                    <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
                    <h2 className="mt-4 text-lg font-semibold">Acceso restringido</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Tu rol no tiene permisos para gestionar plantillas, campañas o cotizaciones.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-none space-y-4">
            <div className="rounded-xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                <h1 className="flex items-center gap-2.5 text-[1.85rem] font-semibold tracking-tight">
                    <LayoutTemplate className="h-6 w-6 text-primary" />
                    Plantillas
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Administra respuestas guardadas y campañas de envios masivos desde un mismo lugar.
                </p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                <TabsList className="grid h-auto w-full max-w-[64rem] grid-cols-2 gap-2 rounded-2xl border bg-card p-1.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.22)] md:grid-cols-4">
                    {visibleTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <TabsTrigger key={tab.value} value={tab.value} className="min-w-0 h-10 gap-1.5 rounded-xl border border-transparent bg-background px-3 text-[13px] font-semibold text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">
                                <Icon className="hidden h-4 w-4 sm:block" />
                                <span className="truncate">{tab.label}</span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>

                {hasPermission(sessionUser, "templates.manage") ? (
                    <>
                        <TabsContent value="templates" className="mt-0">
                            <TemplateManagerPanel />
                        </TabsContent>

                        <TabsContent value="meta" className="mt-0">
                            <MetaTemplateRequestPanel />
                        </TabsContent>

                        <TabsContent value="quotes" className="mt-0">
                            <QuoteBuilderPanel
                                key={`${quoteInitialContact.name}-${quoteInitialContact.phone}-${quoteInitialContact.company}`}
                                initialContact={quoteInitialContact}
                                agentName={currentUserName}
                            />
                        </TabsContent>
                    </>
                ) : null}

                {hasPermission(sessionUser, "campaigns.manage") ? (
                    <TabsContent value="campaigns" className="mt-0">
                        <BulkCampaignManagerPanel />
                    </TabsContent>
                ) : null}
            </Tabs>
        </div>
    );
}
