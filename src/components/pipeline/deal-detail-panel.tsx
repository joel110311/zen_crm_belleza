"use client";

import React, { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Phone, Mail, Building2, Calendar, Pencil, Trash2, Save, Plus, Tag as TagIcon } from "lucide-react";
import { updateDeal, deleteDeal, getAllTags, createTag, addTagToDeal, removeTagFromDeal, deleteTag } from "@/app/actions/pipeline";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { formatDateTimeInOperationZone } from "@/lib/operation-dates";
import type { DealData } from "./pipeline-board";

interface DealDetailPanelProps {
    deal: DealData;
    onClose: () => void;
    onUpdate: (deal: DealData) => void;
    onDelete: (dealId: string) => void;
}

interface TagData {
    id: string;
    name: string;
    color: string;
}

const LEAD_STATUS_LABELS: Record<string, string> = {
    nuevo: "Nuevo",
    interesado: "Interesado",
    calificado: "Calificado",
};

const LEAD_STEP_LABELS: Record<string, string> = {
    inicio: "Inicio",
    interes: "Interes detectado",
    captura_nombre: "Captura de nombre",
    captura_email: "Captura de correo",
    calificado: "Lead calificado",
};

export function DealDetailPanel({ deal, onClose, onUpdate, onDelete }: DealDetailPanelProps) {
    const operationContext = useOperationContext();
    const router = useRouter();
    const [editTitle, setEditTitle] = useState(deal.title);
    const [editValue, setEditValue] = useState(deal.value.toString());
    const [editNotes, setEditNotes] = useState(deal.notes || "");
    const [editPriority, setEditPriority] = useState(deal.priority);
    const [isPending, startTransition] = useTransition();

    // Tags state
    const [allTags, setAllTags] = useState<TagData[]>([]);
    const [dealTagIds, setDealTagIds] = useState<string[]>(
        deal.dealTags?.map((dt) => dt.tag.id) || []
    );
    const [newTagName, setNewTagName] = useState("");
    const [showTagInput, setShowTagInput] = useState(false);

    const contactName = [deal.contact?.name, deal.contact?.lastName].filter(Boolean).join(" ") || "Sin nombre";
    const assignedTags = allTags.filter((t) => dealTagIds.includes(t.id));
    const availableTags = allTags.filter((t) => !dealTagIds.includes(t.id));
    const intelligence = deal.intelligence ?? null;
    const leadStatusLabel = intelligence ? (LEAD_STATUS_LABELS[intelligence.interestStatus] || intelligence.interestStatus) : "Sin scoring";
    const leadStepLabel = intelligence ? (LEAD_STEP_LABELS[intelligence.currentStep] || intelligence.currentStep) : "Sin paso";

    // Fetch all tags on mount
    useEffect(() => {
        startTransition(async () => {
            const tags = await getAllTags();
            setAllTags(tags as TagData[]);
        });
    }, []);

    // Only reset the form when the user opens a different lead.
    useEffect(() => {
        setEditTitle(deal.title);
        setEditValue(deal.value.toString());
        setEditNotes(deal.notes || "");
        setEditPriority(deal.priority);
        setDealTagIds(deal.dealTags?.map((dt) => dt.tag.id) || []);
    }, [deal.id]);

    const handleSave = () => {
        startTransition(async () => {
            const result = await updateDeal(deal.id, {
                title: editTitle,
                value: parseFloat(editValue) || 0,
                notes: editNotes || undefined,
                priority: editPriority,
            });
            if (result.success && result.deal) {
                onUpdate({
                    ...deal,
                    title: editTitle,
                    value: parseFloat(editValue) || 0,
                    notes: editNotes,
                    priority: editPriority,
                });
            }
        });
    };

    const handleDelete = async () => {
        if (!window.confirm("¿Estás seguro de eliminar este lead?")) return;
        try {
            const result = await deleteDeal(deal.id);
            if (result.success) {
                onDelete(deal.id);
                onClose();
            } else {
                alert("Error al eliminar: " + (result.error || "Error desconocido"));
            }
        } catch (err) {
            console.error("Delete failed:", err);
            alert("Error al eliminar el lead");
        }
    };

    const handleAddTag = (tagId: string) => {
        setDealTagIds((prev) => [...prev, tagId]);
        startTransition(async () => {
            await addTagToDeal(deal.id, tagId);
        });
    };

    const handleRemoveTag = (tagId: string) => {
        setDealTagIds((prev) => prev.filter((id) => id !== tagId));
        startTransition(async () => {
            await removeTagFromDeal(deal.id, tagId);
        });
    };

    const handleDeleteTag = async (tagId: string) => {
        if (!window.confirm("¿Seguro que deseas eliminar esta etiqueta del sistema? Se eliminará de todos los leads.")) return;

        // Optimistic update
        setAllTags((prev) => prev.filter((t) => t.id !== tagId));
        setDealTagIds((prev) => prev.filter((id) => id !== tagId));

        startTransition(async () => {
            const result = await deleteTag(tagId);
            if (!result.success) {
                alert("Error al eliminar etiqueta: " + result.error);
            }
        });
    };

    const handleCreateTag = () => {
        if (!newTagName.trim()) return;
        const colors = ["#3B82F6", "#F59E0B", "#0EA5E9", "#EC4899", "#6366F1", "#0891B2", "#F97316"];
        const color = colors[Math.floor(Math.random() * colors.length)];
        startTransition(async () => {
            const result = await createTag(newTagName.trim(), color);
            if (result.success && result.tag) {
                const tag = result.tag as TagData;
                setAllTags((prev) => [...prev, tag]);
                setDealTagIds((prev) => [...prev, tag.id]);
                await addTagToDeal(deal.id, tag.id);
                setNewTagName("");
                setShowTagInput(false);
            }
        });
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel */}
            <div
                className="fixed right-0 top-0 h-full z-50 overflow-y-auto w-full sm:w-[420px] bg-card border-l border-border shadow-2xl"
                style={{ animation: "slideIn 0.2s ease-out" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 sticky top-0 z-10 bg-card border-b border-border">
                    <h2 className="text-lg font-bold text-foreground">
                        Detalle del Lead
                    </h2>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={isPending}
                            className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            <Save className="h-3.5 w-3.5 mr-1" />
                            Guardar
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onClose}
                            className="h-8 w-8 p-0"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="px-6 py-5 space-y-6">
                    {/* Title & Value */}
                    <div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Título</label>
                                <Input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Valor ($)</label>
                                <Input
                                    type="number"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Prioridad</label>
                                <select
                                    value={editPriority}
                                    onChange={(e) => setEditPriority(e.target.value)}
                                    className="mt-1 w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground"
                                >
                                    <option value="low">Baja</option>
                                    <option value="medium">Media</option>
                                    <option value="high">Alta</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Stage */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border">
                        <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: deal.stage?.color || "#64748B" }}
                        />
                        <div>
                            <p className="text-xs text-muted-foreground">Etapa actual</p>
                            <p className="text-sm font-semibold text-foreground">
                                {deal.stage?.name || "Sin etapa"}
                            </p>
                        </div>
                    </div>

                    {intelligence && (
                        <div className="rounded-xl border border-border bg-secondary p-4 space-y-4">
                            <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-[0.18em]">
                                    Inteligencia comercial
                                </p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-border bg-background/70 px-3 py-3">
                                    <p className="text-xs text-muted-foreground">Estado del lead</p>
                                    <p className="mt-1 text-sm font-semibold text-foreground">{leadStatusLabel}</p>
                                </div>
                                <div className="rounded-xl border border-border bg-background/70 px-3 py-3">
                                    <p className="text-xs text-muted-foreground">Paso actual</p>
                                    <p className="mt-1 text-sm font-semibold text-foreground">{leadStepLabel}</p>
                                </div>
                            </div>

                            <div className="rounded-xl border border-border bg-background/70 px-3 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">Puntuacion</p>
                                    <span className="text-sm font-semibold text-foreground">{intelligence.score}%</span>
                                </div>
                                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${Math.min(Math.max(intelligence.score, 0), 100)}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {intelligence.sameDayInboundCount} mensajes del cliente detectados hoy.
                                </p>
                            </div>

                            <div className="rounded-xl border border-border bg-background/70 px-3 py-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">Progreso del paso</p>
                                    <span className="text-sm font-semibold text-foreground">{intelligence.stepProgress}%</span>
                                </div>
                                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary transition-all"
                                        style={{ width: `${Math.min(Math.max(intelligence.stepProgress, 0), 100)}%` }}
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-border bg-background/70 px-3 py-3 space-y-2">
                                <p className="text-xs text-muted-foreground uppercase tracking-[0.18em]">Datos capturados</p>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Nombre</span>
                                    <span className="font-medium text-foreground text-right">{intelligence.capturedName || deal.contact?.name || "-"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Email</span>
                                    <span className="font-medium text-foreground text-right">{intelligence.capturedEmail || deal.contact?.email || "-"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Telefono</span>
                                    <span className="font-medium text-foreground text-right">{deal.contact?.phone || "-"}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Contact Info */}
                    <div>
                        <h4 className="text-sm font-semibold mb-3 text-foreground">
                            Información del Contacto
                        </h4>
                        <div className="rounded-xl p-4 space-y-3 bg-secondary border border-border">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold bg-primary/10 text-primary">
                                    {contactName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-foreground">{contactName}</p>
                                    <p className="text-xs text-muted-foreground">Contacto</p>
                                </div>
                            </div>

                            {deal.contact?.phone && (
                                <div className="flex items-center gap-2">
                                    <Phone className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground/80">+{deal.contact.phone}</span>
                                    <button
                                        onClick={() => router.push(`/dashboard/inbox?contactId=${deal.contact!.id}`)}
                                        className="ml-auto text-xs font-medium px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                                    >
                                        <WhatsAppIcon className="mr-1 inline h-3 w-3" />
                                        Ir al Chat
                                    </button>
                                </div>
                            )}

                            {deal.contact?.email && (
                                <div className="flex items-center gap-2">
                                    <Mail className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground/80">{deal.contact.email}</span>
                                </div>
                            )}

                            {deal.contact?.company && (
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm text-foreground/80">{deal.contact.company}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Etiquetas (Tags) */}
                    <div>
                        <h4 className="text-sm font-semibold mb-3 text-foreground">
                            Etiquetas
                        </h4>
                        <div className="rounded-xl p-4 space-y-3 bg-secondary border border-border">
                            {/* Assigned tags */}
                            {assignedTags.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {assignedTags.map((tag) => (
                                        <span
                                            key={tag.id}
                                            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                                            style={{
                                                backgroundColor: tag.color + "18",
                                                color: tag.color,
                                                border: `1px solid ${tag.color}30`,
                                            }}
                                        >
                                            {tag.name}
                                            <button
                                                className="ml-0.5 hover:opacity-70"
                                                onClick={() => handleRemoveTag(tag.id)}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">Sin etiquetas</p>
                            )}

                            {/* Available tags dropdown */}
                            {availableTags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {availableTags.map((tag) => (
                                        <div
                                            key={tag.id}
                                            className="group flex items-center bg-accent rounded-full pl-2 pr-1 py-0.5 hover:bg-accent/80 transition-colors"
                                        >
                                            <button
                                                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                                                onClick={() => handleAddTag(tag.id)}
                                            >
                                                + {tag.name}
                                            </button>
                                            <button
                                                className="ml-1 p-0.5 text-muted-foreground hover:text-destructive rounded-full hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteTag(tag.id);
                                                }}
                                                title="Eliminar etiqueta del sistema"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Create new tag */}
                            {showTagInput ? (
                                <div className="flex gap-2">
                                    <Input
                                        value={newTagName}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        placeholder="Nombre de etiqueta"
                                        className="h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleCreateTag();
                                        }}
                                        autoFocus
                                    />
                                    <Button
                                        size="sm"
                                        className="h-8 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                                        onClick={handleCreateTag}
                                        disabled={isPending || !newTagName.trim()}
                                    >
                                        Crear
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2"
                                        onClick={() => { setShowTagInput(false); setNewTagName(""); }}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ) : (
                                <button
                                    className="flex items-center gap-1 text-xs font-medium hover:opacity-80 text-primary"
                                    onClick={() => setShowTagInput(true)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Nueva etiqueta
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <h4 className="text-sm font-semibold mb-2 text-foreground">
                            Notas
                        </h4>
                        <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="w-full h-24 p-3 text-sm rounded-xl resize-none border border-border bg-background text-foreground"
                            placeholder="Agregar notas sobre este lead..."
                        />
                    </div>

                    {/* Metadata */}
                    <div className="p-4 rounded-xl space-y-2 bg-secondary border border-border">
                        <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                                Creado: {formatDateTimeInOperationZone(deal.createdAt, operationContext.locale, operationContext.timeZone)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                Fuente: <span className="font-medium">{deal.source === "whatsapp" ? "📱 WhatsApp" : "✏️ Manual"}</span>
                            </span>
                        </div>
                    </div>

                    {/* Delete Button */}
                    <Button
                        variant="outline"
                        className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                        onClick={handleDelete}
                        disabled={isPending}
                    >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar Lead
                    </Button>
                </div>
            </div>

            <style jsx global>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </>
    );
}
