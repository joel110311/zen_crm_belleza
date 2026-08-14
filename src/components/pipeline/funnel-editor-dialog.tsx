"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
    closestCenter,
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    AlertTriangle,
    CheckCircle2,
    GripVertical,
    Loader2,
    Lock,
    Plus,
    Save,
    Trash2,
    XCircle,
} from "lucide-react";

import { savePipelineConfiguration } from "@/app/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
    DEFAULT_CLOSED_LOST_COLOR,
    DEFAULT_CLOSED_WON_COLOR,
    DEFAULT_INCOMING_STAGE_NAME,
    findMatchingPipelinePreset,
    getDefaultStageColor,
    getPipelinePresetById,
    PIPELINE_PRESETS,
    type PipelineDraftStage,
    type PipelinePresetDefinition,
    type PipelinePresetId,
} from "@/lib/pipeline-presets";
import type { PipelineStageData } from "./pipeline-board";

interface FunnelEditorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: PipelineStageData[];
    onStagesChanged: () => void;
}

type DraftStage = PipelineDraftStage & {
    localId: string;
};

type PipelineDraft = {
    activeStages: DraftStage[];
    includeClosingStages: boolean;
    closedWonName: string;
    closedLostName: string;
    selectedPreset: PipelinePresetId;
};

function makeLocalStageId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `draft_${crypto.randomUUID()}`;
    }
    return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDraftStage(stage: PipelineDraftStage, index: number): DraftStage {
    return {
        ...stage,
        color: stage.color || getDefaultStageColor(index),
        localId: makeLocalStageId(),
    };
}

function getStageTextColor(hexColor: string) {
    const hex = hexColor.replace("#", "");
    const normalized =
        hex.length === 3
            ? hex
                .split("")
                .map((char) => char + char)
                .join("")
            : hex;

    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;

    return luminance > 165 ? "#1F2937" : "#0F172A";
}

function buildDraftFromStages(stages: PipelineStageData[]): PipelineDraft {
    const activeStages = stages
        .filter((stage) => !stage.isIncoming && !stage.isClosedWon && !stage.isClosedLost)
        .map((stage, index) =>
            toDraftStage(
                {
                    id: stage.id,
                    name: stage.name,
                    color: stage.color || getDefaultStageColor(index),
                },
                index
            )
        );
    const resolvedActiveStages =
        activeStages.length > 0
            ? activeStages
            : getPipelinePresetById("custom").activeStages.map((stage, index) =>
                toDraftStage(stage, index)
            );

    const closedWonStage = stages.find((stage) => stage.isClosedWon);
    const closedLostStage = stages.find((stage) => stage.isClosedLost);
    const includeClosingStages = Boolean(closedWonStage && closedLostStage);

    return {
        activeStages: resolvedActiveStages,
        includeClosingStages,
        closedWonName: closedWonStage?.name || "Cerrado Ganado",
        closedLostName: closedLostStage?.name || "Cerrado Perdido",
        selectedPreset: findMatchingPipelinePreset({
            activeStageNames: resolvedActiveStages.map((stage) => stage.name),
            includeClosingStages,
            closedWonName: closedWonStage?.name,
            closedLostName: closedLostStage?.name,
        }),
    };
}

function buildDraftFromPreset(preset: PipelinePresetDefinition): PipelineDraft {
    return {
        activeStages: preset.activeStages.map((stage, index) => toDraftStage(stage, index)),
        includeClosingStages: true,
        closedWonName: preset.closedWonName,
        closedLostName: preset.closedLostName,
        selectedPreset: preset.id,
    };
}

