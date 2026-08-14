"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, CheckCircle2, Clock3, Loader2, Megaphone, Pause, Play, Square, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
    appendCommaSeparatedValue,
    type AudiencePreview,
    type CampaignMessageType,
    type CampaignFormState,
    type CampaignRecord,
    type CampaignVariantFormState,
    DEFAULT_VARIANTS,
    EMPTY_FORM,
    formatDateTime,
    getStatusBadgeVariant,
    splitCommaSeparatedValues,
    toLocalDateTimeValue,
} from "@/components/settings/bulk-campaign-manager-shared";
import { BulkCampaignAudienceTab } from "@/components/settings/bulk-campaign-audience-tab";
import { BulkCampaignCampaignList } from "@/components/settings/bulk-campaign-campaign-list";
import { BulkCampaignMessageTab } from "@/components/settings/bulk-campaign-message-tab";
import { BulkCampaignScheduleTab } from "@/components/settings/bulk-campaign-schedule-tab";
import {
    formatBulkCampaignManualEntries,
    parseBulkCampaignManualEntries,
} from "@/lib/bulk-campaign-audience";
import { listTemplateVariableKeys, renderTemplateContent } from "@/lib/templates";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { operationInputValueToUtc } from "@/lib/operation-dates";

function normalizeCampaignTypeForForm(value: unknown): CampaignMessageType {
    return value === "image" || value === "document" || value === "template" ? value : "text";
}

function normalizeTemplateComponentsForForm(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function normalizeTemplateVariableValuesForForm(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, typeof entry === "string" ? entry : ""]),
    );
}

function mapCampaignToForm(campaign: CampaignRecord, timeZone?: string): CampaignFormState {
    return {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description || "",
        status: campaign.status,
        sourceType: campaign.sourceType === "meta" ? "meta" : "wuzapi",
        sourceId: campaign.sourceId || "",
        type: normalizeCampaignTypeForForm(campaign.type),
        mediaUrl: campaign.mediaUrl,
        mediaType: campaign.mediaType,
        mediaFileName: campaign.mediaFileName,
        ycloudTemplateName: campaign.ycloudTemplateName || "",
        ycloudTemplateLanguage: campaign.ycloudTemplateLanguage || "",
        ycloudTemplateComponents: normalizeTemplateComponentsForForm(campaign.ycloudTemplateComponents),
        ycloudTemplateVariableValues: normalizeTemplateVariableValuesForForm(campaign.ycloudTemplateVariableValues),
        batchSize: campaign.batchSize,
        batchDelayMinutes: campaign.batchDelayMinutes,
        randomDelayMinSeconds: campaign.randomDelayMinSeconds,
        randomDelayMaxSeconds: campaign.randomDelayMaxSeconds,
        scheduledStartAt: toLocalDateTimeValue(campaign.scheduledStartAt, timeZone),
        respectBusinessHours: campaign.respectBusinessHours,
        stopOnReply: campaign.stopOnReply,
        followUpCount: campaign.followUpCount,
        followUpDelayDays: campaign.followUpDelayDays,
        audienceMode: campaign.audienceFilters?.mode || "selected",
        audienceStatuses: campaign.audienceFilters?.statuses || [],
        audienceTags: (campaign.audienceFilters?.tags || []).join(", "),
        audienceQuery: campaign.audienceFilters?.query || "",
        audienceLimit: campaign.audienceFilters?.limit ? String(campaign.audienceFilters.limit) : "",
        audienceOnlyOpenYCloudWindow: campaign.audienceFilters?.onlyOpenYCloudWindow ?? (campaign.sourceType === "meta"),
        audienceLastInboundFrom: toLocalDateTimeValue(campaign.audienceFilters?.lastInboundFrom || null, timeZone),
        audienceLastInboundTo: toLocalDateTimeValue(campaign.audienceFilters?.lastInboundTo || null, timeZone),
        audienceSelectedContactIds: campaign.audienceFilters?.selectedContactIds || [],
        manualAudienceText: formatBulkCampaignManualEntries(campaign.audienceFilters?.manualEntries || []),
        totalRecipients: campaign.totalRecipients,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        repliedCount: campaign.repliedCount,
        skippedCount: campaign.skippedCount,
        variants: campaign.variants.length > 0
            ? campaign.variants.map((variant) => ({
                label: variant.label,
                content: variant.content,
                weight: variant.weight,
                isActive: variant.isActive,
            }))
            : DEFAULT_VARIANTS,
    };
}

