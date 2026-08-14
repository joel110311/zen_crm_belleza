"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileImage, FileText, Loader2, Plus, RefreshCw, Trash2, Upload, WandSparkles } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppTemplatePreview } from "@/components/templates/whatsapp-template-preview";
import { getSafeMediaUrl } from "@/lib/media-url";
import { renderTemplateContent, TEMPLATE_VARIABLES } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { useOperationContext } from "@/components/shared/use-operation-context";
import type {
    CampaignFormState,
    CampaignVariantFormState,
    YCloudCampaignTemplateComponent,
} from "@/components/settings/bulk-campaign-manager-shared";

type YCloudTemplateListItem = {
    id: string;
    name: string;
    language: string;
    status: string;
    category: string;
    components: YCloudCampaignTemplateComponent[];
};

type YCloudTemplateVariableSlot = {
    key: string;
    componentType: "HEADER" | "BODY";
    variableIndex: string;
    label: string;
};

const YCloudTemplateValueDefaults = ["{{nombre}}", "{{empresa}}", "{{agente}}", "{{telefono}}"];
type TemplatePreviewContext = Parameters<typeof renderTemplateContent>[1];

function normalizeYCloudTemplateItem(value: unknown): YCloudTemplateListItem | null {
    if (!value || typeof value !== "object") return null;

    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) return null;

    const rawLanguage = record.language;
    const language = typeof rawLanguage === "string"
        ? rawLanguage.trim()
        : rawLanguage && typeof rawLanguage === "object" && typeof (rawLanguage as Record<string, unknown>).code === "string"
            ? String((rawLanguage as Record<string, unknown>).code).trim()
            : "es";

    return {
        id: `${name}:${language || "es"}`,
        name,
        language: language || "es",
        status: typeof record.status === "string" ? record.status : "",
        category: typeof record.category === "string" ? record.category : "",
        components: Array.isArray(record.components)
            ? record.components.filter((component): component is YCloudCampaignTemplateComponent =>
                Boolean(component) && typeof component === "object",
            )
            : [],
    };
}

function isApprovedYCloudTemplate(template: YCloudTemplateListItem) {
    const status = template.status.trim().toUpperCase();
    return !status || status === "APPROVED" || status === "APROBADA";
}

function extractYCloudNumericVariables(text: string) {
    const variables: string[] = [];
    const matches = text.matchAll(/{{\s*(\d+)\s*}}/g);

    for (const match of matches) {
        const key = match[1];
        if (key && !variables.includes(key)) {
            variables.push(key);
        }
    }

    return variables;
}

function getYCloudTemplateVariableKey(componentType: string, variableIndex: string) {
    return `${componentType.toUpperCase()}:${variableIndex}`;
}

function listYCloudTemplateVariableSlots(components: YCloudCampaignTemplateComponent[]) {
    return components.flatMap((component) => {
        const componentType = component.type.toUpperCase();
        const text = component.text || "";

        if ((componentType !== "HEADER" && componentType !== "BODY") || !text) {
            return [];
        }

        return extractYCloudNumericVariables(text).map((variableIndex) => ({
            key: getYCloudTemplateVariableKey(componentType, variableIndex),
            componentType: componentType as "HEADER" | "BODY",
            variableIndex,
            label: `${componentType === "HEADER" ? "Header" : "Cuerpo"} {{${variableIndex}}}`,
        }));
    });
}

function getYCloudTemplateComponentText(components: YCloudCampaignTemplateComponent[], type: string) {
    return components.find((component) => component.type.toUpperCase() === type.toUpperCase())?.text || "";
}

function renderYCloudTemplateText(
    components: YCloudCampaignTemplateComponent[],
    variableValues: Record<string, string>,
    previewContext: TemplatePreviewContext,
) {
    const renderComponent = (componentType: "HEADER" | "BODY" | "FOOTER") => {
        const source = getYCloudTemplateComponentText(components, componentType);
        return source.replace(/{{\s*(\d+)\s*}}/g, (_match, variableIndex: string) => {
            const value = variableValues[getYCloudTemplateVariableKey(componentType, variableIndex)]
                || variableValues[variableIndex]
                || `{{${variableIndex}}}`;
            return renderTemplateContent(value, previewContext).trim() || `{{${variableIndex}}}`;
        }).trim();
    };

    return [
        renderComponent("HEADER"),
        renderComponent("BODY"),
        renderComponent("FOOTER"),
    ].filter(Boolean).join("\n\n");
}

