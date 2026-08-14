"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    CheckCircle2,
    LayoutTemplate,
    Loader2,
    RefreshCw,
    Search,
    Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type MetaTemplateComponent = {
    type?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string }>;
};

type MetaTemplateItem = {
    id?: string;
    name?: string;
    language?: string;
    status?: string;
    category?: string;
    components?: MetaTemplateComponent[];
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId: string;
    contactName?: string | null;
    contactPhone?: string | null;
    onSent?: (message: unknown) => void;
};

function normalizeStatus(value?: string) {
    return (value || "").trim().toUpperCase();
}

function categoryLabel(value?: string) {
    const category = (value || "").trim().toUpperCase();
    if (category === "UTILITY") return "Utilidad";
    if (category === "MARKETING") return "Marketing";
    if (category === "AUTHENTICATION") return "Autenticacion";
    return value || "Sin categoria";
}

function extractComponentText(template: MetaTemplateItem, type: "HEADER" | "BODY" | "FOOTER") {
    const component = (template.components || []).find((entry) => (entry.type || "").toUpperCase() === type);
    return (component?.text || "").trim();
}

function extractVariables(text: string) {
    const matches = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
    return Array.from(new Set(matches.map((match) => match[1]))).sort((left, right) => Number(left) - Number(right));
}

function replaceVariables(text: string, values: Record<string, string>) {
    return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, key: string) => values[key] || `{{${key}}}`);
}

function joinTemplateKey(template: MetaTemplateItem) {
    return `${template.name || ""}::${template.language || "es"}`;
}