export function BulkCampaignManagerPanel() {
    const operationContext = useOperationContext();
    const { toast } = useToast();
    const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isImportingCsv, setIsImportingCsv] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [form, setForm] = useState<CampaignFormState>(EMPTY_FORM);
    const [activeVariantIndex, setActiveVariantIndex] = useState(0);
    const [csvImportStatus, setCsvImportStatus] = useState("lead");
    const [csvImportTag, setCsvImportTag] = useState("");
    const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    const resetForm = useCallback(() => {
        setForm(EMPTY_FORM);
        setActiveVariantIndex(0);
        setAudiencePreview(null);
    }, []);

    const loadCampaigns = useCallback(async (preserveSelection = false) => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/bulk-campaigns", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudieron cargar las campañas");

            const nextCampaigns = (result.campaigns || []) as CampaignRecord[];
            setCampaigns(nextCampaigns);

            if (preserveSelection && form.id) {
                const refreshed = nextCampaigns.find((campaign) => campaign.id === form.id);
                if (refreshed) {
                    setForm(mapCampaignToForm(refreshed, operationContext.timeZone));
                }
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las campañas",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [form.id, operationContext.timeZone, toast]);

    useEffect(() => {
        void loadCampaigns(false);
    }, [loadCampaigns]);

    useEffect(() => {
        const interval = setInterval(() => {
            void loadCampaigns(false);
        }, 15_000);
        return () => clearInterval(interval);
    }, [loadCampaigns]);

    const filteredCampaigns = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return campaigns;
        return campaigns.filter((campaign) =>
            [campaign.name, campaign.description || "", campaign.status]
                .join(" ")
                .toLowerCase()
                .includes(query),
        );
    }, [campaigns, search]);

    const resolvedActiveVariantIndex = Math.min(activeVariantIndex, Math.max(form.variants.length - 1, 0));
    const activeVariant = form.variants[resolvedActiveVariantIndex] || DEFAULT_VARIANTS[0];
    const previewContent = useMemo(
        () =>
            renderTemplateContent(activeVariant?.content || "", {
                contact: {
                    name: "Karen",
                    company: "Zen Estates",
                    phone: operationContext.phoneExample,
                },
                agentName: "Joel",
            }),
        [activeVariant?.content, operationContext.phoneExample],
    );

    const detectedVariables = useMemo(() => {
        const keys = form.variants.flatMap((variant) => listTemplateVariableKeys(variant.content));
        return keys.filter((key, index) => keys.indexOf(key) === index);
    }, [form.variants]);

    const manualEntries = useMemo(
        () => parseBulkCampaignManualEntries(form.manualAudienceText, operationContext.phoneDefaultCountry),
        [form.manualAudienceText, operationContext.phoneDefaultCountry],
    );

    const audiencePayload = useMemo(() => ({
        mode: form.audienceMode,
        statuses: form.audienceStatuses,
        tags: splitCommaSeparatedValues(form.audienceTags),
        query: form.audienceQuery,
        limit: form.audienceLimit.trim() ? Number.parseInt(form.audienceLimit, 10) : null,
        sourceType: form.sourceType === "meta" && form.type !== "template" ? "meta" : "any",
        sourceId: form.sourceId.trim(),
        onlyOpenYCloudWindow: form.sourceType === "meta" && form.type !== "template" ? form.audienceOnlyOpenYCloudWindow : false,
        lastInboundFrom: form.audienceLastInboundFrom ? new Date(form.audienceLastInboundFrom).toISOString() : "",
        lastInboundTo: form.audienceLastInboundTo ? new Date(form.audienceLastInboundTo).toISOString() : "",
        selectedContactIds: form.audienceSelectedContactIds,
        manualEntries,
    }), [
        form.audienceMode,
        form.audienceLimit,
        form.audienceLastInboundFrom,
        form.audienceLastInboundTo,
        form.audienceOnlyOpenYCloudWindow,
        form.audienceQuery,
        form.audienceSelectedContactIds,
        form.audienceStatuses,
        form.audienceTags,
        form.type,
        form.sourceId,
        form.sourceType,
        manualEntries,
    ]);

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setIsPreviewLoading(true);
            try {
                const response = await fetch("/api/bulk-campaigns/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ audienceFilters: audiencePayload }),
                    signal: controller.signal,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "No se pudo cargar la vista previa de audiencia");
                setAudiencePreview(result.preview as AudiencePreview);
            } catch {
                if (!controller.signal.aborted) {
                    setAudiencePreview(null);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsPreviewLoading(false);
                }
            }
        }, 320);

        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [audiencePayload]);

    useEffect(() => {
        setActiveVariantIndex((current) =>
            Math.max(0, Math.min(current, Math.max(form.variants.length - 1, 0))),
        );
    }, [form.variants.length]);

    const updateVariant = useCallback((index: number, updater: (variant: CampaignVariantFormState) => CampaignVariantFormState) => {
        setForm((current) => ({
            ...current,
            variants: current.variants.map((variant, variantIndex) =>
                variantIndex === index ? updater(variant) : variant,
            ),
        }));
    }, []);

    const addVariant = () => {
        setForm((current) => ({
            ...current,
            variants: [
                ...current.variants,
                {
                    label: String.fromCharCode(65 + current.variants.length),
                    content: "",
                    weight: 1,
                    isActive: true,
                },
            ],
        }));
        setActiveVariantIndex(form.variants.length);
    };

    const removeVariant = (index: number) => {
        if (form.variants.length === 1) return;
        setForm((current) => ({
            ...current,
            variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
        }));
        setActiveVariantIndex((current) => Math.max(0, Math.min(current, form.variants.length - 2)));
    };

    const saveCampaign = async () => {
        setIsSaving(true);
        try {
            const payload = {
                name: form.name,
                description: form.description,
                sourceType: form.sourceType,
                sourceId: form.sourceId.trim() || null,
                type: form.type,
                mediaUrl: form.type === "text" || form.type === "template" ? null : form.mediaUrl,
                mediaType: form.type === "text" || form.type === "template" ? null : form.mediaType,
                mediaFileName: form.type === "text" || form.type === "template" ? null : form.mediaFileName,
                ycloudTemplateName: form.type === "template" ? form.ycloudTemplateName : null,
                ycloudTemplateLanguage: form.type === "template" ? form.ycloudTemplateLanguage : null,
                ycloudTemplateComponents: form.type === "template" ? form.ycloudTemplateComponents : null,
                ycloudTemplateVariableValues: form.type === "template" ? form.ycloudTemplateVariableValues : null,
                batchSize: form.batchSize,
                batchDelayMinutes: form.batchDelayMinutes,
                randomDelayMinSeconds: form.randomDelayMinSeconds,
                randomDelayMaxSeconds: form.randomDelayMaxSeconds,
                scheduledStartAt: form.scheduledStartAt ? operationInputValueToUtc(form.scheduledStartAt, operationContext.timeZone)?.toISOString() || null : null,
                respectBusinessHours: form.respectBusinessHours,
                stopOnReply: form.stopOnReply,
                followUpCount: form.followUpCount,
                followUpDelayDays: form.followUpDelayDays,
                audienceFilters: audiencePayload,
                variants: form.variants.map((variant, index) => ({
                    ...variant,
                    sortOrder: index,
                })),
            };

            const response = await fetch(form.id ? `/api/bulk-campaigns/${form.id}` : "/api/bulk-campaigns", {
                method: form.id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo guardar la campaña");

            const campaign = result.campaign as CampaignRecord;
            setForm(mapCampaignToForm(campaign, operationContext.timeZone));
            setCampaigns((current) => {
                const rest = current.filter((entry) => entry.id !== campaign.id);
                return [campaign, ...rest];
            });

            toast({
                title: form.id ? "Campaña actualizada" : "Campaña creada",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo guardar la campaña",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const runAction = async (action: "start" | "pause" | "resume" | "cancel") => {
        if (!form.id) {
            toast({
                title: "Guarda la campaña primero",
                description: "Necesitamos un borrador antes de ejecutarla.",
                variant: "destructive",
            });
            return;
        }

        setActionLoading(action);
        try {
            const response = await fetch(`/api/bulk-campaigns/${form.id}/control`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo ejecutar la acción");

            const campaign = result.campaign as CampaignRecord;
            setForm(mapCampaignToForm(campaign, operationContext.timeZone));
            setCampaigns((current) => {
                const rest = current.filter((entry) => entry.id !== campaign.id);
                return [campaign, ...rest];
            });
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo ejecutar la acción",
                variant: "destructive",
            });
        } finally {
            setActionLoading(null);
        }
    };

    const deleteCampaign = async (campaignId: string) => {
        if (!window.confirm("¿Eliminar esta campaña?")) return;

        try {
            const response = await fetch(`/api/bulk-campaigns/${campaignId}`, {
                method: "DELETE",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo eliminar la campaña");

            setCampaigns((current) => current.filter((campaign) => campaign.id !== campaignId));
            if (form.id === campaignId) {
                resetForm();
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo eliminar la campaña",
                variant: "destructive",
            });
        }
    };

    const handleMediaUpload = async (file: File) => {
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo subir el archivo");
            }

            setForm((current) => ({
                ...current,
                mediaUrl: result.url,
                mediaType: result.mimeType,
                mediaFileName: result.fileName,
                type: result.mediaCategory === "image" ? "image" : "document",
            }));
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo subir el archivo",
                variant: "destructive",
            });
        } finally {
            setIsUploading(false);
        }
    };

    const handleCsvImport = async (file: File) => {
        setIsImportingCsv(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("defaultStatus", csvImportStatus);
            formData.append("importTag", csvImportTag.trim());

            const response = await fetch("/api/bulk-campaigns/import-csv", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo importar el CSV");
            }

            setForm((current) => ({
                ...current,
                audienceStatuses: current.audienceStatuses.includes(csvImportStatus)
                    ? current.audienceStatuses
                    : [...current.audienceStatuses, csvImportStatus],
                audienceTags: csvImportTag.trim()
                    ? appendCommaSeparatedValue(current.audienceTags, csvImportTag.trim())
                    : current.audienceTags,
            }));
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo importar el CSV",
                variant: "destructive",
            });
        } finally {
            setIsImportingCsv(false);
        }
    };

    const totalPreviewRecipients = audiencePreview?.totals.finalRecipients || form.totalRecipients;
    const totalPlannedTouches = totalPreviewRecipients * (Math.max(0, form.followUpCount) + 1);
    const averageDelaySeconds = Math.round((form.randomDelayMinSeconds + form.randomDelayMaxSeconds) / 2);
    const messageIntervals = Math.max(totalPlannedTouches - 1, 0);
    const longPauseCount = form.batchSize > 0
        ? Math.max(Math.ceil(totalPlannedTouches / form.batchSize) - 1, 0)
        : 0;
    const estimatedDeliveryMinutes = Math.round(
        ((Math.max(messageIntervals - longPauseCount, 0) * averageDelaySeconds) +
            (longPauseCount * form.batchDelayMinutes * 60)) / 60,
    );
    const followUpWindowDays = Math.max(0, form.followUpCount * Math.max(1, form.followUpDelayDays));

    const filteredCampaignList = filteredCampaigns;

    return (
        <div className="grid gap-4 xl:grid-cols-[304px_minmax(0,1fr)]">
            <BulkCampaignCampaignList
                campaigns={filteredCampaignList}
                search={search}
                onSearchChange={setSearch}
                selectedCampaignId={form.id}
                onSelectCampaign={(campaign) => {
                    setForm(mapCampaignToForm(campaign, operationContext.timeZone));
                    setActiveVariantIndex(0);
                }}
                onCreateCampaign={resetForm}
                onRefreshCampaigns={() => { void loadCampaigns(false); }}
                isLoading={isLoading}
                form={form}
            />

            <div className="min-w-0 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.24)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span className="text-sm">Audiencia final</span>
                        </div>
                        <p className="mt-2 text-[1.35rem] font-semibold">{totalPreviewRecipients}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {totalPlannedTouches} toques planeados
                        </p>
                    </div>
                    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.24)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock3 className="h-4 w-4" />
                            <span className="text-sm">Delay aleatorio</span>
                        </div>
                        <p className="mt-2 text-[1.35rem] font-semibold">{form.randomDelayMinSeconds}-{form.randomDelayMaxSeconds}s</p>
                    </div>
                    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.24)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <CalendarClock className="h-4 w-4" />
                            <span className="text-sm">Inicio</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold leading-tight">
                            {form.scheduledStartAt ? formatDateTime(operationInputValueToUtc(form.scheduledStartAt, operationContext.timeZone)?.toISOString() || null, operationContext.locale, operationContext.timeZone) : "Inmediato"}
                        </p>
                    </div>
                    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.24)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <BarChart3 className="h-4 w-4" />
                            <span className="text-sm">Duración estimada</span>
                        </div>
                        <p className="mt-2 text-[1.35rem] font-semibold">{estimatedDeliveryMinutes}m</p>
                    </div>
                </div>

                <div className="min-w-0 rounded-xl border bg-card p-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)] sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <Megaphone className="h-5 w-5 text-primary" />
                                <h2 className="text-lg font-semibold">Constructor de campaña</h2>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Define contenido, audiencia y cadencia desde la misma pantalla.
                            </p>
                        </div>

                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                            <Badge variant={getStatusBadgeVariant(form.status)} className="w-fit capitalize">
                                {form.status}
                            </Badge>
                            <Button onClick={saveCampaign} disabled={isSaving} className="w-full sm:w-auto">
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Guardar cambios
                            </Button>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {(form.status === "draft" || form.status === "completed" || form.status === "cancelled" || form.status === "failed") && (
                            <Button onClick={() => void runAction("start")} disabled={actionLoading !== null} className="w-full sm:w-auto">
                                {actionLoading === "start" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                {form.scheduledStartAt ? "Programar campaña" : "Iniciar campaña"}
                            </Button>
                        )}
                        {form.status === "running" && (
                            <Button variant="outline" onClick={() => void runAction("pause")} disabled={actionLoading !== null} className="w-full sm:w-auto">
                                {actionLoading === "pause" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
                                Pausar
                            </Button>
                        )}
                        {form.status === "paused" && (
                            <Button variant="outline" onClick={() => void runAction("resume")} disabled={actionLoading !== null} className="w-full sm:w-auto">
                                {actionLoading === "resume" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                Reanudar
                            </Button>
                        )}
                        {(form.status === "running" || form.status === "paused") && (
                            <Button variant="destructive" onClick={() => void runAction("cancel")} disabled={actionLoading !== null} className="w-full sm:w-auto">
                                {actionLoading === "cancel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                                Cancelar
                            </Button>
                        )}
                        {form.id && (
                            <Button variant="ghost" className="w-full text-destructive hover:text-destructive sm:w-auto" onClick={() => void deleteCampaign(form.id!)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                            </Button>
                        )}
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                        <div className="space-y-2">
                            <Label>Nombre de la acción</Label>
                            <Input
                                value={form.name}
                                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                                placeholder="PROMO REACTIVACIÓN 27/03"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Número / canal de salida</Label>
                            <Select
                                value={form.sourceType}
                                onValueChange={(value: CampaignFormState["sourceType"]) =>
                                    setForm((current) => ({
                                        ...current,
                                        sourceType: value,
                                        sourceId: "",
                                        type: value === "wuzapi" && current.type === "template" ? "text" : current.type,
                                        mediaUrl: value === "wuzapi" && current.type === "template" ? null : current.mediaUrl,
                                        mediaType: value === "wuzapi" && current.type === "template" ? null : current.mediaType,
                                        mediaFileName: value === "wuzapi" && current.type === "template" ? null : current.mediaFileName,
                                        ycloudTemplateName: value === "wuzapi" ? "" : current.ycloudTemplateName,
                                        ycloudTemplateLanguage: value === "wuzapi" ? "" : current.ycloudTemplateLanguage,
                                        ycloudTemplateComponents: value === "wuzapi" ? [] : current.ycloudTemplateComponents,
                                        ycloudTemplateVariableValues: value === "wuzapi" ? {} : current.ycloudTemplateVariableValues,
                                        audienceOnlyOpenYCloudWindow: value === "meta" && current.type !== "template"
                                            ? true
                                            : current.audienceOnlyOpenYCloudWindow,
                                        audienceMode: value === "meta" && current.type !== "template" ? "filters" : current.audienceMode,
                                        followUpCount: value === "meta" ? 0 : current.followUpCount,
                                    }))
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Selecciona canal" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="wuzapi">WhatsApp por QR</SelectItem>
                                    <SelectItem value="meta">WhatsApp API oficial</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {form.sourceType === "meta"
                                    ? "WhatsApp API solo enviara mensajes libres a ventanas abiertas; fuera de ventana usa una plantilla aprobada."
                                    : "WhatsApp por QR mantiene el envio masivo actual sin regla de ventana 24h."}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo de envío</Label>
                            <Select
                                value={form.type}
                                onValueChange={(value: CampaignFormState["type"]) =>
                                    setForm((current) => ({
                                        ...current,
                                        type: value,
                                        sourceType: value === "template" ? "meta" : current.sourceType,
                                        mediaUrl: value === "text" || value === "template" ? null : current.mediaUrl,
                                        mediaType: value === "text" || value === "template" ? null : current.mediaType,
                                        mediaFileName: value === "text" || value === "template" ? null : current.mediaFileName,
                                        ycloudTemplateName: value === "template" ? current.ycloudTemplateName : "",
                                        ycloudTemplateLanguage: value === "template" ? current.ycloudTemplateLanguage : "",
                                        ycloudTemplateComponents: value === "template" ? current.ycloudTemplateComponents : [],
                                        ycloudTemplateVariableValues: value === "template" ? current.ycloudTemplateVariableValues : {},
                                        audienceOnlyOpenYCloudWindow: value === "template"
                                            ? false
                                            : current.sourceType === "meta"
                                                ? true
                                                : current.audienceOnlyOpenYCloudWindow,
                                        followUpCount: value === "template" || current.sourceType === "meta" ? 0 : current.followUpCount,
                                    }))
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Selecciona un tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Solo texto</SelectItem>
                                    <SelectItem value="image">Imagen + caption</SelectItem>
                                    <SelectItem value="document">Documento + caption</SelectItem>
                                    <SelectItem value="template">Plantilla Meta</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="mt-5 space-y-6 min-w-0">
                        <section className="space-y-3 min-w-0">
                            <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/15 px-4 py-2.5">
                                <p className="text-sm font-semibold">1) Mensaje</p>
                                <span className="text-xs text-muted-foreground">Variantes y vista previa</span>
                            </div>
                            <BulkCampaignMessageTab
                                form={form}
                                activeVariantIndex={resolvedActiveVariantIndex}
                                onActiveVariantIndexChange={setActiveVariantIndex}
                                activeVariant={activeVariant}
                                previewContent={previewContent}
                                detectedVariables={detectedVariables}
                                isUploading={isUploading}
                                onMediaUpload={handleMediaUpload}
                                onFormChange={(updater) => setForm(updater)}
                                onVariantChange={updateVariant}
                                onAddVariant={addVariant}
                                onRemoveVariant={removeVariant}
                            />
                        </section>

                        <section className="space-y-3 min-w-0">
                            <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/15 px-4 py-2.5">
                                <p className="text-sm font-semibold">2) Audiencia</p>
                                <span className="text-xs text-muted-foreground">Filtros, selección y CSV</span>
                            </div>
                            <BulkCampaignAudienceTab
                                form={form}
                                audiencePreview={audiencePreview}
                                isPreviewLoading={isPreviewLoading}
                                manualEntryCount={manualEntries.length}
                                csvImportStatus={csvImportStatus}
                                csvImportTag={csvImportTag}
                                isImportingCsv={isImportingCsv}
                                onFormChange={(updater) => setForm(updater)}
                                onContactToggle={(contactId, checked) =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceSelectedContactIds: checked
                                            ? Array.from(new Set([...current.audienceSelectedContactIds, contactId]))
                                            : current.audienceSelectedContactIds.filter((id) => id !== contactId),
                                    }))
                                }
                                onSelectVisibleCandidates={() =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceSelectedContactIds: Array.from(new Set([
                                            ...current.audienceSelectedContactIds,
                                            ...(audiencePreview?.candidates.map((contact) => contact.id) || []),
                                        ])),
                                    }))
                                }
                                onClearSelectedContacts={() =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceSelectedContactIds: [],
                                    }))
                                }
                                onCsvImportStatusChange={setCsvImportStatus}
                                onCsvImportTagChange={setCsvImportTag}
                                onCsvImport={handleCsvImport}
                            />
                        </section>

                        <section className="space-y-3 min-w-0">
                            <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/15 px-4 py-2.5">
                                <p className="text-sm font-semibold">3) Programación</p>
                                <span className="text-xs text-muted-foreground">Cadencia, horarios y guardarrailes</span>
                            </div>
                            <BulkCampaignScheduleTab
                                form={form}
                                totalPreviewRecipients={totalPreviewRecipients}
                                totalPlannedTouches={totalPlannedTouches}
                                estimatedDeliveryMinutes={estimatedDeliveryMinutes}
                                followUpWindowDays={followUpWindowDays}
                                onFormChange={(updater) => setForm(updater)}
                            />
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
