"use client";

import {
    BatteryFull,
    Camera,
    ChevronLeft,
    FileText,
    Image as ImageIcon,
    Mic,
    Phone,
    Plus,
    SignalHigh,
    Smile,
    Video,
    Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSafeMediaUrl } from "@/lib/media-url";
import { WhatsAppFormattedText } from "@/components/shared/whatsapp-formatted-text";

type WhatsAppTemplatePreviewProps = {
    title?: string;
    subtitle?: string;
    type: "text" | "image" | "document";
    content?: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    className?: string;
    showComposer?: boolean;
    density?: "default" | "compact";
};

const PHONE_WALLPAPER_PATTERN = `url("data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132" viewBox="0 0 132 132" fill="none">
  <g opacity="0.45" stroke="#D5C9BC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M26 18h24a8 8 0 0 1 8 8v12H34a8 8 0 0 1-8-8V18Z"/>
    <path d="M74 26c0-6.627 5.373-12 12-12h12c6.627 0 12 5.373 12 12v12H86c-6.627 0-12-5.373-12-12Z"/>
    <circle cx="28" cy="86" r="15"/>
    <path d="M80 78h24a8 8 0 0 1 8 8v18H88a8 8 0 0 1-8-8V78Z"/>
    <path d="m46 102 4-10 4 10m-9-4h10"/>
    <path d="m18 60 4 4 8-8"/>
    <path d="M90 56l3-7 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>
  </g>
</svg>
`)}")`;

export function WhatsAppTemplatePreview({
    title = "Vista previa",
    subtitle = "Plantilla de WhatsApp",
    type,
    content = "",
    mediaUrl,
    mediaType,
    mediaFileName,
    className,
    showComposer = true,
    density = "default",
}: WhatsAppTemplatePreviewProps) {
    const safeMediaUrl = getSafeMediaUrl(mediaUrl);
    const hasText = Boolean(content.trim());
    const isCompact = density === "compact";

    return (
        <div
            className={cn(
                "mx-auto w-full rounded-[2.35rem] bg-white p-2.5 shadow-[0_28px_70px_-36px_rgba(15,23,42,0.34)] ring-1 ring-slate-200/80",
                isCompact ? "max-w-[360px]" : "max-w-[428px]",
                className,
            )}
        >
            <div className="overflow-hidden rounded-[1.95rem] border border-slate-200 bg-white">
                <div className="relative border-b border-slate-100 bg-white px-4 pb-3 pt-2.5">
                    <div className="absolute left-1/2 top-2 h-6 w-28 -translate-x-1/2 rounded-full bg-slate-100 shadow-inner" />
                    <div className="mb-3 flex items-center justify-between text-slate-700">
                        <span className="text-[13px] font-semibold tracking-tight">23:02</span>
                        <div className="flex items-center gap-1.5 text-slate-600">
                            <SignalHigh className="h-3.5 w-3.5" />
                            <Wifi className="h-3.5 w-3.5" />
                            <BatteryFull className="h-3.5 w-3.5" />
                        </div>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-sky-500">
                        <ChevronLeft className="h-5 w-5" />
                        <div className="text-center">
                            <p className="text-[12px] font-semibold text-slate-700">{title}</p>
                            <p className="text-[10px] text-slate-400">{subtitle}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Video className="h-4.5 w-4.5" />
                            <Phone className="h-4.5 w-4.5" />
                        </div>
                    </div>
                </div>

                <div
                    className={cn(
                        "flex flex-col justify-between px-4 pb-4 pt-5",
                        isCompact ? "h-[28rem] sm:h-[30rem]" : "h-[35rem] sm:h-[37rem]",
                    )}
                    style={{
                        backgroundImage: `${PHONE_WALLPAPER_PATTERN}, linear-gradient(180deg, #efe5d9 0%, #e8ddd1 100%)`,
                        backgroundRepeat: "repeat, no-repeat",
                        backgroundSize: "132px 132px, cover",
                    }}
                >
                    <div className="flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex min-h-full flex-col justify-end pb-6 pt-20">
                            <div className="ml-auto w-[92%] rounded-[1.35rem] rounded-br-md bg-white shadow-[0_20px_40px_-28px_rgba(15,23,42,0.22)]">
                                {type === "image" ? (
                                    <div className="rounded-t-[1.45rem] px-3 pt-3">
                                        {safeMediaUrl ? (
                                            <img
                                                src={safeMediaUrl}
                                                alt={mediaFileName || "Vista previa"}
                                                className={cn(
                                                    "w-full rounded-[1rem] object-cover",
                                                    isCompact ? "h-32" : "h-44",
                                                )}
                                            />
                                        ) : (
                                            <div
                                                className={cn(
                                                    "flex w-full items-center justify-center rounded-[1rem] bg-slate-100 text-slate-400",
                                                    isCompact ? "h-32" : "h-44",
                                                )}
                                            >
                                                <ImageIcon className="h-9 w-9" />
                                            </div>
                                        )}
                                    </div>
                                ) : null}

                                {type === "document" ? (
                                    <div className="px-3 pt-3">
                                        <div className="flex items-center gap-3 rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                                                <FileText className="h-5 w-5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-semibold text-slate-800">
                                                    {mediaFileName || "Documento adjunto"}
                                                </p>
                                                <p className="truncate text-[11px] text-slate-500">
                                                    {mediaType || "application/octet-stream"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                <div className={cn("px-4 pb-3", type !== "text" ? "pt-3" : "pt-4")}>
                                    {hasText ? (
                                        <WhatsAppFormattedText text={content} className="text-[13px] leading-[1.55] text-slate-700" />
                                    ) : (
                                        <p className="text-[13px] text-slate-400">
                                            {type === "text" ? "Escribe el contenido de tu plantilla..." : "Sin mensaje adicional"}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {showComposer ? (
                        <div>
                            <div className="flex items-center gap-2 rounded-[1.7rem] bg-white px-3 py-2 shadow-[0_20px_40px_-28px_rgba(15,23,42,0.22)]">
                                <Plus className="h-4.5 w-4.5 text-sky-500" />
                                <div className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-[12px] text-slate-400">
                                    Type a message
                                </div>
                                <Smile className="h-4.5 w-4.5 text-sky-500" />
                                <Camera className="h-4.5 w-4.5 text-sky-500" />
                                <Mic className="h-4.5 w-4.5 text-emerald-500" />
                            </div>
                            <div className="mx-auto mt-4 h-1.5 w-20 rounded-full bg-slate-300/80" />
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
