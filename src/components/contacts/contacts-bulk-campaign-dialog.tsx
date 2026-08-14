"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Megaphone, SlidersHorizontal, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/components/ui/use-toast";
import { TemplatePicker } from "@/components/inbox/template-picker";
import { WhatsAppTemplatePreview } from "@/components/templates/whatsapp-template-preview";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { getContactFullName } from "@/lib/contact-name";
import { formatDateInOperationZone } from "@/lib/operation-dates";
import { operationInputValueToUtc } from "@/lib/operation-dates";
import { renderTemplateContent, type TemplateRecord } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { YCloudCampaignTemplateComponent } from "@/components/settings/bulk-campaign-manager-shared";

type CampaignContact = {
    id: string;
    name?: string | null;
    lastName?: string | null;
    company?: string | null;
    phone?: string | null;
};

type QuickCampaignMessageType = "text" | "image" | "document" | "template";

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

type QuickCampaignFormState = {
    name: string;
    type: QuickCampaignMessageType;
    content: string;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    ycloudTemplateName: string;
    ycloudTemplateLanguage: string;
    ycloudTemplateComponents: YCloudCampaignTemplateComponent[];
    ycloudTemplateVariableValues: Record<string, string>;
    batchSize: number;
    batchDelayMinutes: number;
    randomDelayMinSeconds: number;
    randomDelayMaxSeconds: number;
    scheduledStartAt: string;
    respectBusinessHours: boolean;
    stopOnReply: boolean;
    followUpCount: number;
    followUpDelayDays: number;
    selectedTemplateId: string | null;
    selectedTemplateName: string;
    sourceType: "wuzapi" | "meta";
};

