"use client";

import { Loader2, Plus, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    type CampaignFormState,
    type CampaignRecord,
    getStatusBadgeVariant,
} from "@/components/settings/bulk-campaign-manager-shared";

type BulkCampaignCampaignListProps = {
    campaigns: CampaignRecord[];
    search: string;
    onSearchChange: (value: string) => void;
    selectedCampaignId: string | null;
    onSelectCampaign: (campaign: CampaignRecord) => void;
    onCreateCampaign: () => void;
    onRefreshCampaigns: () => void;
    isLoading: boolean;
    form: CampaignFormState;
};

export function BulkCampaignCampaignList({
    campaigns,
    search,
    onSearchChange,
    selectedCampaignId,
    onSelectCampaign,
    onCreateCampaign,
    onRefreshCampaigns,
    isLoading,
    form,
}: BulkCampaignCampaignListProps) {
    return (
        <div className="space-y-4 rounded-xl border bg-card p-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                    <h2 className="text-base font-semibold leading-tight">Suite de envios masivos</h2>
                    <p className="text-sm leading-5 text-muted-foreground">
                        Campanas con audiencia visible, goteo y programacion.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={onCreateCampaign} className="h-9 w-full shrink-0 rounded-xl px-3.5 sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva
                </Button>
            </div>

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="Buscar campaña..."
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    className="pl-9"
                />
            </div>

            <Button variant="ghost" className="h-9 w-full justify-start rounded-xl" onClick={onRefreshCampaigns}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refrescar campañas
            </Button>

            <div className="space-y-3">
                {isLoading ? (
                    <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                        Cargando campañas...
                    </div>
                ) : campaigns.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                        {search ? "No encontramos campañas con ese texto." : "Todavia no hay campañas creadas."}
                    </div>
                ) : (
                    campaigns.map((campaign) => {
                        const progressBase = Math.max(campaign.totalRecipients * (Math.max(0, campaign.followUpCount) + 1), 1);
                        const processedTouches = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
                        const progress = Math.min(
                            100,
                            Math.round((processedTouches / progressBase) * 100),
                        );

                        return (
                            <button
                                key={campaign.id}
                                type="button"
                                onClick={() => onSelectCampaign(campaign)}
                                className={cn(
                                    "w-full rounded-xl border px-3.5 py-3.5 text-left transition-all",
                                    selectedCampaignId === campaign.id
                                        ? "border-primary/45 bg-primary/5 shadow-[0_20px_42px_-36px_rgba(37,99,235,0.5)]"
                                        : "hover:border-border/80 hover:bg-muted/25",
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{campaign.name}</p>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                            {campaign.description || "Sin descripcion"}
                                        </p>
                                    </div>
                                    <Badge variant={getStatusBadgeVariant(campaign.status)} className="capitalize">
                                        {campaign.status}
                                    </Badge>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                    <div className="rounded-xl border bg-background/70 px-3 py-2">
                                        <p className="font-medium text-foreground">{campaign.totalRecipients}</p>
                                        <p>Destinatarios</p>
                                    </div>
                                    <div className="rounded-xl border bg-background/70 px-3 py-2">
                                        <p className="font-medium text-foreground">{processedTouches}/{progressBase}</p>
                                        <p>Toques</p>
                                    </div>
                                </div>

                                <div className="mt-3 space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                        <span>Progreso</span>
                                        <span>{progress}%</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-muted/65">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5">
                <p className="text-sm font-medium">Borrador activo</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {form.name || "Nueva campaña sin nombre"}
                </p>
            </div>
        </div>
    );
}