export function MetaTemplateSendModal({
    open,
    onOpenChange,
    conversationId,
    contactName,
    contactPhone,
    onSent,
}: Props) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [query, setQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [templates, setTemplates] = useState<MetaTemplateItem[]>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});

    const loadTemplates = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/templates/meta?limit=100", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudieron cargar las plantillas de WhatsApp API.");
            }

            const items = Array.isArray(result.items) ? (result.items as MetaTemplateItem[]) : [];
            const approved = items.filter((template) => normalizeStatus(template.status) === "APPROVED");
            setTemplates(approved);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las plantillas.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (!open) return;

        setQuery("");
        setCategoryFilter("all");
        setSelectedKey("");
        setVariableValues({});
        void loadTemplates();
    }, [open, loadTemplates]);

    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const template of templates) {
            const category = (template.category || "").trim().toUpperCase() || "UNKNOWN";
            counts.set(category, (counts.get(category) || 0) + 1);
        }
        return Array.from(counts.entries());
    }, [templates]);

    const filteredTemplates = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        return templates.filter((template) => {
            const category = (template.category || "").trim().toUpperCase();
            const body = extractComponentText(template, "BODY").toLowerCase();
            const haystack = `${template.name || ""} ${template.language || ""} ${category} ${body}`.toLowerCase();
            const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
            const matchesCategory = categoryFilter === "all" || category === categoryFilter;
            return matchesQuery && matchesCategory;
        });
    }, [templates, query, categoryFilter]);

    useEffect(() => {
        if (!open) return;
        if (selectedKey) return;
        if (filteredTemplates.length === 0) return;
        setSelectedKey(joinTemplateKey(filteredTemplates[0]));
    }, [open, selectedKey, filteredTemplates]);

    const selectedTemplate = useMemo(
        () => filteredTemplates.find((template) => joinTemplateKey(template) === selectedKey)
            || templates.find((template) => joinTemplateKey(template) === selectedKey)
            || null,
        [filteredTemplates, templates, selectedKey],
    );

    const headerText = selectedTemplate ? extractComponentText(selectedTemplate, "HEADER") : "";
    const bodyText = selectedTemplate ? extractComponentText(selectedTemplate, "BODY") : "";
    const footerText = selectedTemplate ? extractComponentText(selectedTemplate, "FOOTER") : "";

    const headerVariables = useMemo(() => extractVariables(headerText), [headerText]);
    const bodyVariables = useMemo(() => extractVariables(bodyText), [bodyText]);
    const allVariables = useMemo(
        () => Array.from(new Set([...headerVariables, ...bodyVariables])).sort((a, b) => Number(a) - Number(b)),
        [headerVariables, bodyVariables],
    );

    const previewHeader = useMemo(() => replaceVariables(headerText, variableValues), [headerText, variableValues]);
    const previewBody = useMemo(() => replaceVariables(bodyText, variableValues), [bodyText, variableValues]);

    useEffect(() => {
        setVariableValues({});
    }, [selectedKey]);

    const handleSend = async () => {
        if (!selectedTemplate?.name) {
            toast({
                title: "Plantilla requerida",
                description: "Selecciona una plantilla aprobada para continuar.",
                variant: "destructive",
            });
            return;
        }

        const missingVariable = allVariables.find((key) => !variableValues[key]?.trim());
        if (missingVariable) {
            toast({
                title: "Faltan variables",
                description: `Completa la variable {{${missingVariable}}} antes de enviar.`,
                variant: "destructive",
            });
            return;
        }

        setSending(true);
        try {
            const requestComponents: Array<{ type: "HEADER" | "BODY"; parameters: Array<{ type: "text"; text: string }> }> = [];

            if (headerVariables.length > 0) {
                requestComponents.push({
                    type: "HEADER",
                    parameters: headerVariables.map((key) => ({
                        type: "text",
                        text: variableValues[key].trim(),
                    })),
                });
            }

            if (bodyVariables.length > 0) {
                requestComponents.push({
                    type: "BODY",
                    parameters: bodyVariables.map((key) => ({
                        type: "text",
                        text: variableValues[key].trim(),
                    })),
                });
            }

            const response = await fetch("/api/templates/meta/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId,
                    templateName: selectedTemplate.name,
                    languageCode: selectedTemplate.language || "es",
                    components: requestComponents.length > 0 ? requestComponents : undefined,
                    resolvedContent: previewBody || `[Plantilla: ${selectedTemplate.name}]`,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudo enviar la plantilla.");
            }

            toast({
                title: "Plantilla enviada",
                description: "El mensaje plantilla se envio correctamente por WhatsApp API.",
            });

            if (result.message) {
                onSent?.(result);
            }
            onOpenChange(false);
        } catch (error) {
            toast({
                title: "Error al enviar",
                description: error instanceof Error ? error.message : "No se pudo enviar la plantilla.",
                variant: "destructive",
            });
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[1120px] gap-0 overflow-hidden p-0 sm:max-h-[88vh]">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <LayoutTemplate className="h-5 w-5 text-primary" />
                        Agregar plantilla
                    </DialogTitle>
                    <DialogDescription>
                        {contactName || "Contacto"} {contactPhone ? `(${contactPhone})` : ""}. Selecciona una plantilla aprobada en Meta.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex min-h-[420px] items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                ) : (
                    <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
                        <aside className="border-b p-4 lg:border-b-0 lg:border-r">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar plantillas..."
                                    className="pl-9"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                            </div>

                            <div className="mt-4 space-y-1">
                                <button
                                    type="button"
                                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${categoryFilter === "all" ? "bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                                    onClick={() => setCategoryFilter("all")}
                                >
                                    Todas las plantillas ({templates.length})
                                </button>
                                {categories.map(([category, count]) => (
                                    <button
                                        key={category}
                                        type="button"
                                        className={`w-full rounded-lg px-3 py-2 text-left text-sm ${categoryFilter === category ? "bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                                        onClick={() => setCategoryFilter(category)}
                                    >
                                        {categoryLabel(category)} ({count})
                                    </button>
                                ))}
                            </div>
                        </aside>

                        <section className="border-b p-4 lg:border-b-0 lg:border-r">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">
                                    {filteredTemplates.length} plantilla{filteredTemplates.length === 1 ? "" : "s"} encontradas
                                </p>
                                <Button variant="outline" size="sm" onClick={() => void loadTemplates()} disabled={loading}>
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                    Actualizar
                                </Button>
                            </div>

                            {filteredTemplates.length === 0 ? (
                                <div className="flex h-[420px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                                    No hay plantillas aprobadas para este filtro.
                                </div>
                            ) : (
                                <div className="grid max-h-[430px] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                                    {filteredTemplates.map((template) => {
                                        const key = joinTemplateKey(template);
                                        const selected = key === selectedKey;
                                        const preview = extractComponentText(template, "BODY");

                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setSelectedKey(key)}
                                                className={`rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/5" : "hover:border-primary/30"}`}
                                            >
                                                <p className="truncate text-sm font-semibold">{template.name || "Sin nombre"}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {categoryLabel(template.category)} - {(template.language || "es").toLowerCase()}
                                                </p>
                                                <p className="mt-2 line-clamp-5 text-sm text-muted-foreground">
                                                    {preview || "Sin cuerpo"}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        <section className="p-4">
                            {selectedTemplate ? (
                                <div className="flex h-full flex-col">
                                    <div className="rounded-xl border bg-muted/20 p-4">
                                        <div className="mb-3 flex items-center justify-between gap-2">
                                            <p className="truncate text-sm font-semibold">{selectedTemplate.name}</p>
                                            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                                Aprobada
                                            </span>
                                        </div>

                                        <div className="rounded-xl border bg-background p-3 text-sm">
                                            {previewHeader ? <p className="font-semibold">{previewHeader}</p> : null}
                                            <p className="mt-2 whitespace-pre-wrap">{previewBody || `[Plantilla: ${selectedTemplate.name}]`}</p>
                                            {footerText ? <p className="mt-2 text-xs italic text-muted-foreground">{footerText}</p> : null}
                                        </div>
                                    </div>

                                    <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
                                        {allVariables.length > 0 ? (
                                            allVariables.map((key) => (
                                                <div key={key} className="space-y-1.5">
                                                    <Label htmlFor={`tpl-var-${key}`}>Variable {`{{${key}}}`}</Label>
                                                    <Input
                                                        id={`tpl-var-${key}`}
                                                        value={variableValues[key] || ""}
                                                        onChange={(event) =>
                                                            setVariableValues((prev) => ({
                                                                ...prev,
                                                                [key]: event.target.value,
                                                            }))
                                                        }
                                                        placeholder={`Valor para {{${key}}}`}
                                                    />
                                                </div>
                                            ))
                                        ) : (
                                            <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                                                Esta plantilla no requiere variables.
                                            </div>
                                        )}
                                    </div>

                                    <DialogFooter className="mt-4 px-0 pb-0">
                                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
                                            Cancelar
                                        </Button>
                                        <Button onClick={() => void handleSend()} disabled={sending || !conversationId}>
                                            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                            Usar esta plantilla
                                        </Button>
                                    </DialogFooter>
                                </div>
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    <CheckCircle2 className="mb-2 h-7 w-7" />
                                    Selecciona una plantilla para ver la vista previa.
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