export function FunnelEditorDialog({
    open,
    onOpenChange,
    stages,
    onStagesChanged,
}: FunnelEditorDialogProps) {
    const [draft, setDraft] = useState<PipelineDraft>(() => buildDraftFromStages(stages));
    const [isPending, startTransition] = useTransition();
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (open && !wasOpenRef.current) {
            setDraft(buildDraftFromStages(stages));
            setError(null);
            setActiveDragId(null);
        }

        wasOpenRef.current = open;
    }, [open, stages]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    const activeDragStage = useMemo(
        () => draft.activeStages.find((stage) => stage.localId === activeDragId) ?? null,
        [activeDragId, draft.activeStages]
    );

    const applyPreset = (presetId: PipelinePresetId) => {
        const preset = getPipelinePresetById(presetId);
        setDraft(buildDraftFromPreset(preset));
        setError(null);
    };

    const updateActiveStage = (localId: string, patch: Partial<DraftStage>) => {
        setDraft((current) => ({
            ...current,
            selectedPreset: "custom",
            activeStages: current.activeStages.map((stage) =>
                stage.localId === localId ? { ...stage, ...patch } : stage
            ),
        }));
    };

    const addStage = () => {
        setDraft((current) => ({
            ...current,
            selectedPreset: "custom",
            activeStages: [
                ...current.activeStages,
                {
                    localId: makeLocalStageId(),
                    name: "Nueva etapa",
                    color: getDefaultStageColor(current.activeStages.length),
                },
            ],
        }));
    };

    const removeStage = (localId: string) => {
        setDraft((current) => {
            if (current.activeStages.length <= 1) {
                return current;
            }

            return {
                ...current,
                selectedPreset: "custom",
                activeStages: current.activeStages.filter((stage) => stage.localId !== localId),
            };
        });
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDragId(null);

        if (!over || active.id === over.id) {
            return;
        }

        setDraft((current) => {
            const oldIndex = current.activeStages.findIndex(
                (stage) => stage.localId === active.id
            );
            const newIndex = current.activeStages.findIndex(
                (stage) => stage.localId === over.id
            );

            if (oldIndex === -1 || newIndex === -1) {
                return current;
            }

            return {
                ...current,
                selectedPreset: "custom",
                activeStages: arrayMove(current.activeStages, oldIndex, newIndex),
            };
        });
    };

    const handleSave = () => {
        setError(null);

        startTransition(async () => {
            const result = await savePipelineConfiguration({
                activeStages: draft.activeStages.map((stage) => ({
                    id: stage.id,
                    name: stage.name,
                    color: stage.color,
                })),
                includeClosingStages: draft.includeClosingStages,
                closedWonName: draft.closedWonName,
                closedLostName: draft.closedLostName,
                closedWonColor: DEFAULT_CLOSED_WON_COLOR,
                closedLostColor: DEFAULT_CLOSED_LOST_COLOR,
            });

            if (!result.success) {
                setError(result.error ?? "No se pudo guardar la configuracion del embudo.");
                return;
            }

            onStagesChanged();
            onOpenChange(false);
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[960px] gap-0 overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border px-6 py-5">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-semibold text-foreground">
                            Establece tu embudo
                        </h2>
                        <p className="max-w-2xl text-sm text-muted-foreground">
                            Define un flujo tipo Kommo con etapas predefinidas, pero manteniendo
                            siempre fijo a {DEFAULT_INCOMING_STAGE_NAME}. Las demas etapas las
                            puedes mover, quitar o adaptar a cada negocio.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={isPending}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={isPending}>
                            {isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            Guardar
                        </Button>
                    </div>
                </div>

                <div className="grid min-h-[640px] grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
                    <aside className="border-b border-border bg-muted/20 md:border-b-0 md:border-r">
                        <div className="px-5 py-5">
                            <p className="text-sm font-semibold text-foreground">Plantillas</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                Elige una base y luego ajustala libremente.
                            </p>
                        </div>

                        <ScrollArea className="h-[520px] px-3 pb-4 md:h-[580px]" type="always">
                            <div className="space-y-1.5 pr-2">
                                {PIPELINE_PRESETS.map((preset) => {
                                    const isSelected = draft.selectedPreset === preset.id;

                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyPreset(preset.id)}
                                            className={cn(
                                                "w-full rounded-2xl border px-4 py-3 text-left transition-all",
                                                isSelected
                                                    ? "border-primary bg-primary/10 shadow-sm"
                                                    : "border-transparent bg-transparent hover:border-border hover:bg-background"
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="space-y-1">
                                                    <p className="text-sm font-semibold text-foreground">
                                                        {preset.label}
                                                    </p>
                                                    <p className="text-xs leading-5 text-muted-foreground">
                                                        {preset.description}
                                                    </p>
                                                </div>
                                                {isSelected ? (
                                                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                                                ) : null}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </aside>

                    <ScrollArea className="h-[640px]" type="always">
                        <div className="space-y-6 px-6 py-6">
                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">
                                            Leads entrantes
                                        </p>
                                        <p className="text-xs leading-5 text-muted-foreground">
                                            Esta etapa es fija y captura todos los leads nuevos que
                                            llegan al CRM.
                                        </p>
                                    </div>
                                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                                        <Lock className="h-3.5 w-3.5" />
                                        Fija
                                    </div>
                                </div>

                                <StagePreviewCard
                                    name={DEFAULT_INCOMING_STAGE_NAME}
                                    color="#D1D5DB"
                                    textColor="#374151"
                                    locked
                                />
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-end justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">
                                            Etapas activas
                                        </p>
                                        <p className="text-xs leading-5 text-muted-foreground">
                                            Estas etapas si se pueden mover, renombrar y ajustar
                                            segun tu negocio.
                                        </p>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={addStage}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Agregar etapa
                                    </Button>
                                </div>

                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragStart={handleDragStart}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={draft.activeStages.map((stage) => stage.localId)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <div className="space-y-2">
                                            {draft.activeStages.map((stage, index) => (
                                                <SortableActiveStageCard
                                                    key={stage.localId}
                                                    stage={stage}
                                                    index={index}
                                                    disableRemove={draft.activeStages.length <= 1}
                                                    onNameChange={(value) =>
                                                        updateActiveStage(stage.localId, {
                                                            name: value,
                                                        })
                                                    }
                                                    onRemove={() => removeStage(stage.localId)}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>

                                    <DragOverlay>
                                        {activeDragStage ? (
                                            <StagePreviewCard
                                                name={activeDragStage.name}
                                                color={activeDragStage.color}
                                                textColor={getStageTextColor(activeDragStage.color)}
                                                dragging
                                            />
                                        ) : null}
                                    </DragOverlay>
                                </DndContext>
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-4">
                                    <div className="space-y-1">
                                        <p className="text-sm font-semibold text-foreground">
                                            Etapas de cierre
                                        </p>
                                        <p className="text-xs leading-5 text-muted-foreground">
                                            Activalas si quieres terminar el flujo con ganado y
                                            perdido. Si las desactivas, los leads que esten ahi
                                            volveran a {DEFAULT_INCOMING_STAGE_NAME} al guardar.
                                        </p>
                                    </div>
                                    <Switch
                                        checked={draft.includeClosingStages}
                                        onCheckedChange={(checked) => {
                                            setDraft((current) => ({
                                                ...current,
                                                selectedPreset: "custom",
                                                includeClosingStages: checked,
                                            }));
                                        }}
                                    />
                                </div>

                                {draft.includeClosingStages ? (
                                    <div className="space-y-2">
                                        <ClosingStageCard
                                            icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" />}
                                            label="Cierre ganado"
                                            value={draft.closedWonName}
                                            color={DEFAULT_CLOSED_WON_COLOR}
                                            onChange={(value) =>
                                                setDraft((current) => ({
                                                    ...current,
                                                    selectedPreset: "custom",
                                                    closedWonName: value,
                                                }))
                                            }
                                        />
                                        <ClosingStageCard
                                            icon={<XCircle className="h-4 w-4 text-slate-600" />}
                                            label="Cierre perdido"
                                            value={draft.closedLostName}
                                            color={DEFAULT_CLOSED_LOST_COLOR}
                                            onChange={(value) =>
                                                setDraft((current) => ({
                                                    ...current,
                                                    selectedPreset: "custom",
                                                    closedLostName: value,
                                                }))
                                            }
                                        />
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                                        El embudo se guardara sin etapas de cierre al final.
                                    </div>
                                )}
                            </section>

                            {error ? (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    {error}
                                </div>
                            ) : null}

                            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                Si eliminas o reemplazas una etapa, los leads que estaban ahi se
                                moveran automaticamente a {DEFAULT_INCOMING_STAGE_NAME}.
                            </div>
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function StagePreviewCard({
    name,
    color,
    textColor,
    locked = false,
    dragging = false,
}: {
    name: string;
    color: string;
    textColor: string;
    locked?: boolean;
    dragging?: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-2xl border border-border/70 px-4 py-3 shadow-sm",
                dragging && "shadow-xl"
            )}
            style={{
                backgroundColor: color,
                color: textColor,
            }}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <GripVertical className="h-4 w-4 opacity-60" />
                    <span className="text-sm font-semibold">{name}</span>
                </div>
                {locked ? (
                    <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        Fija
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function SortableActiveStageCard({
    stage,
    index,
    disableRemove,
    onNameChange,
    onRemove,
}: {
    stage: DraftStage;
    index: number;
    disableRemove: boolean;
    onNameChange: (value: string) => void;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: stage.localId });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
    };

    const textColor = getStageTextColor(stage.color);

    return (
        <div ref={setNodeRef} style={style}>
            <div
                className="rounded-2xl border border-border/70 px-4 py-3 shadow-sm"
                style={{
                    backgroundColor: stage.color,
                    color: textColor,
                }}
            >
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        className="cursor-grab rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100"
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>

                    <span className="rounded-full bg-white/65 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                        Etapa {index + 1}
                    </span>

                    <input
                        value={stage.name}
                        onChange={(event) => onNameChange(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-current/60"
                        placeholder="Nombre de la etapa"
                    />

                    <button
                        type="button"
                        onClick={onRemove}
                        disabled={disableRemove}
                        className="rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                            disableRemove
                                ? "Debes conservar al menos una etapa activa"
                                : "Eliminar etapa"
                        }
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function ClosingStageCard({
    icon,
    label,
    value,
    color,
    onChange,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    color: string;
    onChange: (value: string) => void;
}) {
    const textColor = getStageTextColor(color);

    return (
        <div
            className="rounded-2xl border border-border/70 px-4 py-3 shadow-sm"
            style={{ backgroundColor: color, color: textColor }}
        >
            <div className="flex items-center gap-3">
                <div className="rounded-full bg-white/65 p-1.5">{icon}</div>
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
                        {label}
                    </p>
                    <Input
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        className="mt-1 h-9 border-0 bg-white/60 px-3 text-sm font-semibold shadow-none"
                        placeholder="Nombre de la etapa de cierre"
                    />
                </div>
            </div>
        </div>
    );
}
