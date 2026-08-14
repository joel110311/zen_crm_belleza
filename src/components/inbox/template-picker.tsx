"use client";

import { useMemo, useState } from "react";
import { FileImage, FileText, Search, Star, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TemplateRecord, humanizeTemplateType } from "@/lib/templates";
import { WhatsAppTemplatePreview } from "@/components/templates/whatsapp-template-preview";

function getTemplateIcon(type: string) {
    if (type === "image") return FileImage;
    return FileText;
}

interface TemplatePickerProps {
    templates: TemplateRecord[];
    onApply: (template: TemplateRecord) => void;
    disabled?: boolean;
}

export function TemplatePicker({ templates, onApply, disabled = false }: TemplatePickerProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [previewId, setPreviewId] = useState<string | null>(null);

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

    const previewTemplate =
        filteredTemplates.find((template) => template.id === previewId) || filteredTemplates[0] || null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full border border-transparent text-muted-foreground hover:border-border/50 hover:bg-muted/50 hover:text-foreground"
                    disabled={disabled}
                    title="Usar plantilla"
                >
                    <Wand2 className="h-5 w-5" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                collisionPadding={12}
                className="flex w-[min(92vw,760px)] flex-col overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/95 p-0 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.58)] backdrop-blur-xl"
                style={{
                    maxHeight: "min(calc(100vh - 2rem), var(--radix-popover-content-available-height))",
                }}
            >
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="grid h-full min-h-0 lg:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="flex min-h-0 flex-col border-b border-border/50 p-4 lg:border-b-0 lg:border-r">
                            <div className="mb-4">
                                <p className="font-semibold">Plantillas</p>
                                <p className="text-sm text-muted-foreground">
                                    Selecciona una respuesta guardada para insertarla en el composer.
                                </p>
                            </div>

                            <div className="relative mb-4">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Buscar por nombre, atajo o categoria..."
                                    className="pl-9"
                                />
                            </div>

                            <div className="min-h-0 flex-1 space-y-2 overflow-visible pr-1 lg:overflow-y-auto">
                                {filteredTemplates.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                                        No hay plantillas activas.
                                    </div>
                                ) : (
                                    filteredTemplates.map((template) => {
                                        const Icon = getTemplateIcon(template.type);
                                        const isSelected = previewTemplate?.id === template.id;
                                        return (
                                            <button
                                                key={template.id}
                                                className={`w-full rounded-2xl border p-3 text-left transition ${
                                                    isSelected ? "border-primary bg-primary/5" : "hover:border-primary/35"
                                                }`}
                                                onClick={() => setPreviewId(template.id)}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                        <Icon className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="truncate font-medium">{template.name}</p>
                                                            {template.isFavorite ? (
                                                                <Star className="h-3.5 w-3.5 fill-current text-amber-500" />
                                                            ) : null}
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
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div className="flex min-h-0 flex-col p-4">
                            {previewTemplate ? (
                                <>
                                    <div className="mb-4">
                                        <p className="font-semibold">{previewTemplate.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {humanizeTemplateType(previewTemplate.type)}
                                            {previewTemplate.shortcut ? ` - /${previewTemplate.shortcut}` : ""}
                                        </p>
                                    </div>

                                    <div className="flex min-h-0 flex-1 items-start justify-center rounded-[1.6rem] border border-sky-100/80 bg-gradient-to-br from-sky-50 via-background to-emerald-50/70 p-5">
                                        <WhatsAppTemplatePreview
                                            className="max-w-[390px]"
                                            title={previewTemplate.name}
                                            subtitle={previewTemplate.category || "Plantilla lista para usar"}
                                            type={(previewTemplate.type as "text" | "image" | "document") || "text"}
                                            content={previewTemplate.content || ""}
                                            mediaUrl={previewTemplate.mediaUrl}
                                            mediaType={previewTemplate.mediaType}
                                            mediaFileName={previewTemplate.mediaFileName}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
                                    Selecciona una plantilla para previsualizarla.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-t border-border/50 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                    <div className="flex justify-end">
                        <Button
                            onClick={() => {
                                if (!previewTemplate) return;
                                onApply(previewTemplate);
                                setOpen(false);
                                setSearch("");
                            }}
                            disabled={!previewTemplate}
                        >
                            Usar plantilla
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