const YCloudTemplateValueDefaults = ["{{nombre}}", "{{empresa}}", "{{agente}}", "{{telefono}}"];

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
    previewContact: CampaignContact | null,
    fallbackPreviewPhone: string,
) {
    const context = {
        contact: previewContact
            ? {
                name: getContactFullName(previewContact, "Sin nombre"),
                company: previewContact.company || "",
                phone: previewContact.phone || "",
            }
            : {
                name: "Karen",
                company: "Zen Estates",
                phone: fallbackPreviewPhone,
            },
        agentName: "Equipo Zen CRM",
    };

    const renderComponent = (componentType: "HEADER" | "BODY" | "FOOTER") => {
        const source = getYCloudTemplateComponentText(components, componentType);
        return source.replace(/{{\s*(\d+)\s*}}/g, (_match, variableIndex: string) => {
            const value = variableValues[getYCloudTemplateVariableKey(componentType, variableIndex)]
                || variableValues[variableIndex]
                || `{{${variableIndex}}}`;
            return renderTemplateContent(value, context).trim() || `{{${variableIndex}}}`;
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

type ContactsBulkCampaignDialogProps = {
    contacts: CampaignContact[];
    onCreated: () => void;
};

const DEFAULT_QUICK_CAMPAIGN_FORM: QuickCampaignFormState = {
    name: "",
    type: "text",
    content: "",
    mediaUrl: null,
    mediaType: null,
    mediaFileName: null,
    ycloudTemplateName: "",
    ycloudTemplateLanguage: "",
    ycloudTemplateComponents: [],
    ycloudTemplateVariableValues: {},
    batchSize: 3,
    batchDelayMinutes: 5,
    randomDelayMinSeconds: 25,
    randomDelayMaxSeconds: 75,
    scheduledStartAt: "",
    respectBusinessHours: true,
    stopOnReply: true,
    followUpCount: 0,
    followUpDelayDays: 2,
    selectedTemplateId: null,
    selectedTemplateName: "",
    sourceType: "wuzapi",
};

function buildQuickCampaignName(count: number, locale?: string, timeZone?: string) {
    const stamp = formatDateInOperationZone(new Date(), locale || undefined, timeZone, {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
    });

    return `Envío rápido ${count} clientes - ${stamp}`;
}

export function ContactsBulkCampaignDialog({
    contacts,
    onCreated,
}: ContactsBulkCampaignDialogProps) {
    const operationContext = useOperationContext();
    const { toast } = useToast();
    const bodyLayoutRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [templates, setTemplates] = useState<TemplateRecord[]>([]);
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
    const [ycloudTemplates, setYCloudTemplates] = useState<YCloudTemplateListItem[]>([]);
    const [isLoadingYCloudTemplates, setIsLoadingYCloudTemplates] = useState(false);
    const [ycloudTemplatesError, setYCloudTemplatesError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [bodyLayoutWidth, setBodyLayoutWidth] = useState(0);
    const [form, setForm] = useState<QuickCampaignFormState>(DEFAULT_QUICK_CAMPAIGN_FORM);

    const previewContact = contacts[0] || null;
    const firstSelectedName = useMemo(
        () => (contacts[0] ? getContactFullName(contacts[0], "Sin nombre") : "Sin nombre"),
        [contacts],
    );
    const approvedYCloudTemplates = useMemo(
        () => ycloudTemplates.filter(isApprovedYCloudTemplate),
        [ycloudTemplates],
    );
    const selectedYCloudTemplate = useMemo(
        () => approvedYCloudTemplates.find((template) =>
            template.name === form.ycloudTemplateName && template.language === form.ycloudTemplateLanguage,
        ) || null,
        [approvedYCloudTemplates, form.ycloudTemplateLanguage, form.ycloudTemplateName],
    );
    const ycloudVariableSlots = useMemo(
        () => listYCloudTemplateVariableSlots(form.ycloudTemplateComponents),
        [form.ycloudTemplateComponents],
    );

    const previewContent = useMemo(
        () => {
            if (form.type === "template") {
                return renderYCloudTemplateText(
                    form.ycloudTemplateComponents,
                    form.ycloudTemplateVariableValues,
                    previewContact,
                    operationContext.phoneExample,
                );
            }

            return renderTemplateContent(form.content, {
                contact: previewContact
                    ? {
                        name: getContactFullName(previewContact, "Sin nombre"),
                        company: previewContact.company || "",
                        phone: previewContact.phone || "",
                    }
                    : null,
                agentName: "Equipo Zen CRM",
            });
        },
        [
            form.content,
            form.type,
            form.ycloudTemplateComponents,
            form.ycloudTemplateVariableValues,
            operationContext.phoneExample,
            previewContact,
        ],
    );

    const submitLabel = useMemo(() => {
        if (!form.scheduledStartAt) {
            return "Crear e iniciar";
        }

        const startDate = operationInputValueToUtc(form.scheduledStartAt, operationContext.timeZone);
        if (!startDate || Number.isNaN(startDate.getTime()) || startDate.getTime() <= Date.now()) {
            return "Crear e iniciar";
        }

        return "Programar envio";
    }, [form.scheduledStartAt, operationContext.timeZone]);

    const useTwoColumnBodyLayout = bodyLayoutWidth >= 980;
    const useTwoColumnFieldLayout = bodyLayoutWidth >= 760;

    useEffect(() => {
        if (!open) {
            setForm({
                ...DEFAULT_QUICK_CAMPAIGN_FORM,
                name: buildQuickCampaignName(contacts.length, operationContext.locale, operationContext.timeZone),
            });
            return;
        }

        if (templates.length > 0 || isLoadingTemplates) {
            return;
        }

        setIsLoadingTemplates(true);
        void fetch("/api/templates?activeOnly=true", { cache: "no-store" })
            .then(async (response) => {
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || "No se pudieron cargar las plantillas.");
                }

                setTemplates(result.templates || []);
            })
            .catch((error) => {
                toast({
                    title: "No se pudieron cargar las plantillas",
                    description: error instanceof Error ? error.message : "Intenta de nuevo.",
                    variant: "destructive",
                });
            })
            .finally(() => setIsLoadingTemplates(false));
    }, [contacts.length, isLoadingTemplates, open, operationContext.locale, templates.length, toast]);

    useEffect(() => {
        if (!open || form.type !== "template" || isLoadingYCloudTemplates || ycloudTemplates.length > 0) {
            return;
        }

        setIsLoadingYCloudTemplates(true);
        setYCloudTemplatesError("");

        void fetch("/api/templates/meta?limit=100", { cache: "no-store" })
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
                setYCloudTemplatesError(error instanceof Error ? error.message : "No se pudieron cargar las plantillas de WhatsApp API.");
            })
            .finally(() => setIsLoadingYCloudTemplates(false));
    }, [form.type, isLoadingYCloudTemplates, open, ycloudTemplates.length]);

    useEffect(() => {
        if (!open) {
            setBodyLayoutWidth(0);
            return;
        }

        const container = bodyLayoutRef.current;
        if (!container) {
            return;
        }

        const updateWidth = () => {
            setBodyLayoutWidth(container.getBoundingClientRect().width);
        };

        updateWidth();

        const observer = new ResizeObserver(() => {
            updateWidth();
        });

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [open]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setForm({
                ...DEFAULT_QUICK_CAMPAIGN_FORM,
                name: buildQuickCampaignName(contacts.length, operationContext.locale, operationContext.timeZone),
            });
        }
    };

    const handleTemplateApply = (template: TemplateRecord) => {
        setForm((current) => ({
            ...current,
            name:
                current.name.trim() && current.name !== buildQuickCampaignName(contacts.length, operationContext.locale, operationContext.timeZone)
                    ? current.name
                    : `${template.name} - envio rapido`,
            type: (template.type as "text" | "image" | "document") || "text",
            content: template.content || "",
            mediaUrl: template.mediaUrl,
            mediaType: template.mediaType,
            mediaFileName: template.mediaFileName,
            ycloudTemplateName: "",
            ycloudTemplateLanguage: "",
            ycloudTemplateComponents: [],
            ycloudTemplateVariableValues: {},
            selectedTemplateId: template.id,
            selectedTemplateName: template.name,
        }));
    };

    const applyYCloudTemplate = (templateId: string) => {
        const template = approvedYCloudTemplates.find((entry) => entry.id === templateId);
        if (!template) return;

        const variableValues = buildDefaultYCloudTemplateVariableValues(template.components);
        const content = renderYCloudTemplateText(template.components, variableValues, previewContact, operationContext.phoneExample);

        setForm((current) => ({
            ...current,
            sourceType: "meta",
            type: "template",
            content,
            mediaUrl: null,
            mediaType: null,
            mediaFileName: null,
            ycloudTemplateName: template.name,
            ycloudTemplateLanguage: template.language,
            ycloudTemplateComponents: template.components,
            ycloudTemplateVariableValues: variableValues,
            followUpCount: 0,
            selectedTemplateId: null,
            selectedTemplateName: template.name,
        }));
    };

    const updateYCloudTemplateVariable = (slot: YCloudTemplateVariableSlot, value: string) => {
        setForm((current) => {
            const variableValues = {
                ...current.ycloudTemplateVariableValues,
                [slot.key]: value,
            };

            return {
                ...current,
                ycloudTemplateVariableValues: variableValues,
                content: renderYCloudTemplateText(current.ycloudTemplateComponents, variableValues, previewContact, operationContext.phoneExample),
            };
        });
    };

    const handleSubmit = async () => {
        if (contacts.length === 0) {
            return;
        }

        if (!form.name.trim()) {
            toast({
                title: "Ponle un nombre al envio",
                description: "Nos ayuda a auditar y encontrar la campaña despues.",
                variant: "destructive",
            });
            return;
        }

        if (form.type === "template") {
            if (!form.ycloudTemplateName || !form.ycloudTemplateLanguage) {
                toast({
                    title: "Selecciona una plantilla aprobada por Meta",
                    description: "Para enviar fuera de ventana necesitamos una plantilla aprobada por Meta.",
                    variant: "destructive",
                });
                return;
            }

            const missingVariables = ycloudVariableSlots.filter((slot) => !form.ycloudTemplateVariableValues[slot.key]?.trim());
            if (missingVariables.length > 0) {
                toast({
                    title: "Completa las variables",
                    description: "Todas las variables numericas de la plantilla deben tener valor.",
                    variant: "destructive",
                });
                return;
            }
        }

        if (form.type === "text" && !form.content.trim()) {
            toast({
                title: "Falta el mensaje",
                description: "Escribe el contenido o carga una plantilla antes de continuar.",
                variant: "destructive",
            });
            return;
        }

        if (form.type !== "text" && form.type !== "template" && !form.mediaUrl) {
            toast({
                title: "Falta el adjunto",
                description: "Carga una plantilla con archivo antes de lanzar el envio.",
                variant: "destructive",
            });
            return;
        }

        if (form.randomDelayMaxSeconds < form.randomDelayMinSeconds) {
            toast({
                title: "Delays invalidos",
                description: "El delay maximo debe ser mayor o igual al minimo.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                name: form.name.trim(),
                description: `Envío rápido desde Clientes para ${contacts.length} destinatario(s).`,
                sourceType: form.sourceType,
                sourceId: null,
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
                followUpCount: form.type === "template" || form.sourceType === "meta" ? 0 : form.followUpCount,
                followUpDelayDays: form.followUpDelayDays,
                audienceFilters: {
                    mode: "selected",
                    statuses: [],
                    tags: [],
                    query: "",
                    limit: null,
                    sourceType: form.sourceType === "meta" && form.type !== "template" ? "meta" : "any",
                    sourceId: "",
                    onlyOpenYCloudWindow: form.sourceType === "meta" && form.type !== "template",
                    lastInboundFrom: "",
                    lastInboundTo: "",
                    selectedContactIds: contacts.map((contact) => contact.id),
                    manualEntries: [],
                },
                variants: [
                    {
                        label: "A",
                        content: form.type === "template" ? previewContent : form.content,
                        weight: 1,
                        sortOrder: 0,
                        isActive: true,
                    },
                ],
            };

            const createResponse = await fetch("/api/bulk-campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const createResult = await createResponse.json();

            if (!createResponse.ok) {
                throw new Error(createResult.error || "No se pudo crear la campaña.");
            }

            const campaignId = createResult.campaign?.id as string | undefined;
            if (!campaignId) {
                throw new Error("La campaña se creo sin un identificador valido.");
            }

            const controlResponse = await fetch(`/api/bulk-campaigns/${campaignId}/control`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
            });
            const controlResult = await controlResponse.json();

            if (!controlResponse.ok) {
                throw new Error(controlResult.error || "La campaña se creo, pero no se pudo iniciar.");
            }

            if (form.selectedTemplateId) {
                void fetch(`/api/templates/${form.selectedTemplateId}/use`, { method: "POST" });
            }

            const recipientCount = createResult.campaign?.totalRecipients ?? contacts.length;

            toast({
                title: submitLabel === "Programar envio" ? "Envio programado" : "Envio iniciado",
                description: `${recipientCount} cliente${recipientCount === 1 ? "" : "s"} quedaron dentro de la campaña.`,
            });

            handleOpenChange(false);
            onCreated();
        } catch (error) {
            toast({
                title: "No se pudo lanzar el envio",
                description: error instanceof Error ? error.message : "Intenta de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    className="h-10 rounded-xl px-4"
                    disabled={contacts.length === 0}
                >
                    <Megaphone className="mr-2 h-4 w-4" />
                    Envio masivo
                </Button>
            </DialogTrigger>

            <DialogContent className="flex max-h-[calc(100vh-1rem)] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden rounded-2xl border-border/70 p-0">
                <div className="border-b border-border/60 px-6 py-5">
                    <DialogHeader className="text-left">
                        <DialogTitle className="flex items-center gap-2">
                            <Megaphone className="h-5 w-5 text-primary" />
                            Envio masivo rapido
                        </DialogTitle>
                        <DialogDescription>
                            Crea una campaña sobre la selección actual sin salir de Clientes.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div
                    ref={bodyLayoutRef}
                    className={cn(
                        "min-h-0 flex-1 gap-0",
                        useTwoColumnBodyLayout
                            ? "grid overflow-hidden grid-cols-[minmax(0,1fr)_minmax(300px,360px)]"
                            : "flex flex-col overflow-y-auto",
                    )}
                >
                    <div className={cn("px-6 py-5", useTwoColumnBodyLayout ? "overflow-y-auto" : "")}>
                        <div className="space-y-5">
                            <div className="rounded-2xl border bg-muted/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">
                                            {contacts.length} cliente{contacts.length === 1 ? "" : "s"} seleccionado{contacts.length === 1 ? "" : "s"}
                                        </p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Ejemplo: {firstSelectedName}
                                            {contacts.length > 1 ? ` y ${contacts.length - 1} mas` : ""}
                                        </p>
                                    </div>
                                    <div className="flex w-full items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 sm:w-auto">
                                        <span className="text-sm font-medium text-foreground">Cargar plantilla</span>
                                        {isLoadingTemplates ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : (
                                            <TemplatePicker
                                                templates={templates}
                                                onApply={handleTemplateApply}
                                                disabled={isSubmitting}
                                            />
                                        )}
                                    </div>
                                </div>
                                {form.selectedTemplateName ? (
                                    <p className="mt-3 text-sm text-muted-foreground">
                                        Base actual: <span className="font-medium text-foreground">{form.selectedTemplateName}</span>
                                    </p>
                                ) : null}
                            </div>

                            <div className={cn("grid gap-4", useTwoColumnFieldLayout && "grid-cols-2")}>
                                <div className="space-y-2">
                                    <Label htmlFor="bulk-contacts-name">Nombre de la campaña</Label>
                                    <Input
                                        id="bulk-contacts-name"
                                        value={form.name}
                                        onChange={(event) =>
                                            setForm((current) => ({ ...current, name: event.target.value }))
                                        }
                                        className="h-11 rounded-xl"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Canal de salida</Label>
                                    <Select
                                        value={form.sourceType}
                                        onValueChange={(value: "wuzapi" | "meta") =>
                                            setForm((current) => ({
                                                ...current,
                                                sourceType: value,
                                                type: value === "wuzapi" && current.type === "template" ? "text" : current.type,
                                                content: value === "wuzapi" && current.type === "template" ? "" : current.content,
                                                mediaUrl: value === "wuzapi" && current.type === "template" ? null : current.mediaUrl,
                                                mediaType: value === "wuzapi" && current.type === "template" ? null : current.mediaType,
                                                mediaFileName: value === "wuzapi" && current.type === "template" ? null : current.mediaFileName,
                                                ycloudTemplateName: value === "wuzapi" ? "" : current.ycloudTemplateName,
                                                ycloudTemplateLanguage: value === "wuzapi" ? "" : current.ycloudTemplateLanguage,
                                                ycloudTemplateComponents: value === "wuzapi" ? [] : current.ycloudTemplateComponents,
                                                ycloudTemplateVariableValues: value === "wuzapi" ? {} : current.ycloudTemplateVariableValues,
                                                followUpCount: value === "meta" ? 0 : current.followUpCount,
                                            }))
                                        }
                                    >
                                        <SelectTrigger className="h-11 rounded-xl">
                                            <SelectValue placeholder="Selecciona canal" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="wuzapi">WhatsApp por QR</SelectItem>
                                            <SelectItem value="meta">WhatsApp API oficial</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        {form.sourceType === "meta"
                                            ? form.type === "template"
                                                ? "La plantilla puede enviarse aunque el cliente no tenga ventana abierta."
                                                : "El mensaje libre solo incluira clientes seleccionados con ventana de WhatsApp API abierta."
                                            : "Usa el envio masivo actual por WhatsApp QR."}
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="bulk-contacts-start-at">Inicio</Label>
                                    <Input
                                        id="bulk-contacts-start-at"
                                        type="datetime-local"
                                        value={form.scheduledStartAt}
                                        onChange={(event) =>
                                            setForm((current) => ({ ...current, scheduledStartAt: event.target.value }))
                                        }
                                        className="h-11 rounded-xl"
                                    />
                                </div>

                                {form.sourceType === "meta" ? (
                                    <div className="space-y-2">
                                        <Label>Modo WhatsApp API</Label>
                                        <Select
                                            value={form.type === "template" ? "template" : "open-window"}
                                            onValueChange={(value: "open-window" | "template") =>
                                                setForm((current) => ({
                                                    ...current,
                                                    type: value === "template" ? "template" : "text",
                                                    content: value === "template" ? current.content : "",
                                                    mediaUrl: null,
                                                    mediaType: null,
                                                    mediaFileName: null,
                                                    ycloudTemplateName: value === "template" ? current.ycloudTemplateName : "",
                                                    ycloudTemplateLanguage: value === "template" ? current.ycloudTemplateLanguage : "",
                                                    ycloudTemplateComponents: value === "template" ? current.ycloudTemplateComponents : [],
                                                    ycloudTemplateVariableValues: value === "template" ? current.ycloudTemplateVariableValues : {},
                                                    followUpCount: 0,
                                                }))
                                            }
                                        >
                                            <SelectTrigger className="h-11 rounded-xl">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="open-window">Mensaje libre (ventana abierta)</SelectItem>
                                                <SelectItem value="template">Plantilla Meta</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : null}
                            </div>

                            {form.type === "template" ? (
                                <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                                    <div className="flex flex-col gap-1">
                                        <p className="text-sm font-semibold text-foreground">Plantilla Meta</p>
                                        <p className="text-sm leading-6 text-muted-foreground">
                                            Selecciona una plantilla aprobada y completa sus variables antes de iniciar el envio.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Plantilla aprobada</Label>
                                        <Select
                                            value={selectedYCloudTemplate?.id || ""}
                                            onValueChange={applyYCloudTemplate}
                                            disabled={isLoadingYCloudTemplates || approvedYCloudTemplates.length === 0}
                                        >
                                            <SelectTrigger className="h-11 rounded-xl bg-background">
                                                <SelectValue placeholder={isLoadingYCloudTemplates ? "Cargando plantillas..." : "Selecciona plantilla"} />
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

                                    {ycloudVariableSlots.length > 0 ? (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {ycloudVariableSlots.map((slot) => (
                                                <div key={slot.key} className="space-y-2 rounded-xl border bg-background p-3">
                                                    <Label>{slot.label}</Label>
                                                    <Input
                                                        value={form.ycloudTemplateVariableValues[slot.key] || ""}
                                                        onChange={(event) => updateYCloudTemplateVariable(slot, event.target.value)}
                                                        placeholder="Ej. {{nombre}}"
                                                        className="h-10 rounded-xl"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : form.ycloudTemplateName ? (
                                        <p className="rounded-xl border bg-background p-3 text-sm text-muted-foreground">
                                            Esta plantilla no tiene variables numericas.
                                        </p>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label htmlFor="bulk-contacts-content">Mensaje</Label>
                                    <Textarea
                                        id="bulk-contacts-content"
                                        value={form.content}
                                        onChange={(event) =>
                                            setForm((current) => ({ ...current, content: event.target.value }))
                                        }
                                        placeholder="Escribe el mensaje o carga una plantilla para precargarlo..."
                                        className="min-h-[140px] rounded-2xl"
                                    />
                                </div>
                            )}

                            <details className="rounded-2xl border bg-background open:pb-4">
                                <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                                        Opciones avanzadas
                                    </div>
                                    <span className="hidden text-xs text-muted-foreground sm:inline">
                                        Lotes, delays, seguimientos y reglas
                                    </span>
                                </summary>

                                <div className="space-y-4 px-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Sub-lote</Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={String(form.batchSize)}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        batchSize: Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Pausa por lote (min)</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={1440}
                                                value={String(form.batchDelayMinutes)}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        batchDelayMinutes: Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Delay min (seg)</Label>
                                            <Input
                                                type="number"
                                                min={5}
                                                max={1800}
                                                value={String(form.randomDelayMinSeconds)}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        randomDelayMinSeconds: Math.max(5, Number.parseInt(event.target.value || "5", 10) || 5),
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Delay max (seg)</Label>
                                            <Input
                                                type="number"
                                                min={5}
                                                max={1800}
                                                value={String(form.randomDelayMaxSeconds)}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        randomDelayMaxSeconds: Math.max(5, Number.parseInt(event.target.value || "5", 10) || 5),
                                                    }))
                                                }
                                            />
                                        </div>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Seguimientos extra</Label>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={12}
                                                value={String(form.followUpCount)}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        followUpCount: Math.min(
                                                            12,
                                                            Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                                                        ),
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Cadencia seguimientos (dias)</Label>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={30}
                                                value={String(form.followUpDelayDays)}
                                                disabled={form.followUpCount === 0}
                                                onChange={(event) =>
                                                    setForm((current) => ({
                                                        ...current,
                                                        followUpDelayDays: Math.min(
                                                            30,
                                                            Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                                                        ),
                                                    }))
                                                }
                                            />
                                        </div>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="flex items-start justify-between gap-4 rounded-2xl border bg-muted/15 px-4 py-3">
                                            <div>
                                                <p className="font-medium text-foreground">Respetar horario habil</p>
                                                <p className="text-sm text-muted-foreground">
                                                    Usa la franja configurada en el CRM.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={form.respectBusinessHours}
                                                onCheckedChange={(checked) =>
                                                    setForm((current) => ({ ...current, respectBusinessHours: checked }))
                                                }
                                            />
                                        </div>

                                        <div className="flex items-start justify-between gap-4 rounded-2xl border bg-muted/15 px-4 py-3">
                                            <div>
                                                <p className="font-medium text-foreground">Detener al responder</p>
                                                <p className="text-sm text-muted-foreground">
                                                    Corta la secuencia si el lead responde.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={form.stopOnReply}
                                                onCheckedChange={(checked) =>
                                                    setForm((current) => ({ ...current, stopOnReply: checked }))
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </details>
                        </div>
                    </div>

                    <div
                        className={cn(
                            "bg-muted/15 px-6 py-5",
                            useTwoColumnBodyLayout
                                ? "overflow-y-auto border-l border-border/60"
                                : "border-t border-border/60",
                        )}
                    >
                        <div className="space-y-4">
                            <div>
                                <p className="text-sm font-semibold text-foreground">Vista previa</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Ejemplo con el primer cliente seleccionado.
                                </p>
                            </div>

                            <WhatsAppTemplatePreview
                                title={form.name || "Envio rapido"}
                                subtitle={previewContact ? getContactFullName(previewContact, "Sin nombre") : "Sin destinatario"}
                                type={form.type === "template" ? "text" : form.type}
                                content={previewContent}
                                mediaUrl={form.mediaUrl}
                                mediaType={form.mediaType}
                                mediaFileName={form.mediaFileName}
                                density="compact"
                            />

                            <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
                                <p>
                                    Se enviaran <span className="font-semibold text-foreground">{contacts.length}</span> mensajes iniciales en sub-lotes de{" "}
                                    <span className="font-semibold text-foreground">{form.batchSize}</span>.
                                </p>
                                <p className="mt-2">
                                    Delays entre <span className="font-semibold text-foreground">{form.randomDelayMinSeconds}</span> y{" "}
                                    <span className="font-semibold text-foreground">{form.randomDelayMaxSeconds}</span> segundos, con pausa larga de{" "}
                                    <span className="font-semibold text-foreground">{form.batchDelayMinutes}</span> minutos.
                                </p>
                                <p className="mt-2">
                                    {form.followUpCount > 0
                                        ? `Habrá hasta ${form.followUpCount} seguimiento(s) extra por cliente.`
                                        : "No se enviaran seguimientos extra."}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
                    <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => handleOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        className="rounded-xl"
                        onClick={handleSubmit}
                        disabled={isSubmitting || contacts.length === 0}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Procesando...
                            </>
                        ) : (
                            <>
                                <Wand2 className="mr-2 h-4 w-4" />
                                {submitLabel}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
