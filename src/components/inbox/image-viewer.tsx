"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Message, Conversation } from "@/app/dashboard/inbox/page";

interface ImageViewerProps {
    conversation: Conversation;
    messages: Message[];
    initialMessageId: string;
    onClose: () => void;
}

export function ImageViewer({ conversation, messages, initialMessageId, onClose }: ImageViewerProps) {
    // Stable reference for filtered image messages
    const imageMessages = useMemo(
        () => messages.filter(msg => msg.type === "image" && Boolean(msg.mediaUrl)),
        [messages]
    );

    // Calculate initial index synchronously (not in useEffect)
    const initialIndex = useMemo(() => {
        const idx = imageMessages.findIndex(msg => msg.id === initialMessageId);
        return idx !== -1 ? idx : 0;
    }, [initialMessageId, imageMessages]);

    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft") handlePrev();
            if (e.key === "ArrowRight") handleNext();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentIndex, imageMessages.length]);

    if (imageMessages.length === 0) return null;

    const currentMsg = imageMessages[currentIndex];

    // Clean URL for localhost / Mixed Content / Docker standalone
    const getCleanMediaUrl = (url: string | null | undefined) => {
        if (!url) return "";
        let cleanUrl = url;
        if (typeof window !== "undefined") {
            const origin = window.location.origin;
            if (cleanUrl.startsWith(origin)) {
                cleanUrl = cleanUrl.replace(origin, "");
            }
        }
        if (cleanUrl.includes("localhost:3000")) {
            cleanUrl = cleanUrl.replace(/https?:\/\/localhost:3000/, "");
        }
        if (cleanUrl.includes("/uploads/") && cleanUrl.startsWith("http")) {
            cleanUrl = cleanUrl.substring(cleanUrl.indexOf("/uploads/"));
        }
        if (cleanUrl.startsWith("/uploads/")) {
            const filename = cleanUrl.substring("/uploads/".length);
            return `/api/media/${filename}`;
        }
        return cleanUrl;
    };

    const currentUrl = getCleanMediaUrl(currentMsg.mediaUrl);

    // Sender resolution for the top bar
    const isOutbound = currentMsg.direction === "outbound";
    const senderName = isOutbound ? "Tú" : (conversation.contact?.name || formatPhone(conversation.contact?.phone) || "Desconocido");
    const senderInitials = senderName.charAt(0).toUpperCase();

    const handleNext = () => {
        if (currentIndex < imageMessages.length - 1) setCurrentIndex(prev => prev + 1);
    };

    const handlePrev = () => {
        if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
    };

    const handleDownload = () => {
        // Native download approach
        const link = document.createElement("a");
        link.href = currentUrl;
        link.download = currentMsg.mediaFileName || `imagen-${currentMsg.id}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 bg-opacity-95 backdrop-blur-sm text-white select-none">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-white/10">
                        <AvatarFallback className="bg-primary text-primary-foreground">
                            {senderInitials}
                        </AvatarFallback>
                    </Avatar>
                    <div>
                        <p className="font-semibold text-sm">{senderName}</p>
                        <p className="text-xs text-white/60">
                            {new Date(currentMsg.createdAt).toLocaleString([], {
                                day: 'numeric',
                                month: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={handleDownload} title="Descargar">
                        <Download className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onClose} title="Cerrar">
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            </div>

            {/* Main Image View */}
            <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4">
                {/* Previous Button */}
                {currentIndex > 0 && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute left-4 z-10 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/80 flex items-center justify-center transition-all"
                        onClick={handlePrev}
                    >
                        <ChevronLeft className="h-6 w-6" />
                    </Button>
                )}

                <img
                    src={currentUrl}
                    alt="Viewer"
                    className="max-h-full max-w-full object-contain cursor-default"
                    onClick={(e) => e.stopPropagation()}
                    draggable={false}
                />

                {/* Content caption if exists */}
                {currentMsg.content && !["[Imagen]", "[Sticker]", "[image]"].includes(currentMsg.content) && (
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
                        <p className="px-4 py-2 bg-black/60 rounded-lg text-sm max-w-2xl text-center shadow-lg">
                            {currentMsg.content}
                        </p>
                    </div>
                )}

                {/* Next Button */}
                {currentIndex < imageMessages.length - 1 && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 z-10 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/80 flex items-center justify-center transition-all"
                        onClick={handleNext}
                    >
                        <ChevronRight className="h-6 w-6" />
                    </Button>
                )}
            </div>

            {/* Bottom Thumbnail Carousel ONLY if multiple images */}
            {imageMessages.length > 1 && (
                <div className="h-24 min-h-[96px] bg-black/50 border-t border-white/10 flex items-center px-4 overflow-x-auto gap-2 thumbnail-scroll">
                    {imageMessages.map((msg, index) => {
                        const url = getCleanMediaUrl(msg.mediaUrl);
                        const isSelected = index === currentIndex;
                        return (
                            <div
                                key={msg.id}
                                className={cn(
                                    "relative h-16 w-16 shrink-0 cursor-pointer rounded-md overflow-hidden transition-all duration-200 border-2",
                                    isSelected ? "border-white scale-105 opacity-100" : "border-transparent opacity-50 hover:opacity-100"
                                )}
                                onClick={() => setCurrentIndex(index)}
                            >
                                <img src={url} alt="Thumbnail" className="h-full w-full object-cover" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// Helper specific to viewer
function formatPhone(phone: string | null | undefined): string {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 12 && cleaned.startsWith("52")) {
        return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    }
    return `+${cleaned}`;
}
