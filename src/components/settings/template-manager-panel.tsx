"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Copy,
    FileImage,
    FileText,
    Loader2,
    Plus,
    Search,
    Star,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { WhatsAppTemplatePreview } from "@/components/templates/whatsapp-template-preview";
import { getSafeMediaUrl } from "@/lib/media-url";
import {
    TEMPLATE_VARIABLES,
    TemplateRecord,
    humanizeTemplateType,
    listTemplateVariableKeys,
    normalizeTemplateShortcut,
} from "@/lib/templates";

type TemplateFormState = {
    id: string | null;
    name: string;
    content: string;
    category: string;
    type: "text" | "image" | "document";
    shortcut: string;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    isFavorite: boolean;
    isActive: boolean;
    sortOrder: number;
};

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
    id: null,
    name: "",
    content: "",
    category: "",
    type: "text",
    shortcut: "",
    mediaUrl: null,
    mediaType: null,
    mediaFileName: null,
    isFavorite: false,
    isActive: true,
    sortOrder: 0,
};

function getTemplateIcon(type: string) {
    if (type === "image") return FileImage;
    return FileText;
}

function mapTemplateToForm(template: TemplateRecord): TemplateFormState {
    return {
        id: template.id,
        name: template.name,
        content: template.content,
        category: template.category || "",
        type: (template.type as "text" | "image" | "document") || "text",
        shortcut: template.shortcut || "",
        mediaUrl: template.mediaUrl,
        mediaType: template.mediaType,
        mediaFileName: template.mediaFileName,
        isFavorite: template.isFavorite,
        isActive: template.isActive,
        sortOrder: template.sortOrder,
    };
}

