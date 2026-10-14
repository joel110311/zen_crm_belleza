"use client";

import styles from "@/components/shared/management-workspace.module.css";
import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import { useCompactWorkspace } from "@/components/shared/use-compact-workspace";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
    Copy,
    FileImage,
    FileText,
    Loader2,
    Plus,
    Search,
    Star,
    Trash2,
    X,
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
    const { readOnly } = useWorkspaceAccess();
    const compact = useCompactWorkspace();
    const [editorOpen, setEditorOpen] = useState(false);
    const [savedForm, setSavedForm] = useState(EMPTY_TEMPLATE_FORM);
    const [pendingForm, setPendingForm] = useState<TemplateFormState | null>(null);
    const [deleting, setDeleting] = useState<TemplateRecord | null>(null);
    const [templates, setTemplates] = useState<TemplateRecord[]>([]);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);

    const loadTemplates = useCallback(async (query?: string) => {
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
    }, [toast]);

    useEffect(() => {
        void loadTemplates();
    }, [loadTemplates]);

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

    const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const resetForm = () => { setForm(EMPTY_TEMPLATE_FORM); setSavedForm(EMPTY_TEMPLATE_FORM); };
    const openForm = (next: TemplateFormState) => {
        if (isSaving || isUploading) return;
        if (dirty) { setPendingForm(next); return; }
        setForm(next); setSavedForm(next); setEditorOpen(true);
    };


    const saveTemplate = async () => {
        if (readOnly || isSaving || isUploading) return;
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
            setEditorOpen(false);
            await loadTemplates();
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
        if (readOnly || isSaving || isUploading) return;
        setIsSaving(true);

        try {
            const response = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo eliminar la plantilla");

            if (form.id === templateId) resetForm();
            setDeleting(null);
            toast({ title: "Plantilla eliminada" });
            await loadTemplates();
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo eliminar la plantilla",
                variant: "destructive",
            });
        } finally { setIsSaving(false); }
    };

    const duplicateTemplate = async (template: TemplateRecord) => {
        if (readOnly || isSaving || isUploading) return;
        setIsSaving(true);
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
            await loadTemplates();
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo duplicar la plantilla",
                variant: "destructive",
            });
        } finally { setIsSaving(false); }
    };

    const handleMediaUpload = async (file: File) => {
        if (readOnly || isUploading || isSaving) return;
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

    const editorFields = <fieldset className={styles.editorFields} disabled={readOnly || isSaving || isUploading} aria-label="Datos de la plantilla">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="template-name">Nombre</Label>
                        <Input id="template-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="template-category">Categoria</Label>
                        <Input id="template-category" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Ventas, soporte, pagos..." />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="template-type">Tipo</Label>
                        <select
                            id="template-type" value={form.type}
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
                        <Label htmlFor="template-shortcut">Atajo</Label>
                        <Input
                            id="template-shortcut" value={form.shortcut}
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

                <div className="grid gap-4 xl:grid-cols-3">
                    <div className="space-y-2">
                        <Label>Favorita</Label>
                        <div className="flex h-10 items-center justify-between rounded-lg border px-3">
                            <span className="text-sm">Mostrar primero</span>
                            <Switch aria-label="Plantilla favorita" disabled={readOnly || isSaving || isUploading} checked={form.isFavorite} onCheckedChange={(checked) => setForm((current) => ({ ...current, isFavorite: checked }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Activa</Label>
                        <div className="flex h-10 items-center justify-between rounded-lg border px-3">
                            <span className="text-sm">Disponible en el inbox</span>
                            <Switch aria-label="Plantilla activa" disabled={readOnly || isSaving || isUploading} checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="template-order">Orden</Label>
                        <Input
                            type="number"
                            id="template-order" value={String(form.sortOrder)}
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
                                    disabled={readOnly || isSaving || isUploading}
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
                                        <Image
                                            src={previewMediaUrl}
                                            alt={form.mediaFileName || "Plantilla"}
                                            width={640}
                                            height={360}
                                            unoptimized
                                            className="h-auto max-h-52 w-auto max-w-full rounded-xl object-contain"
                                        />
                                    ) : (
                                        <div className="flex h-44 items-center justify-center rounded-xl bg-primary/5 text-primary/45">
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
                    <Label htmlFor="template-content">Mensaje</Label>
                    <Textarea
                        id="template-content" value={form.content}
                        onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
                        placeholder={form.type === "text" ? "Escribe el contenido de la plantilla..." : "Caption o texto opcional..."}
                        className="min-h-[180px]"
                    />
                    <p className="text-xs text-muted-foreground">
                        Usa <span className="font-semibold">*</span>texto<span className="font-semibold">*</span> para negritas en la vista previa.
                    </p>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[0.9fr_1.1fr]">
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
                        <p className="font-medium">Vista previa</p>
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
                                                <Image
                                                    src={previewMediaUrl}
                                                    alt={form.mediaFileName || "Plantilla"}
                                                    width={640}
                                                    height={360}
                                                    unoptimized
                                                    className="max-h-52 w-full rounded-lg object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-40 items-center justify-center rounded-lg bg-primary/5 text-primary/45">
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
    </fieldset>;

    return (
        <div className={styles.library}>
            <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-3">
                    <div>
                        <h2 className="font-semibold">Respuestas guardadas</h2>
                        <p className="text-sm text-muted-foreground">Texto, imágenes y documentos para responder desde Chats.</p>
                    </div>
                    <Button variant="outline" size="sm" disabled={readOnly || isSaving || isUploading} onClick={() => openForm(EMPTY_TEMPLATE_FORM)} className="w-full sm:w-auto">
                        <Plus className="mr-2 h-4 w-4" />
                        Nueva
                    </Button>
                </div>

                {compact && dirty && <Button variant="outline" className="w-full" onClick={() => setEditorOpen(true)}>Continuar borrador</Button>}
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Buscar plantillas" placeholder="Buscar plantilla..."
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
                            {search ? "No hay resultados para esta búsqueda." : "Aún no hay respuestas guardadas. Crea tu primera plantilla."}
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
                                    <button className="w-full text-left" onClick={() => openForm(mapTemplateToForm(template))} aria-label={`Abrir plantilla: ${template.name}`}>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="break-words font-medium">{template.name}</p>
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
                                        <Button variant="ghost" size="sm" className="h-8 px-2" disabled={readOnly || isSaving || isUploading} onClick={() => duplicateTemplate(template)}>
                                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                                            Duplicar
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" disabled={readOnly || isSaving || isUploading} onClick={() => setDeleting(template)}>
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

            {!compact && <section className={styles.editor} aria-label="Editor de plantillas">
                <div className={styles.editorHeader}><div><h2 className="font-semibold">{form.id ? "Editar plantilla" : "Nueva plantilla"}</h2><p className="text-sm text-muted-foreground">Se inserta en el chat para revisar antes de enviar.</p></div>
                    <Button onClick={saveTemplate} disabled={readOnly || isSaving || isUploading}>{isSaving && <Loader2 className="size-4 animate-spin" />}Guardar plantilla</Button></div>
                {editorFields}
            </section>}
            <Dialog open={compact && editorOpen} onOpenChange={(open) => { if (!isSaving && !isUploading) setEditorOpen(open); }}>
                <DialogContent className={styles.dialog} showCloseButton={false} onEscapeKeyDown={(event) => { if (isSaving || isUploading) event.preventDefault(); }} onInteractOutside={(event) => { if (isSaving || isUploading) event.preventDefault(); }}>
                    <Button variant="ghost" size="icon" aria-label="Cerrar editor" className="absolute top-2 right-2" disabled={isSaving || isUploading} onClick={() => setEditorOpen(false)}><X className="size-4" /></Button>
                    <DialogHeader className={styles.dialogHeader}><DialogTitle>{form.id ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle><DialogDescription>{readOnly ? "Consulta la plantilla. Tu cuenta está en modo de solo lectura." : "Escribe tu respuesta y revisa cómo se verá en el chat."}</DialogDescription></DialogHeader>
                    <div className={styles.dialogBody}>{editorFields}</div>
                    <DialogFooter className={styles.dialogFooter}><Button variant="outline" disabled={isSaving || isUploading} onClick={() => setEditorOpen(false)}>Volver</Button><Button disabled={readOnly || isSaving || isUploading} onClick={saveTemplate}>{isSaving && <Loader2 className="size-4 animate-spin" />}Guardar</Button></DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={Boolean(pendingForm)} onOpenChange={(open) => { if (!open) setPendingForm(null); }}><DialogContent><DialogHeader><DialogTitle>¿Descartar el borrador?</DialogTitle><DialogDescription>Hay cambios sin guardar en la plantilla actual.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingForm(null)}>Conservar</Button><Button onClick={() => { if (pendingForm) { setForm(pendingForm); setSavedForm(pendingForm); setEditorOpen(true); setPendingForm(null); } }}>Descartar</Button></DialogFooter></DialogContent></Dialog>
            <Dialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !isSaving) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Eliminar plantilla</DialogTitle><DialogDescription>Se eliminará «{deleting?.name}». Los mensajes enviados se conservan.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={isSaving} onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="destructive" disabled={readOnly || isSaving} onClick={() => deleting && void deleteTemplate(deleting.id)}>Eliminar</Button></DialogFooter></DialogContent></Dialog>

        </div>
    );
}