function buildDefaultYCloudTemplateVariableValues(components: YCloudCampaignTemplateComponent[]) {
    return Object.fromEntries(
        listYCloudTemplateVariableSlots(components).map((slot, index) => [
            slot.key,
            YCloudTemplateValueDefaults[index] || "{{nombre}}",
        ]),
    );
}

type BulkCampaignMessageTabProps = {
    form: CampaignFormState;
    activeVariantIndex: number;
    onActiveVariantIndexChange: (index: number) => void;
    activeVariant: CampaignVariantFormState;
    previewContent: string;
    detectedVariables: string[];
    isUploading: boolean;
    onMediaUpload: (file: File) => Promise<void>;
    onFormChange: (updater: (current: CampaignFormState) => CampaignFormState) => void;
    onVariantChange: (
        index: number,
        updater: (variant: CampaignVariantFormState) => CampaignVariantFormState,
    ) => void;
    onAddVariant: () => void;
    onRemoveVariant: (index: number) => void;
};

export function BulkCampaignMessageTab({
    form,
    activeVariantIndex,
    onActiveVariantIndexChange,
    activeVariant,
    previewContent,
    detectedVariables,
    isUploading,
    onMediaUpload,
    onFormChange,
    onVariantChange,
    onAddVariant,
    onRemoveVariant,
}: BulkCampaignMessageTabProps) {
    const operationContext = useOperationContext();
    const variantLayoutRef = useRef<HTMLDivElement | null>(null);
    const [variantLayoutWidth, setVariantLayoutWidth] = useState(0);
    const [ycloudTemplates, setYCloudTemplates] = useState<YCloudTemplateListItem[]>([]);
    const [isLoadingYCloudTemplates, setIsLoadingYCloudTemplates] = useState(false);
    const [ycloudTemplatesError, setYCloudTemplatesError] = useState("");
    const previewMediaUrl = getSafeMediaUrl(form.mediaUrl);
    const useTwoColumnVariantFields = variantLayoutWidth >= 560;
    const useInlineActiveActions = variantLayoutWidth >= 460;
    const approvedYCloudTemplates = ycloudTemplates.filter(isApprovedYCloudTemplate);
    const selectedYCloudTemplate = approvedYCloudTemplates.find((template) =>
        template.name === form.ycloudTemplateName && template.language === form.ycloudTemplateLanguage,
    ) || null;
    const ycloudVariableSlots = listYCloudTemplateVariableSlots(form.ycloudTemplateComponents);
    const templatePreviewContext = useMemo<TemplatePreviewContext>(() => ({
        contact: {
            name: "Karen",
            company: "Zen Estates",
            phone: operationContext.phoneExample,
        },
        agentName: "Joel",
    }), [operationContext.phoneExample]);
    const ycloudPreviewContent = renderYCloudTemplateText(
        form.ycloudTemplateComponents,
        form.ycloudTemplateVariableValues,
        templatePreviewContext,
    );

    useEffect(() => {
        const node = variantLayoutRef.current;
        if (!node) {
            return;
        }

        const updateWidth = () => {
            setVariantLayoutWidth(node.getBoundingClientRect().width);
        };

        updateWidth();

        const observer = new ResizeObserver(() => {
            updateWidth();
        });

        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (form.type !== "template" || isLoadingYCloudTemplates || ycloudTemplates.length > 0) {
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setIsLoadingYCloudTemplates(true);
            setYCloudTemplatesError("");

            void fetch("/api/templates/meta?limit=100", { cache: "no-store", signal: controller.signal })
                .then(async (response) => {
                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || "No se pudieron cargar las plantillas de WhatsApp API.");
                    }

                    setYCloudTemplates(
                        (Array.isArray(result.items) ? result.items : [])
                            .map(normalizeYCloudTemplateItem)
                            .filter((template): template is YCloudTemplateListItem => Boolean(template)),
                    );
                })
                .catch((error) => {
                    if (!controller.signal.aborted) {
                        setYCloudTemplatesError(error instanceof Error ? error.message : "No se pudieron cargar las plantillas de WhatsApp API.");
                    }
                })
                .finally(() => {
                    if (!controller.signal.aborted) {
                        setIsLoadingYCloudTemplates(false);
                    }
                });
        }, 0);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [form.type, isLoadingYCloudTemplates, ycloudTemplates.length]);

    const refreshYCloudTemplates = () => {
        setYCloudTemplates([]);
        setYCloudTemplatesError("");
    };

    const applyYCloudTemplate = (templateId: string) => {
        const template = approvedYCloudTemplates.find((entry) => entry.id === templateId);
        if (!template) return;

        const variableValues = buildDefaultYCloudTemplateVariableValues(template.components);
        const content = renderYCloudTemplateText(template.components, variableValues, templatePreviewContext);

        onActiveVariantIndexChange(0);
        onFormChange((current) => ({
            ...current,
            sourceType: "meta",
            type: "template",
            mediaUrl: null,
            mediaType: null,
            mediaFileName: null,
            followUpCount: 0,
            audienceOnlyOpenYCloudWindow: false,
            ycloudTemplateName: template.name,
            ycloudTemplateLanguage: template.language,
            ycloudTemplateComponents: template.components,
            ycloudTemplateVariableValues: variableValues,
            variants: [
                {
                    label: "A",
                    content,
                    weight: 1,
                    isActive: true,
                },
            ],
        }));
    };

    const updateYCloudTemplateVariable = (slot: YCloudTemplateVariableSlot, value: string) => {
        onFormChange((current) => {
            const variableValues = {
                ...current.ycloudTemplateVariableValues,
                [slot.key]: value,
            };
            const content = renderYCloudTemplateText(current.ycloudTemplateComponents, variableValues, templatePreviewContext);

            return {
                ...current,
                ycloudTemplateVariableValues: variableValues,
                variants: [
                    {
                        ...(current.variants[0] || { label: "A", weight: 1, isActive: true }),
                        content,
                    },
                ],
            };
        });
    };

    if (form.type === "template") {
        return (
            <div className="space-y-4">
                <div className="rounded-xl border bg-muted/15 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-semibold">Plantilla Meta</p>
                            <p className="text-sm leading-6 text-muted-foreground">
                                Usa una plantilla aprobada por Meta para contactos sin ventana abierta. El envio se hara por WhatsApp Cloud API.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-xl bg-background"
                            onClick={refreshYCloudTemplates}
                            disabled={isLoadingYCloudTemplates}
                        >
                            {isLoadingYCloudTemplates ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Actualizar
                        </Button>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                        <div className="min-w-0 space-y-4">
                            <div className="space-y-2">
                                <Label>Plantilla aprobada</Label>
                                <Select
                                    value={selectedYCloudTemplate?.id || ""}
                                    onValueChange={applyYCloudTemplate}
                                    disabled={isLoadingYCloudTemplates || approvedYCloudTemplates.length === 0}
                                >
                                    <SelectTrigger className="h-11 rounded-xl bg-background">
                                        <SelectValue placeholder={isLoadingYCloudTemplates ? "Cargando plantillas..." : "Selecciona una plantilla"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {approvedYCloudTemplates.map((template) => (
                                            <SelectItem key={template.id} value={template.id}>
                                                {template.name} - {template.language}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {ycloudTemplatesError ? (
                                    <p className="text-sm text-destructive">{ycloudTemplatesError}</p>
                                ) : null}
                                {!isLoadingYCloudTemplates && approvedYCloudTemplates.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        No hay plantillas aprobadas disponibles en el WABA conectado.
                                    </p>
                                ) : null}
                            </div>

                            {form.ycloudTemplateName ? (
                                <div className="rounded-xl border bg-background/90 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <p className="font-medium">{form.ycloudTemplateName}</p>
                                            <p className="text-sm text-muted-foreground">
                                                Idioma {form.ycloudTemplateLanguage || "es"}
                                                {selectedYCloudTemplate?.category ? ` - ${selectedYCloudTemplate.category}` : ""}
                                            </p>
                                        </div>
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                            WhatsApp API
                                        </span>
                                    </div>

                                    {ycloudVariableSlots.length > 0 ? (
                                        <div className="mt-4 space-y-4">
                                            <div>
                                                <p className="text-sm font-semibold">Variables de Meta</p>
                                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                                    Cada campo alimenta una variable numerica de la plantilla. Puedes usar variables internas del CRM.
                                                </p>
                                            </div>

                                            {ycloudVariableSlots.map((slot) => (
                                                <div key={slot.key} className="space-y-2 rounded-xl border bg-muted/15 p-3">
                                                    <Label>{slot.label}</Label>
                                                    <Input
                                                        value={form.ycloudTemplateVariableValues[slot.key] || ""}
                                                        onChange={(event) => updateYCloudTemplateVariable(slot, event.target.value)}
                                                        placeholder="Ej. {{nombre}} o texto fijo"
                                                        className="h-10 rounded-xl bg-background"
                                                    />
                                                    <div className="flex flex-wrap gap-2">
                                                        {TEMPLATE_VARIABLES.map((variable) => (
                                                            <button
                                                                key={`${slot.key}-${variable.key}`}
                                                                type="button"
                                                                onClick={() => updateYCloudTemplateVariable(slot, variable.placeholder)}
                                                                className="rounded-full border bg-background px-2.5 py-1 text-xs font-semibold transition hover:border-primary hover:text-primary"
                                                            >
                                                                {variable.placeholder}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-4 rounded-xl border bg-muted/15 p-3 text-sm text-muted-foreground">
                                            Esta plantilla no tiene variables numericas que completar.
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
                                    Selecciona una plantilla aprobada para habilitar la vista previa y guardar la campaña.
                                </div>
                            )}
                        </div>

                        <div className="min-w-0 space-y-4">
                            <div className="min-w-0 rounded-xl border bg-background/80 p-4">
                                <div className="flex items-center gap-2">
                                    <WandSparkles className="h-4 w-4 text-primary" />
                                    <p className="text-sm font-semibold">Vista previa de WhatsApp</p>
                                </div>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                    Render aproximado con datos de ejemplo antes de disparar la plantilla.
                                </p>
                                <div className="mt-4">
                                    <WhatsAppTemplatePreview
                                        title={form.ycloudTemplateName || form.name || "Plantilla WhatsApp"}
                                        subtitle={form.ycloudTemplateLanguage || "Meta template"}
                                        type="text"
                                        content={ycloudPreviewContent || "Selecciona una plantilla para ver el contenido."}
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border bg-background/90 p-4 text-sm leading-6 text-muted-foreground">
                                <p className="font-medium text-foreground">Regla de envio</p>
                                <p className="mt-2">
                                    Esta modalidad no filtra por ventana abierta: sirve para reactivar o iniciar conversaciones con una plantilla aprobada.
                                </p>
                                <p className="mt-2">
                                    Para mandar texto libre por WhatsApp API, cambia el tipo a texto; la audiencia solo incluira ventanas abiertas.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Descripcion interna</Label>
                    <Textarea
                        value={form.description}
                        onChange={(event) => onFormChange((current) => ({ ...current, description: event.target.value }))}
                        placeholder="Para auditar esta ola, equipo responsable, objetivo, etc."
                        className="min-h-[90px]"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {form.type !== "text" ? (
                <div className="rounded-xl border bg-muted/15 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                            <p className="text-sm font-semibold">Adjunto compartido</p>
                            <p className="text-sm leading-6 text-muted-foreground">
                                La pieza va en todos los envios; las variantes cambian el caption.
                            </p>
                        </div>
                        <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border bg-background px-3.5 text-sm font-semibold transition-colors hover:bg-muted/40">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            Subir archivo
                            <input
                                type="file"
                                className="hidden"
                                accept={form.type === "image" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void onMediaUpload(file);
                                    event.currentTarget.value = "";
                                }}
                            />
                        </label>
                    </div>

                    <div className="mt-3 rounded-xl border bg-background/85 p-3">
                        {form.mediaUrl ? (
                            form.type === "image" ? (
                                previewMediaUrl ? (
                                    <img
                                        src={previewMediaUrl}
                                        alt={form.mediaFileName || "Campana"}
                                        className="max-h-56 rounded-2xl object-contain"
                                    />
                                ) : (
                                    <div className="flex h-44 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                                        <FileImage className="h-9 w-9" />
                                    </div>
                                )
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{form.mediaFileName || "Documento"}</p>
                                        <p className="text-xs text-muted-foreground">{form.mediaType || "application/octet-stream"}</p>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                                Esta campaña aun no tiene archivo adjunto.
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div ref={variantLayoutRef} className="min-w-0 space-y-4 rounded-xl border bg-muted/15 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                            <h3 className="text-base font-semibold leading-tight">Variaciones del mensaje</h3>
                            <p className="text-sm leading-6 text-muted-foreground">
                                Cada destinatario toma una variante activa para bajar la repeticion.
                            </p>
                        </div>
                        <Button variant="outline" onClick={onAddVariant} className="h-10 w-full rounded-xl bg-background px-4 text-sm font-semibold sm:w-auto">
                            <Plus className="mr-2 h-4 w-4" />
                            Agregar
                        </Button>
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                        {form.variants.map((variant, index) => (
                            <button
                                key={`${variant.label}-${index}`}
                                type="button"
                                onClick={() => onActiveVariantIndexChange(index)}
                                className={cn(
                                    "rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition",
                                    index === activeVariantIndex
                                        ? "border-primary/25 bg-primary text-primary-foreground shadow-[0_18px_35px_-24px_rgba(37,99,235,0.8)]"
                                        : "bg-background hover:border-primary/35 hover:text-foreground",
                                )}
                            >
                                Variante {variant.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-3.5 rounded-xl border bg-background/90 p-4">
                        <div className={cn("grid gap-3", useTwoColumnVariantFields ? "grid-cols-2" : "grid-cols-1")}>
                            <div className="space-y-2">
                                <Label htmlFor={`bulk-campaign-variant-label-${activeVariantIndex}`} className="block">
                                    Etiqueta
                                </Label>
                                <Input
                                    id={`bulk-campaign-variant-label-${activeVariantIndex}`}
                                    value={activeVariant.label}
                                    onChange={(event) =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            label: event.target.value,
                                        }))
                                    }
                                    placeholder="A"
                                    className="w-full"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={`bulk-campaign-variant-weight-${activeVariantIndex}`} className="block">
                                    Peso
                                </Label>
                                <Input
                                    id={`bulk-campaign-variant-weight-${activeVariantIndex}`}
                                    type="number"
                                    min={1}
                                    value={String(activeVariant.weight)}
                                    onChange={(event) =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            weight: Number.parseInt(event.target.value || "1", 10) || 1,
                                        }))
                                    }
                                    className="w-full"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="block">Activa</Label>
                            <div
                                className={cn(
                                    "rounded-lg border bg-muted/15 px-3 py-2",
                                    useInlineActiveActions
                                        ? "flex min-h-10 items-center justify-between gap-3"
                                        : "space-y-2",
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={activeVariant.isActive}
                                        onCheckedChange={(checked) =>
                                            onVariantChange(activeVariantIndex, (variant) => ({
                                                ...variant,
                                                isActive: checked,
                                            }))
                                        }
                                    />
                                    <span className="text-sm text-muted-foreground">Habilitada</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                        "h-8 rounded-md text-destructive hover:text-destructive",
                                        useInlineActiveActions ? "px-2" : "w-full justify-center px-2",
                                    )}
                                    onClick={() => onRemoveVariant(activeVariantIndex)}
                                    disabled={form.variants.length === 1}
                                >
                                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                                    Quitar
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Mensaje / caption</Label>
                            <Textarea
                                value={activeVariant.content}
                                onChange={(event) =>
                                    onVariantChange(activeVariantIndex, (variant) => ({
                                        ...variant,
                                        content: event.target.value,
                                    }))
                                }
                                placeholder={form.type === "text" ? "Escribe la variante del mensaje..." : "Caption opcional para esta variacion..."}
                                className="min-h-[170px]"
                            />
                        </div>
                    </div>

                    <div className="rounded-xl border bg-background/90 p-4">
                        <p className="font-medium">Variables disponibles</p>
                        <p className="text-sm leading-6 text-muted-foreground">
                            Se reemplazan con datos del contacto y del agente en el envio real.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {TEMPLATE_VARIABLES.map((variable) => (
                                <button
                                    key={variable.key}
                                    type="button"
                                    onClick={() =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            content: variant.content
                                                ? `${variant.content}${variant.content.endsWith(" ") ? "" : " "}${variable.placeholder}`
                                                : variable.placeholder,
                                        }))
                                    }
                                    className="rounded-xl border bg-background px-3 py-1.5 text-xs font-semibold transition hover:border-primary hover:text-primary"
                                >
                                    {variable.placeholder}
                                </button>
                            ))}
                        </div>
                        {detectedVariables.length > 0 ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                                Detectadas: {detectedVariables.map((key) => `{{${key}}}`).join(", ")}
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="min-w-0 space-y-4">
                    <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                        <div className="flex items-center gap-2">
                            <WandSparkles className="h-4 w-4 text-primary" />
                            <p className="text-sm font-semibold">Vista previa de WhatsApp</p>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Render con datos de ejemplo para validar tono, estructura y adjunto.
                        </p>
                        <div className="mt-4">
                            <WhatsAppTemplatePreview
                                title={form.name || "Campana masiva"}
                                subtitle={`Variante ${activeVariant.label || "A"}`}
                                type={form.type}
                                content={previewContent}
                                mediaUrl={previewMediaUrl}
                                mediaType={form.mediaType}
                                mediaFileName={form.mediaFileName}
                            />
                        </div>
                    </div>

                    <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                        <p className="font-medium">Estrategia aplicada</p>
                        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                            <div className="rounded-xl border bg-background/80 p-3 leading-6">
                                En cada mini-lote se enviaran <span className="font-semibold text-foreground">{form.batchSize}</span> mensajes,
                                cada uno con un delay aleatorio entre <span className="font-semibold text-foreground">{form.randomDelayMinSeconds}</span> y <span className="font-semibold text-foreground">{form.randomDelayMaxSeconds}</span> segundos.
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3 leading-6">
                                Despues del sublote, el motor esperara <span className="font-semibold text-foreground">{form.batchDelayMinutes}</span> minutos antes de volver a disparar.
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3 leading-6">
                                {form.followUpCount > 0
                                    ? `Si no responde, la campaña puede enviar hasta ${form.followUpCount} seguimientos adicionales por contacto.`
                                    : "Esta ola enviara un solo toque por contacto; no habra seguimientos extra."}
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3 leading-6">
                                {form.stopOnReply
                                    ? "Si el lead responde cualquier cosa, la secuencia de esa campaña se cierra. Si escribe algo como 'detener', tambien queda bloqueado de futuros masivos y pasa a Cerrado Perdido."
                                    : "Con respuestas neutrales la secuencia puede seguir activa. Si escribe 'detener' se bloquean futuros masivos, y si muestra interes el bot toma la conversacion para vender."}
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0 rounded-xl border bg-muted/15 p-4">
                        <p className="font-medium">Borrador</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border bg-background/80 p-3 text-sm">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tipo</p>
                                <p className="mt-2 font-medium">{form.type}</p>
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3 text-sm">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Variantes activas</p>
                                <p className="mt-2 font-medium">{form.variants.filter((variant) => variant.isActive).length}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Descripcion interna</Label>
                <Textarea
                    value={form.description}
                    onChange={(event) => onFormChange((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Para auditar esta ola, equipo responsable, objetivo, etc."
                    className="min-h-[90px]"
                />
            </div>
        </div>
    );
}
