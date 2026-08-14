"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Phone } from "lucide-react";
import type { DealData } from "./pipeline-board";

interface DealCardProps {
    deal: DealData;
    onDealClick: (deal: DealData) => void;
    isOverlay?: boolean;
}

export function DealCard({ deal, onDealClick, isOverlay }: DealCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: deal.id,
        disabled: isOverlay,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const contactName = [deal.contact?.name, deal.contact?.lastName]
        .filter(Boolean)
        .join(" ") || "Sin nombre";
    const contactPhone = deal.contact?.phone || "";
    const messagePreview = deal.lastMessage?.trim() || "";
    const tags = deal.dealTags?.map((item) => item.tag) || [];
    const visibleTags = tags.slice(0, 2);
    const remainingTagCount = Math.max(0, tags.length - visibleTags.length);
    const hasTags = visibleTags.length > 0 || remainingTagCount > 0;
    const cardHeightClass = hasTags
        ? "h-[96px] min-h-[96px] max-h-[96px] py-1.5"
        : "h-[70px] min-h-[70px] max-h-[70px] py-1";

    // When this card is being dragged, show a dashed placeholder in its original spot
    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="h-[56px] rounded-lg border-2 border-dashed border-primary/30 bg-primary/5"
            />
        );
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className="cursor-pointer group"
            suppressHydrationWarning
            onClick={() => onDealClick(deal)}
        >
            <div
                className={`${cardHeightClass} overflow-hidden rounded-lg border border-border/75 bg-card px-2 transition-all duration-150 ${isOverlay ? "scale-105 rotate-[2deg] shadow-soft-hover" : "shadow-soft group-hover:border-primary/35 group-hover:shadow-soft-hover"
                    }`}
            >
                {/* Contact row: avatar + name/phone + value */}
                <div className="flex items-center gap-1.5">
                    <div
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary"
                    >
                        {contactName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
                            {contactName}
                        </p>
                        {contactPhone && (
                            <p className="truncate text-[11px] leading-tight text-muted-foreground">
                                <Phone className="h-2.5 w-2.5 inline mr-0.5" />
                                +{contactPhone}
                            </p>
                        )}
                    </div>
                    {deal.value > 0 && (
                        <span className="text-xs font-bold flex-shrink-0 text-foreground">
                            ${deal.value.toLocaleString("es-MX")}
                        </span>
                    )}
                </div>

                {/* Message preview */}
                <p
                    className={`truncate whitespace-nowrap text-[12px] text-muted-foreground ${hasTags ? "mt-0.5 leading-5" : "mt-0 leading-4"}`}
                    title={messagePreview || undefined}
                >
                    {messagePreview || "\u00A0"}
                </p>

                {/* Tags row */}
                {hasTags ? (
                    <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
                        {visibleTags.map((tag) => (
                            <span
                                key={tag.id}
                                className="max-w-[94px] truncate rounded-md px-2 py-[1px] text-[11px] font-medium leading-4"
                                style={{
                                    backgroundColor: `${tag.color}16`,
                                    color: tag.color,
                                    border: `1px solid ${tag.color}38`,
                                }}
                                title={tag.name}
                            >
                                {tag.name}
                            </span>
                        ))}
                        {remainingTagCount > 0 ? (
                            <span
                                className="shrink-0 rounded-md border border-border/70 px-1.5 py-[1px] text-[10px] font-medium text-muted-foreground"
                                title={`${remainingTagCount} etiqueta${remainingTagCount === 1 ? "" : "s"} adicional${remainingTagCount === 1 ? "" : "es"}`}
                            >
                                +{remainingTagCount}
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