export function TemplateManagerPanel() {
    const { toast } = useToast();
    const [templates, setTemplates] = useState<TemplateRecord[]>([]);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);

    const loadTemplates = async (query?: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (query?.trim()) params.set("q", query.trim());
            const response = await fetch(`/api/templates${params.toString() ? `?${params.toString()}` : ""}`, {
                cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudieron cargar las plantillas");
            setTemplates(result.templates || []);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las plantillas",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadTemplates();
    }, []);

    const filteredTemplates = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return templates;
        return templates.filter((template) =>
            [template.name, template.category || "", template.content, template.shortcut || ""]
                .join(" ")
                .toLowerCase()
                .includes(query),
        );
    }, [search, templates]);

    const detectedVariables = useMemo(
        () => listTemplateVariableKeys(form.content).filter((key) =>
            TEMPLATE_VARIABLES.some((variable) => variable.key === key),
        ),
        [form.content],
    );
    const previewMediaUrl = useMemo(() => getSafeMediaUrl(form.mediaUrl), [form.mediaUrl]);

    const resetForm = () => setForm(EMPTY_TEMPLATE_FORM);

    const saveTemplate = async () => {
        setIsSaving(true);
        try {
            const payload = {
                name: form.name,
                content: form.content,
                category: form.category,
                type: form.type,
                shortcut: form.shortcut,
                mediaUrl: form.type === "text" ? null : form.mediaUrl,
                mediaType: form.type === "text" ? null : form.mediaType,
                mediaFileName: form.type === "text" ? null : form.mediaFileName,
                isFavorite: form.isFavorite,
                isActive: form.isActive,
                sortOrder: form.sortOrder,
            };

            const response = await fetch(form.id ? `/api/templates/${form.id}` : "/api/templates", {
                method: form.id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo guardar la plantilla");

            toast({
                title: form.id ? "Plantilla actualizada" : "Plantilla creada",
            });
            resetForm();
            await loadTemplates(search);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo guardar la plantilla",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const deleteTemplate = async (templateId: string) => {
        if (!window.confirm("Eliminar esta plantilla?")) return;

        try {
            const response = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo eliminar la plantilla");

            if (form.id === templateId) resetForm();
            toast({ title: "Plantilla eliminada" });
            await loadTemplates(search);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo eliminar la plantilla",
                variant: "destructive",
            });
        }
    };

    const duplicateTemplate = async (template: TemplateRecord) => {
        try {
            const response = await fetch("/api/templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: `${template.name} (copia)`,
                    content: template.content,
                    category: template.category || "",
                    type: template.type,
                    shortcut: "",
                    mediaUrl: template.mediaUrl,
                    mediaType: template.mediaType,
                    mediaFileName: template.mediaFileName,
                    isFavorite: false,
                    isActive: template.isActive,
                    sortOrder: template.sortOrder,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo duplicar la plantilla");
            toast({ title: "Plantilla duplicada" });
            await loadTemplates(search);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo duplicar la plantilla",
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

    return (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="font-semibold">Plantillas internas</h2>
                        <p className="text-sm text-muted-foreground">Respuestas guardadas para texto, imagen y documento.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={resetForm} className="w-full sm:w-auto">
                        <Plus className="mr-2 h-4 w-4" />
                        Nueva
                    </Button>
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar plantilla..."
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="pl-9"
                    />
                </div>

                <div className="space-y-2">
                    {isLoading ? (
                        <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cargando plantillas...
                        </div>
                    ) : filteredTemplates.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                            No hay plantillas todavia.
                        </div>
                    ) : (
                        filteredTemplates.map((template) => {
                            const Icon = getTemplateIcon(template.type);
                            const isSelected = form.id === template.id;
                            return (
                                <div
                                    key={template.id}
                                    className={`rounded-xl border p-3 transition ${
                                        isSelected ? "border-primary bg-primary/5" : "hover:border-primary/35"
                                    }`}
                                >
                                    <button className="w-full text-left" onClick={() => setForm(mapTemplateToForm(template))}>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate font-medium">{template.name}</p>
                                                    {template.isFavorite ? <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> : null}
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {humanizeTemplateType(template.type)}
                                                    {template.category ? ` - ${template.category}` : ""}
                                                    {template.shortcut ? ` - /${template.shortcut}` : ""}
                                                </p>
                                                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                                    {template.content || template.mediaFileName || "Plantilla multimedia"}
                                                </p>
                                            </div>
                                        </div>
                                    </button>

                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => duplicateTemplate(template)}>
                                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                                            Duplicar
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" onClick={() => deleteTemplate(template.id)}>
                                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                            Eliminar
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="font-semibold">{form.id ? "Editar plantilla" : "Nueva plantilla"}</h2>
                        <p className="text-sm text-muted-foreground">La seleccion se inserta primero en el composer antes de enviarse.</p>
                    </div>
                    <Button onClick={saveTemplate} disabled={isSaving || isUploading} className="w-full sm:w-auto">
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Guardar
                    </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Nombre</Label>
                        <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                        <Label>Categoria</Label>
                        <Input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Ventas, soporte, pagos..." />
                    </div>
                    <div className="space-y-2">
                        <Label>Tipo</Label>
                        <select
                            value={form.type}
                            onChange={(event) =>
                                setForm((current) => ({
                                    ...current,
                                    type: event.target.value as TemplateFormState["type"],
                                    mediaUrl: event.target.value === "text" ? null : current.mediaUrl,
                                    mediaType: event.target.value === "text" ? null : current.mediaType,
                                    mediaFileName: event.target.value === "text" ? null : current.mediaFileName,
                                }))
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        >
                            <option value="text">Texto</option>
                            <option value="image">Imagen</option>
                            <option value="document">Documento</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <Label>Atajo</Label>
                        <Input
                            value={form.shortcut}
                            onChange={(event) =>
                                setForm((current) => ({
                                    ...current,
                                    shortcut: normalizeTemplateShortcut(event.target.value) || "",
                                }))
                            }
                            placeholder="bienvenida"
                        />
                        <p className="text-xs text-muted-foreground">Se usa como `/bienvenida` dentro del chat.</p>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                        <Label>Favorita</Label>
                        <div className="flex h-10 items-center justify-between rounded-lg border px-3">
                            <span className="text-sm">Mostrar primero</span>
                            <Switch checked={form.isFavorite} onCheckedChange={(checked) => setForm((current) => ({ ...current, isFavorite: checked }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Activa</Label>
                        <div className="flex h-10 items-center justify-between rounded-lg border px-3">
                            <span className="text-sm">Disponible en el inbox</span>
                            <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Orden</Label>
                        <Input
                            type="number"
                            value={String(form.sortOrder)}
                            onChange={(event) =>
                                setForm((current) => ({
                                    ...current,
                                    sortOrder: Number.parseInt(event.target.value || "0", 10) || 0,
                                }))
                            }
                        />
                    </div>
                </div>

                {form.type !== "text" && (
                    <div className="space-y-3 rounded-xl border bg-muted/15 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                            <div>
                                <p className="font-medium">Archivo de la plantilla</p>
                                <p className="text-sm text-muted-foreground">Sube una imagen o documento reutilizable.</p>
                            </div>
                            <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted/40 sm:w-auto">
                                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Subir archivo
                                <input
                                    type="file"
                                    className="hidden"
                                    accept={form.type === "image" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"}
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void handleMediaUpload(file);
                                        event.currentTarget.value = "";
                                    }}
                                />
                            </label>
                        </div>

                        {form.mediaUrl ? (
                            <div className="rounded-xl border bg-background/80 p-3">
                                {form.type === "image" ? (
                                    previewMediaUrl ? (
                                        <img
                                            src={previewMediaUrl}
                                            alt={form.mediaFileName || "Plantilla"}
                                            className="max-h-52 rounded-xl object-contain"
                                        />
                                    ) : (
                                        <div className="flex h-44 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                            <FileImage className="h-8 w-8" />
                                        </div>
                                    )
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <div className="rounded-xl bg-primary/10 p-3 text-primary">
                                            <FileText className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{form.mediaFileName || "Documento"}</p>
                                            <p className="text-xs text-muted-foreground">{form.mediaType || "application/octet-stream"}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                                Esta plantilla aun no tiene archivo adjunto.
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-2">
                    <Label>Mensaje</Label>
                    <Textarea
                        value={form.content}
                        onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                        placeholder={form.type === "text" ? "Escribe el contenido de la plantilla..." : "Caption o texto opcional..."}
                        className="min-h-[180px]"
                    />
                    <p className="text-xs text-muted-foreground">
                        Usa <span className="font-semibold">*</span>texto<span className="font-semibold">*</span> para negritas en la vista previa.
                    </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-2xl border bg-muted/15 p-4">
                        <p className="font-medium">Variables disponibles</p>
                        <p className="text-sm text-muted-foreground">Se reemplazan automaticamente con datos del contacto y del agente.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {TEMPLATE_VARIABLES.map((variable) => (
                                <button
                                    key={variable.key}
                                    type="button"
                                    onClick={() =>
                                        setForm((current) => ({
                                            ...current,
                                            content: current.content
                                                ? `${current.content}${current.content.endsWith(" ") ? "" : " "}${variable.placeholder}`
                                                : variable.placeholder,
                                        }))
                                    }
                                    className="rounded-full border px-3 py-1 text-xs font-medium hover:border-primary hover:text-primary"
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

                    <div className="rounded-[1.8rem] border bg-background/80 p-4 shadow-[0_22px_55px_-38px_rgba(15,23,42,0.32)]">
                        <p className="font-medium">Vista previa premium</p>
                        <p className="text-sm text-muted-foreground">Asi se vera la plantilla antes de insertarla en el chat.</p>

                        <div className="mt-4 rounded-xl border border-sky-100/70 bg-gradient-to-br from-sky-50 via-background to-emerald-50/70 p-4">
                            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-sky-100/80 bg-white/85 px-4 py-3 shadow-[0_16px_34px_-30px_rgba(14,116,144,0.38)] sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{form.name || "Sin nombre"}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {humanizeTemplateType(form.type)}
                                        {form.category ? ` - ${form.category}` : ""}
                                        {form.shortcut ? ` - /${form.shortcut}` : ""}
                                    </p>
                                </div>
                                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                                    Vista previa
                                </div>
                            </div>

                            <WhatsAppTemplatePreview
                                title={form.name || "Tu plantilla"}
                                subtitle={form.category || "Plantilla de WhatsApp"}
                                type={form.type}
                                content={form.content}
                                mediaUrl={previewMediaUrl}
                                mediaType={form.mediaType}
                                mediaFileName={form.mediaFileName}
                            />

                            {form.mediaFileName ? (
                                <div className="mt-4 rounded-xl border border-sky-100/80 bg-white/85 p-3 shadow-[0_16px_36px_-32px_rgba(14,116,144,0.4)]">
                                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Archivo vinculado</p>
                                    <div className="mt-3 rounded-xl border border-border/60 bg-background/90 p-3">
                                        {form.type === "image" ? (
                                            previewMediaUrl ? (
                                                <img
                                                    src={previewMediaUrl}
                                                    alt={form.mediaFileName || "Plantilla"}
                                                    className="max-h-52 w-full rounded-lg object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-40 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                                                    <FileImage className="h-8 w-8" />
                                                </div>
                                            )
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <div className="rounded-xl bg-primary/10 p-3 text-primary">
                                                    <FileText className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium">{form.mediaFileName || "Documento"}</p>
                                                    <p className="text-xs text-muted-foreground">{form.mediaType || "application/octet-stream"}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
