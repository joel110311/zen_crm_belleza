"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    Search, MoreVertical, Phone, Video, Paperclip, Send, Mic, X,
    FileText, Download, Square, Star, BellOff, Bell, Archive, Trash2,
    Info, Users, MessageSquare, ChevronRight, ChevronDown, Mail, Tag, Clock,
    Eraser, Image as ImageIcon, Play, Pause, Bot, User as UserIcon, AlertTriangle, LayoutTemplate,
    Reply, Copy, SmilePlus, Forward, CheckCircle2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { maybePlayNotification } from "@/lib/notificationSounds";
import { ImageViewer } from "@/components/inbox/image-viewer";
import { TemplatePicker } from "@/components/inbox/template-picker";
import { WhatsAppFormattedText } from "@/components/shared/whatsapp-formatted-text";
import { getSafeMediaUrl } from "@/lib/media-url";
import { TemplateRecord, extractTemplateSlashQuery, renderTemplateContent } from "@/lib/templates";
import { writeUnreadCounts } from "@/lib/inbox-browser-badge";
import { parseInboundAdPreviewMessageContent } from "@/lib/inbound-ad-preview";
import { hasPermission } from "@/lib/permissions";
import { shiftDateKey } from "@/lib/calendar/business-hours";
import { MetaTemplateSendModal } from "@/components/inbox/ycloud-template-send-modal";
import { type GeneratedQuoteAsset, QuoteBuilderPanel } from "@/components/quotes/quote-builder-panel";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { buildOperationContext, formatPhoneForDisplay } from "@/lib/operation-context";
import {
    formatDateInOperationZone,
    formatRelativeOperationDate,
    formatTimeInOperationZone,
    getOperationDateKey,
    getOperationTodayKey,
} from "@/lib/operation-dates";
import { INBOX_DRAFT_STORAGE_KEY, type InboxDraftPayload } from "@/lib/inbox-drafts";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const REACTION_EMOJIS = [
    "👍", "👎", "❤️", "🩵", "🔥", "✨", "🎉", "👏",
    "😂", "🤣", "😅", "😮", "😯", "😢", "😭", "🙏",
    "😍", "😘", "😎", "🤔", "🫡", "🤝", "💯", "✅",
    "👀", "🙌", "👌", "💪", "🥳", "😴", "🤯", "😡",
];

const INBOX_CONVERSATION_LIMIT = 300;
const INBOX_MAX_LOADED_CONVERSATIONS = 5000;
const INBOX_MESSAGE_PAGE_SIZE = 75;
const INBOX_DELTA_POLL_INTERVAL_MS = 3000;
const INBOX_FULL_RESYNC_INTERVAL_MS = 60000;
const FALLBACK_INBOX_OPERATION = buildOperationContext();

// ──────────── Types ────────────
export type Message = {
    id: string;
    content: string;
    senderId: string | null;
    direction: string;
    createdAt: Date;
    type: string;
    status?: string | null;
    sourceType: "wuzapi" | "meta";
    sourceId?: string | null;
    senderType?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    reaction?: string | null;
};

type RawMessageRecord = {
    id: string;
    content: string;
    senderId?: string | null;
    direction: string;
    createdAt: string | Date;
    type: string;
    status?: string | null;
    sourceType?: "wuzapi" | "meta";
    sourceId?: string | null;
    senderType?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    reaction?: string | null;
};

function normalizeMessageRecord(raw: RawMessageRecord): Message {
    return {
        id: raw.id,
        content: raw.content,
        senderId: raw.senderId ?? null,
        direction: raw.direction,
        createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt),
        type: raw.type,
        status: raw.status ?? null,
        sourceType: raw.sourceType === "meta" ? "meta" : "wuzapi",
        sourceId: raw.sourceId ?? null,
        senderType: raw.senderType ?? null,
        mediaUrl: raw.mediaUrl ?? null,
        mediaType: raw.mediaType ?? null,
        mediaFileName: raw.mediaFileName ?? null,
        reaction: raw.reaction ?? null,
    };
}

function toIsoTimestamp(value: string | Date | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function toDisplayHost(url: string | undefined) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./i, "");
    } catch {
        return null;
    }
}

function isTemporaryMessage(message: Message) {
    return message.id.startsWith("temp-");
}

function normalizeComparableMediaUrl(mediaUrl?: string | null) {
    const trimmed = mediaUrl?.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed, "https://crm.local");
        return parsed.pathname + parsed.search;
    } catch {
        return trimmed.replace(/^https?:\/\/[^/]+/i, "");
    }
}

function areLikelySameMessage(left: Message, right: Message) {
    if (left.id === right.id) return true;

    const leftCreatedAt = left.createdAt instanceof Date ? left.createdAt.getTime() : new Date(left.createdAt).getTime();
    const rightCreatedAt = right.createdAt instanceof Date ? right.createdAt.getTime() : new Date(right.createdAt).getTime();
    const leftMediaUrl = normalizeComparableMediaUrl(left.mediaUrl);
    const rightMediaUrl = normalizeComparableMediaUrl(right.mediaUrl);

    return (
        left.direction === right.direction &&
        (left.senderType || null) === (right.senderType || null) &&
        left.type === right.type &&
        left.sourceType === right.sourceType &&
        (left.sourceId || null) === (right.sourceId || null) &&
        (left.content || "") === (right.content || "") &&
        leftMediaUrl === rightMediaUrl &&
        (left.mediaFileName || null) === (right.mediaFileName || null) &&
        Math.abs(leftCreatedAt - rightCreatedAt) <= 15000
    );
}

function replaceOptimisticMessage(
    prev: Message[],
    optimisticId: string,
    persistedMessage: Message,
) {
    let replaced = false;
    const next = prev.map((message) => {
        if (message.id === optimisticId) {
            replaced = true;
            return persistedMessage;
        }

        return message;
    });

    return collapseMessageDuplicates(replaced ? next : [...next, persistedMessage]);
}

function mergeFetchedMessages(prev: Message[], incoming: Message[]) {
    if (incoming.length === 0) return prev;

    const next = [...prev];

    for (const incomingMessage of incoming) {
        const exactIndex = next.findIndex((message) => message.id === incomingMessage.id);
        if (exactIndex >= 0) {
            next[exactIndex] = incomingMessage;
            continue;
        }

        const optimisticIndex = next.findIndex((message) =>
            isTemporaryMessage(message) && areLikelySameMessage(message, incomingMessage),
        );
        if (optimisticIndex >= 0) {
            next[optimisticIndex] = incomingMessage;
            continue;
        }

        next.push(incomingMessage);
    }

    return collapseMessageDuplicates(next);
}

function collapseMessageDuplicates(messages: Message[]) {
    const collapsed: Message[] = [];

    for (const message of messages) {
        const exactIndex = collapsed.findIndex((existing) => existing.id === message.id);
        if (exactIndex >= 0) {
            collapsed[exactIndex] = message;
            continue;
        }

        const optimisticMatchIndex = collapsed.findIndex((existing) =>
            existing.id !== message.id &&
            (isTemporaryMessage(existing) || isTemporaryMessage(message)) &&
            areLikelySameMessage(existing, message),
        );

        if (optimisticMatchIndex >= 0) {
            const existing = collapsed[optimisticMatchIndex];
            collapsed[optimisticMatchIndex] = isTemporaryMessage(existing) && !isTemporaryMessage(message)
                ? message
                : existing;
            continue;
        }

        collapsed.push(message);
    }

    collapsed.sort((left, right) => {
        const timeDelta = left.createdAt.getTime() - right.createdAt.getTime();
        if (timeDelta !== 0) return timeDelta;
        return left.id.localeCompare(right.id);
    });
    return collapsed;
}

export type Conversation = {
    id: string;
    contact: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        company?: string | null;
        status: string | null;
        avatarUrl?: string | null;
    } | null;
    messages: Message[];
    updatedAt: Date;
    serverUpdatedAt?: Date;
    status: string;
    isMuted: boolean;
    isFavorite: boolean;
    isGroup: boolean;
    sourceType: "wuzapi" | "meta";
    sourceId?: string | null;
    botActive: boolean;
    assignedUserId?: string | null;
    assignedUser?: TeamUser | null;
    lastMessageType: string;
    sessionExpiresAt?: string | null;
    leadIntelligence?: LeadIntelligenceSnapshot | null;
    currentDeal?: {
        id: string;
        stageName: string | null;
    } | null;
};

type TeamUser = {
    id: string;
    name: string | null;
    email: string;
    role: string;
};

type WhatsAppSessionStatus = {
    configured: boolean;
    connected?: boolean;
    loggedIn?: boolean;
    jid?: string | null;
    qrCode?: string | null;
    metaConfigured?: boolean;
    metaConnected?: boolean;
    phoneNumberId?: string | null;
    error?: string;
};

function readOptionalBoolean(payload: unknown, keys: string[]) {
    if (!payload || typeof payload !== "object") return undefined;
    const record = payload as Record<string, unknown>;

    for (const key of keys) {
        const value = record[key];
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes", "connected", "loggedin"].includes(normalized)) return true;
            if (["false", "0", "no", "disconnected", "loggedout"].includes(normalized)) return false;
        }
        if (typeof value === "number") return value === 1;
    }

    return undefined;
}

function readOptionalString(payload: unknown, keys: string[]) {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;

    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    return null;
}

function parseStoredInboxDraft(raw: string | null): InboxDraftPayload | null {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<InboxDraftPayload>;
        const mediaCategory = parsed.mediaCategory || "document";
        const isKnownMediaCategory = ["image", "video", "audio", "document"].includes(mediaCategory);
        const normalizedMediaCategory = mediaCategory as InboxDraftPayload["mediaCategory"];

        if (
            typeof parsed.conversationId === "string" &&
            (typeof parsed.content === "string" || typeof parsed.mediaUrl === "string") &&
            isKnownMediaCategory
        ) {
            return {
                conversationId: parsed.conversationId,
                content: typeof parsed.content === "string" ? parsed.content : "",
                mediaUrl: typeof parsed.mediaUrl === "string" ? parsed.mediaUrl : "",
                fileName: typeof parsed.fileName === "string" ? parsed.fileName : "",
                mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : "",
                mediaCategory: normalizedMediaCategory,
                previewUrl: typeof parsed.previewUrl === "string" ? parsed.previewUrl : undefined,
                createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
                source: parsed.source || "manual",
            };
        }
    } catch (error) {
        console.error("Failed to parse inbox draft:", error);
    }

    return null;
}

type LeadIntelligenceSnapshot = {
    score: number;
    interestStatus: string;
    currentStep: string;
    stepProgress: number;
    capturedName: string | null;
    capturedEmail: string | null;
    sameDayInboundCount: number;
};

type ConfirmActionState = {
    kind?: "conversation" | "message";
    type: string;
    title: string;
    desc: string;
    messageId?: string;
};

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

type ConversationRecord = {
    id: string;
    contactId?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    contactCompany?: string | null;
    contactStatus?: string | null;
    contactAvatarUrl?: string | null;
    lastMessage?: string | null;
    lastMessageTime?: string | Date | null;
    updatedAt?: string | Date | null;
    lastMessageDirection?: string | null;
    lastMessageType?: string | null;
    lastMessageSenderType?: string | null;
    sourceType?: "wuzapi" | "meta" | null;
    sourceId?: string | null;
    lastMessageSourceType?: "wuzapi" | "meta" | null;
    lastMessageSourceId?: string | null;
    status?: string | null;
    isMuted?: boolean;
    isFavorite?: boolean;
    isGroup?: boolean;
    botActive?: boolean | null;
    assignedUserId?: string | null;
    assignedUser?: TeamUser | null;
    leadIntelligence?: LeadIntelligenceSnapshot | null;
    currentDeal?: Conversation["currentDeal"];
    sessionExpiresAt?: string | null;
};

function transformConversation(conv: ConversationRecord): Conversation {
    const previewMessageTime = conv.lastMessageTime ? new Date(conv.lastMessageTime) : new Date();
    const serverUpdatedAt = conv.updatedAt ? new Date(conv.updatedAt) : previewMessageTime;
    return {
        id: conv.id,
        contact: {
            id: conv.contactId || conv.id,
            name: conv.contactName ?? null,
            phone: conv.contactPhone || null,
            email: conv.contactEmail || null,
            company: conv.contactCompany || null,
            status: conv.contactStatus || null,
            avatarUrl: conv.contactAvatarUrl || null,
        },
        messages: conv.lastMessage ? [{
            id: `preview-${conv.id}`,
            content: conv.lastMessage,
            createdAt: previewMessageTime,
            senderId: null,
            direction: conv.lastMessageDirection || "inbound",
            type: conv.lastMessageType || "text",
            sourceType: conv.lastMessageSourceType === "meta" ? "meta" : "wuzapi",
            sourceId: conv.lastMessageSourceId || null,
            senderType: conv.lastMessageSenderType || null,
        }] : [],
        updatedAt: previewMessageTime,
        serverUpdatedAt,
        status: conv.status || "active",
        isMuted: conv.isMuted || false,
        isFavorite: conv.isFavorite || false,
        isGroup: conv.isGroup || false,
        sourceType: conv.sourceType === "meta" ? "meta" : "wuzapi",
        sourceId: conv.sourceId || null,
        botActive: conv.botActive ?? true,
        assignedUserId: conv.assignedUserId ?? null,
        assignedUser: conv.assignedUser ?? null,
        lastMessageType: conv.lastMessageType || "text",
        sessionExpiresAt: typeof conv.sessionExpiresAt === "string" ? conv.sessionExpiresAt : null,
        leadIntelligence: conv.leadIntelligence ?? null,
        currentDeal: conv.currentDeal ?? null,
    };
}

function getConversationSortTime(conversation: Conversation) {
    return (conversation.serverUpdatedAt || conversation.updatedAt).getTime();
}

function mergeConversationSnapshots(
    existing: Conversation[],
    incoming: Conversation[],
) {
    const mergedById = new Map(existing.map((conversation) => [conversation.id, conversation]));
    for (const conversation of incoming) {
        mergedById.set(conversation.id, conversation);
    }

    return Array.from(mergedById.values())
        .sort((left, right) => getConversationSortTime(right) - getConversationSortTime(left))
        .slice(0, INBOX_MAX_LOADED_CONVERSATIONS);
}

function getOldestConversationCursor(items: Conversation[]) {
    const oldest = items[items.length - 1];
    return oldest ? toIsoTimestamp(oldest.serverUpdatedAt || oldest.updatedAt) : null;
}

// ──────────── WhatsApp Text Formatter ────────────
function formatWhatsAppText(text: string): React.ReactNode {
    if (!text) return null;
    // Split by newlines first to preserve line breaks
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
        // Parse inline formatting: *bold*, _italic_, ~strikethrough~
        const parts: React.ReactNode[] = [];
        const remaining = line;
        let partKey = 0;
        const regex = /(\*([^*]+)\*)|(_([^_]+)_)|(~([^~]+)~)/g;
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(remaining)) !== null) {
            if (match.index > lastIndex) {
                parts.push(<React.Fragment key={partKey++}>{remaining.slice(lastIndex, match.index)}</React.Fragment>);
            }
            if (match[1]) {
                parts.push(<strong key={partKey++}>{match[2]}</strong>);
            } else if (match[3]) {
                parts.push(<em key={partKey++}>{match[4]}</em>);
            } else if (match[5]) {
                parts.push(<s key={partKey++}>{match[6]}</s>);
            }
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < remaining.length) {
            parts.push(<React.Fragment key={partKey++}>{remaining.slice(lastIndex)}</React.Fragment>);
        }
        return (
            <React.Fragment key={lineIdx}>
                {parts.length > 0 ? parts : line}
                {lineIdx < lines.length - 1 && <br />}
            </React.Fragment>
        );
    });
}
// ──────────── Helpers ────────────
function formatPhone(phone: string | null | undefined, defaultCountryCode?: string | null): string {
    return formatPhoneForDisplay(phone, defaultCountryCode);
}

function fileExtensionFromMimeType(mimeType: string | null | undefined): string {
    if (!mimeType) return "png";

    const [type, subtype = "png"] = mimeType.split("/");
    if (type !== "image") return "bin";

    if (subtype.includes("png")) return "png";
    if (subtype.includes("jpeg") || subtype.includes("jpg")) return "jpg";
    if (subtype.includes("webp")) return "webp";
    if (subtype.includes("gif")) return "gif";
    if (subtype.includes("bmp")) return "bmp";

    return subtype.replace(/[^a-z0-9]/gi, "") || "png";
}

function formatConversationListTimestamp(
    value: Date | string | null | undefined,
    locale = FALLBACK_INBOX_OPERATION.locale,
    timeZone = FALLBACK_INBOX_OPERATION.timeZone,
): string {
    if (!value) return "";

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return formatRelativeOperationDate(date, locale, timeZone);
}

// Deterministic color for avatar based on name
const AVATAR_COLORS = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-pink-500", "bg-teal-500",
    "bg-indigo-500", "bg-orange-500", "bg-lime-600", "bg-fuchsia-500",
];
function getAvatarColor(name: string | null | undefined): string {
    if (!name) return "bg-muted-foreground";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getLastMessagePreview(conv: Conversation): string {
    const msg = conv.messages[0];
    if (!msg) return "Sin mensajes";
    if (conv.lastMessageType === "image") return "📷 Imagen";
    if (conv.lastMessageType === "audio") return "🎙️ Audio";
    if (conv.lastMessageType === "video") return "🎥 Video";
    if (conv.lastMessageType === "document") return "📄 Documento";
    return msg.content || "Sin mensajes";
}

function getMessageResponderLabel(message: Message | undefined): "IA" | "Humano" | null {
    if (!message || message.direction !== "outbound") return null;
    if (message.senderType === "bot") return "IA";
    if (message.senderType === "human") return "Humano";
    return null;
}

function getConversationModeLabel(conversation: Conversation): "IA" | "H" {
    return conversation.botActive ? "IA" : "H";
}

function MessageResponderBadge({ label, compact = false }: { label: "IA" | "Humano" | "H"; compact?: boolean }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border font-semibold leading-none shadow-sm",
                label === "IA"
                    ? "border-emerald-400/30 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "border-amber-400/35 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300",
                label === "Humano"
                    ? "tracking-[0.02em]"
                    : "uppercase tracking-[0.12em]",
                compact
                    ? "px-1.5 py-0.5 text-[9px]"
                    : label === "Humano"
                        ? "mb-1 px-2 py-0.5 text-[9px]"
                        : "mb-1 px-2.5 py-0.5 text-[9px]",
            )}
        >
            {label}
        </span>
    );
}

function ConversationSourceIcon({
    sourceType,
    className,
}: {
    sourceType: Conversation["sourceType"];
    className?: string;
}) {
    const isMeta = sourceType === "meta";
    const Icon = isMeta ? CheckCircle2 : MessageSquare;

    return (
        <span
            title={isMeta ? "WhatsApp API oficial" : "WhatsApp por QR"}
            className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border shadow-sm ring-2 ring-background",
                isMeta
                    ? "border-emerald-500/25 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "border-green-500/25 bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300",
                className,
            )}
        >
            <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
    );
}

// ──────────── Media Renderer ────────────
function getCleanMediaUrl(url: string | null | undefined): string | undefined {
    return getSafeMediaUrl(url);
}

// ──────────── WhatsApp-style Audio Player ────────────
function AudioPlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);
    const durationProbeAttemptedRef = useRef(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [reportedDuration, setReportedDuration] = useState(0);
    const [visualDuration, setVisualDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        durationProbeAttemptedRef.current = false;

        const updateVisualDuration = (time: number, mediaDuration: number, ended = false) => {
            setVisualDuration((prev) => {
                const hasFiniteDuration = Number.isFinite(mediaDuration) && mediaDuration > 0;
                if (hasFiniteDuration) {
                    return Math.max(prev, mediaDuration);
                }
                if (ended) {
                    return Math.max(prev, time);
                }
                // Keep a small headroom for streams that initially report Infinity.
                return Math.max(prev, time + 1.5);
            });
        };

        const probeStreamingDuration = () => {
            if (durationProbeAttemptedRef.current) return;
            if (audio.currentTime > 0.01) return;
            if (audio.readyState < 1) return;

            durationProbeAttemptedRef.current = true;
            const restorePosition = () => {
                const resolvedDuration = audio.duration;
                if (Number.isFinite(resolvedDuration) && resolvedDuration > 0) {
                    setReportedDuration((prev) => Math.max(prev, resolvedDuration));
                    updateVisualDuration(audio.currentTime || 0, resolvedDuration, false);
                }
                try {
                    audio.currentTime = 0;
                } catch {
                    // Best effort only.
                }
                audio.removeEventListener("timeupdate", restorePosition);
            };

            audio.addEventListener("timeupdate", restorePosition);
            try {
                // Some OGG/stream responses expose a finite duration only after a far seek.
                audio.currentTime = 1e101;
            } catch {
                audio.removeEventListener("timeupdate", restorePosition);
            }
        };

        const syncDuration = () => {
            const d = audio.duration;
            if (Number.isFinite(d) && d > 0) {
                setReportedDuration((prev) => Math.max(prev, d));
                updateVisualDuration(audio.currentTime || 0, d);
                return;
            }
            probeStreamingDuration();
        };

        const onTimeUpdate = () => {
            const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
            const d = Number.isFinite(audio.duration) ? audio.duration : 0;
            setCurrentTime(t);
            updateVisualDuration(t, d);
        };

        const onEnded = () => {
            const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
            const d = Number.isFinite(audio.duration) ? audio.duration : 0;
            const finalTime = d > 0 ? d : t;
            updateVisualDuration(finalTime, finalTime, true);
            setReportedDuration((prev) => Math.max(prev, finalTime));
            setIsPlaying(false);
            setCurrentTime(finalTime);
        };

        const onPlay = () => setIsPlaying(true);
        const onPause = () => {
            if (!audio.ended) setIsPlaying(false);
        };
        const onSeeked = () => {
            const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
            const d = Number.isFinite(audio.duration) ? audio.duration : 0;
            setCurrentTime(t);
            updateVisualDuration(t, d);
        };

        audio.addEventListener("loadeddata", syncDuration);
        audio.addEventListener("loadedmetadata", syncDuration);
        audio.addEventListener("durationchange", syncDuration);
        audio.addEventListener("canplay", syncDuration);
        audio.addEventListener("progress", syncDuration);
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("seeked", onSeeked);
        return () => {
            audio.removeEventListener("loadeddata", syncDuration);
            audio.removeEventListener("loadedmetadata", syncDuration);
            audio.removeEventListener("durationchange", syncDuration);
            audio.removeEventListener("canplay", syncDuration);
            audio.removeEventListener("progress", syncDuration);
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("seeked", onSeeked);
        };
    }, [src]);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
        } else {
            const rawDuration = audio.duration;
            const finiteDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
            if (audio.ended || (finiteDuration > 0 && audio.currentTime >= finiteDuration - 0.05)) {
                audio.currentTime = 0;
                setCurrentTime(0);
            }
            void audio.play();
        }
    };

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
    };

    const duration = reportedDuration > 0
        ? reportedDuration
        : Math.max(visualDuration, currentTime + (isPlaying ? 1.5 : 0));
    const safeDuration = duration > 0 && isFinite(duration) ? duration : 0;
    const progress = safeDuration > 0 ? (currentTime / safeDuration) * 100 : 0;
    const clampedProgress = Math.min(100, Math.max(0, progress));
    const dotProgress = Math.min(99, Math.max(1, clampedProgress));
    const showElapsed = isPlaying || currentTime > 0.05;
    const timeLabel = showElapsed ? formatTime(currentTime) : formatTime(safeDuration);

    // Generate pseudo-random waveform bar heights (deterministic per src)
    const bars = 28;
    const barHeights = Array.from({ length: bars }, (_, i) => {
        const seed = (i * 7 + src.charCodeAt(i % src.length)) % 100;
        return 20 + (seed / 100) * 80; // 20% to 100% height
    });

    return (
        <div className="flex min-w-[200px] max-w-[290px] items-center gap-2">
            <audio ref={audioRef} src={src} preload="auto" />
            <button
                onClick={togglePlay}
                className={cn(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                    isOutbound
                        ? "bg-primary/20 text-primary hover:bg-primary/30 dark:bg-primary/30 dark:text-primary-foreground dark:hover:bg-primary/40"
                        : "bg-primary/10 hover:bg-primary/20 text-primary"
                )}
            >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <div className="flex flex-1 flex-col gap-1">
                <div
                    className="flex h-6 cursor-pointer items-center"
                    onClick={(e) => {
                        if (!audioRef.current || safeDuration <= 0) return;
                        const rect = (waveformRef.current ?? e.currentTarget).getBoundingClientRect();
                        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                        audioRef.current.currentTime = pct * safeDuration;
                    }}
                >
                    <div ref={waveformRef} className="relative inline-flex h-6 items-end gap-[2px] overflow-visible pb-[1px]">
                        {barHeights.map((h, i) => {
                            const barPct = ((i + 0.5) / bars) * 100;
                            const active = barPct <= clampedProgress;
                            return (
                                <div
                                    key={i}
                                    className="w-[3px] rounded-full"
                                    style={{
                                        height: `${Math.max(18, h)}%`,
                                        backgroundColor: active
                                            ? (isOutbound ? "var(--audio-bar-active, rgba(31,147,255,0.9))" : "rgba(37,99,235,1)")
                                            : (isOutbound ? "var(--audio-bar-inactive, rgba(31,147,255,0.24))" : "rgba(100,116,139,0.25)")
                                    }}
                                />
                            );
                        })}
                        {/* Position indicator dot */}
                        {safeDuration > 0 && (
                            <div
                                className="pointer-events-none absolute bottom-0 z-10 h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-background/80"
                                style={{
                                    left: `${dotProgress}%`,
                                    backgroundColor: isOutbound ? "var(--audio-dot, #1F93FF)" : "#2563EB",
                                    transform: "translate(-50%, 36%)",
                                }}
                            />
                        )}
                    </div>
                </div>
                <span className={cn("text-[10px] tabular-nums", isOutbound ? "text-primary/70 dark:text-primary-foreground/75" : "text-muted-foreground")}>
                    {timeLabel}
                </span>
            </div>
        </div>
    );
}

function MediaContent({ msg, onImageClick }: { msg: Message, onImageClick?: (msgId: string) => void }) {
    const isOutbound = msg.direction === "outbound";
    const cleanUrl = getCleanMediaUrl(msg.mediaUrl);

    if (msg.type === "image" && cleanUrl) {
        return (
            <div className="space-y-1">
                <img
                    src={cleanUrl}
                    alt={msg.content || "Image"}
                    className="max-w-[280px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => onImageClick ? onImageClick(msg.id) : window.open(cleanUrl, "_blank")}
                />
                {msg.content && !["[Imagen]", "[Sticker]", "[image]"].includes(msg.content) && (
                    <WhatsAppFormattedText text={msg.content} className="text-sm whitespace-pre-wrap" />
                )}
            </div>
        );
    }

    if (msg.type === "audio" && cleanUrl) {
        return <AudioPlayer src={cleanUrl} isOutbound={isOutbound} />;
    }

    if (msg.type === "video" && cleanUrl) {
        return (
            <div className="space-y-1">
                <video controls className="max-w-[280px] rounded-lg" preload="metadata">
                    <source src={cleanUrl} type={msg.mediaType || "video/mp4"} />
                </video>
                {msg.content && msg.content !== "[Video]" && <WhatsAppFormattedText text={msg.content} className="text-sm whitespace-pre-wrap" />}
            </div>
        );
    }

    if (msg.type === "document" && cleanUrl) {
        return (
            <a
                href={cleanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                    isOutbound ? "bg-white/10 hover:bg-white/20" : "bg-muted/50 hover:bg-muted"
                )}
            >
                <FileText className="h-8 w-8 shrink-0 opacity-70" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{msg.mediaFileName || "Documento"}</p>
                    <p className={cn("text-xs", isOutbound ? "text-primary-foreground/60" : "text-muted-foreground")}>
                        {msg.mediaType || "Descargar"}
                    </p>
                </div>
                <Download className="h-4 w-4 shrink-0 opacity-50" />
            </a>
        );
    }

    return <WhatsAppFormattedText text={msg.content} className="whitespace-pre-wrap" />;
}

// ──────────── Mic Permission Banner ────────────
function MicPermissionBanner({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border rounded-2xl shadow-2xl p-8 max-w-md mx-4 animate-in zoom-in-95 duration-300">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mic className="h-10 w-10 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold">Acceso al Micrófono</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        Para enviar notas de voz necesitamos acceso a tu micrófono.
                        <br /><strong>Acepta el permiso</strong> en el aviso del navegador.
                    </p>
                    <div className="flex gap-3 w-full mt-2">
                        <Button variant="outline" className="flex-1" onClick={onDeny}>Cancelar</Button>
                        <Button className="flex-1" onClick={onAllow}>
                            <Mic className="h-4 w-4 mr-2" /> Permitir
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ──────────── Contact Info Panel ────────────
function ContactInfoPanel({ conversation, onClose, showClose = true }: { conversation: Conversation; onClose: () => void; showClose?: boolean }) {
    const operationContext = useOperationContext();
    const formatDisplayPhone = useCallback(
        (phone: string | null | undefined) => formatPhone(phone, operationContext.phoneDefaultCountry),
        [operationContext.phoneDefaultCountry],
    );
    const contact = conversation.contact;
    const intelligence = conversation.leadIntelligence ?? null;
    const leadStatusLabel = intelligence ? (LEAD_STATUS_LABELS[intelligence.interestStatus] || intelligence.interestStatus) : null;
    const leadStepLabel = intelligence ? (LEAD_STEP_LABELS[intelligence.currentStep] || intelligence.currentStep) : null;
    return (
        <div className="flex h-full w-[19rem] flex-col border-l border-border bg-card animate-in slide-in-from-right duration-200 2xl:w-[21rem]">
            <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-border px-4">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">Ficha rápida</p>
                    <h3 className="mt-0.5 text-sm font-semibold tracking-tight">Detalles del cliente</h3>
                </div>
                {showClose && <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>}
            </div>
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-4 p-4">
                    {/* Avatar */}
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/55 p-3.5">
                    <Avatar className="h-12 w-12 shrink-0 ring-2 ring-card shadow-sm">
                        <AvatarImage
                            src={contact?.avatarUrl || undefined}
                            alt={contact?.name || "Contacto"}
                        />
                        <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
                            {contact?.name?.charAt(0) || "?"}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold">{contact?.name || "Desconocido"}</h4>
                        <p className="truncate text-xs text-muted-foreground">{formatDisplayPhone(contact?.phone)}</p>

                    {/* Status badge */}
                    {contact?.status && (
                        <Badge variant="outline" className="mt-2 rounded-full border-primary/15 bg-primary/8 px-2.5 py-0.5 text-[10px] capitalize text-primary">
                            {contact.status === "lead" ? "Lead" : contact.status === "qualified" ? "Calificado" : contact.status === "customer" ? "Cliente" : contact.status}
                        </Badge>
                    )}
                    </div>
                    </div>

                    {/* Details */}
                    <div className="w-full space-y-1 rounded-2xl border border-border bg-background/45 p-2">
                        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-card">
                            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Teléfono</p>
                                <p className="text-sm font-medium">{formatDisplayPhone(contact?.phone) || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-card">
                            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Email</p>
                                <p className="text-sm font-medium">{contact?.email || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-card">
                            <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Estado</p>
                                <p className="text-sm font-medium capitalize">{contact?.status || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-card">
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Última actividad</p>
                                <p className="text-sm font-medium">
                                    {new Date(conversation.updatedAt).toLocaleString(operationContext.locale, {
                                        timeZone: operationContext.timeZone,
                                        day: "numeric", month: "short", year: "numeric",
                                        hour: "2-digit", minute: "2-digit"
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>


                    {intelligence && (
                        <div className="w-full space-y-3 rounded-2xl border border-border bg-background/45 p-3.5">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">Inteligencia del lead</p>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55">
                                    <p className="text-xs text-muted-foreground">Estado del lead</p>
                                    <p className="mt-1 text-sm font-semibold">{leadStatusLabel}</p>
                                </div>
                                <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55">
                                    <p className="text-xs text-muted-foreground">Paso actual</p>
                                    <p className="mt-1 text-sm font-semibold">{leadStepLabel}</p>
                                </div>
                            </div>

                            <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55">
                                <p className="text-xs text-muted-foreground">Etapa del embudo</p>
                                <p className="mt-1 text-sm font-semibold">{conversation.currentDeal?.stageName || "-"}</p>
                            </div>

                            <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">Puntuacion</p>
                                    <span className="text-sm font-semibold">{intelligence.score}%</span>
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

                            <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">Progreso del paso</p>
                                    <span className="text-sm font-semibold">{intelligence.stepProgress}%</span>
                                </div>
                                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className="h-full rounded-full bg-primary transition-all"
                                        style={{ width: `${Math.min(Math.max(intelligence.stepProgress, 0), 100)}%` }}
                                    />
                                </div>
                            </div>

                            <div className="rounded-2xl bg-card/70 px-3 py-3 dark:bg-card/55 space-y-2">
                                <p className="text-xs text-muted-foreground uppercase tracking-[0.18em]">Datos capturados</p>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Nombre</span>
                                    <span className="font-medium text-right">{intelligence.capturedName || contact?.name || "-"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Email</span>
                                    <span className="font-medium text-right">{intelligence.capturedEmail || contact?.email || "-"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-muted-foreground">Telefono</span>
                                    <span className="font-medium text-right">{formatDisplayPhone(contact?.phone) || "-"}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Conversation info */}
                    <div className="w-full space-y-2 rounded-2xl border border-border bg-background/45 p-3.5">
                        <p className="text-xs text-muted-foreground font-medium uppercase">Conversación</p>
                        <div className="flex items-center justify-between rounded-2xl bg-card/70 px-3 py-3 text-sm dark:bg-card/55">
                            <span className="text-muted-foreground">Estado</span>
                            <Badge variant={conversation.status === "active" ? "default" : "secondary"} className="rounded-full capitalize">
                                {conversation.status === "active" ? "Activa" : conversation.status === "closed" ? "Cerrada" : conversation.status}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-card/70 px-3 py-3 text-sm dark:bg-card/55">
                            <span className="text-muted-foreground">Favorito</span>
                            <span>{conversation.isFavorite ? "⭐ Sí" : "No"}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-card/70 px-3 py-3 text-sm dark:bg-card/55">
                            <span className="text-muted-foreground">Silenciado</span>
                            <span>{conversation.isMuted ? "🔇 Sí" : "No"}</span>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}

// ──────────── Confirmation Modal ────────────
function ConfirmModal({ title, description, onConfirm, onCancel, variant = "default" }: {
    title: string;
    description: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: "default" | "destructive";
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-in zoom-in-95 duration-200">
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground mb-6">{description}</p>
                <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                    <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={onConfirm}>
                        Confirmar
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ──────────── Window Timer Component ────────────
function WindowTimer({ expiresAt, onWindowChange }: { expiresAt: string | null | undefined; onWindowChange?: (isOpen: boolean) => void }) {
    const [timeLeft, setTimeLeft] = useState<string>("");
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!expiresAt) {
            onWindowChange?.(false);
            return;
        }

        const updateTimer = () => {
            const now = new Date();
            const expiry = new Date(expiresAt);
            const diff = expiry.getTime() - now.getTime();

            if (diff > 0) {
                setIsOpen(true);
                onWindowChange?.(true);
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                setTimeLeft(`${hours}h ${minutes}m`);
            } else {
                setIsOpen(false);
                onWindowChange?.(false);
                setTimeLeft("");
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 60000);
        return () => clearInterval(interval);
    }, [expiresAt, onWindowChange]);

    if (!expiresAt) return null;

    return (
        <div className={cn(
            "mx-4 mb-2 px-3 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors",
            isOpen ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
        )}>
            {isOpen ? (
                <>
                    <Clock className="h-3 w-3" />
                    <span>Ventana abierta ({timeLeft})</span>
                </>
            ) : (
                <>
                    <BellOff className="h-3 w-3" />
                    <span>Ventana de 24h cerrada (Responderá con Plantilla)</span>
                </>
            )}
        </div>
    );
}

// ──────────── Main Inbox Page ────────────
export default function InboxPage() {
    const operationContext = useOperationContext();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const sessionUser = session?.user as { id?: string; role?: string; permissions?: unknown } | undefined;
    const currentUserId = sessionUser?.id || null;
    const canAssignAnyUser = hasPermission(sessionUser, "users.manage");
    const currentUserName = session?.user?.name || "";
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
    const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [templates, setTemplates] = useState<TemplateRecord[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [pendingFile, setPendingFile] = useState<{
        url: string; fileName: string; mimeType: string; mediaCategory: string; previewUrl?: string;
    } | null>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewFilter, setViewFilter] = useState<"all" | "mine" | "unassigned">("all");
    const [whatsAppSession, setWhatsAppSession] = useState<WhatsAppSessionStatus | null>(null);
    const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);
    const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
    const [isWindowOpen, setIsWindowOpen] = useState(true);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);
    const [quoteBuilderOpen, setQuoteBuilderOpen] = useState(false);
    // Reply, React & Forward state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
    const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
    const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0);

    // Build reactions map from loaded messages
    const reactions: Record<string, string> = {};
    for (const m of messages) {
        if (m.reaction) reactions[m.id] = m.reaction;
    }

    const reactionTargetMessage = useMemo(
        () => messages.find((message) => message.id === emojiPickerMsgId) || null,
        [messages, emojiPickerMsgId],
    );
    const outboundSourceType = selectedChat?.sourceType || "wuzapi";
    const formatDisplayPhone = useCallback(
        (phone: string | null | undefined) => formatPhone(phone, operationContext.phoneDefaultCountry),
        [operationContext.phoneDefaultCountry],
    );

    const isWuzapiTransportReady = Boolean(
        whatsAppSession?.configured &&
        whatsAppSession?.connected &&
        whatsAppSession?.loggedIn !== false,
    );
    const isMetaTransportReady = Boolean(whatsAppSession?.metaConnected);
    const isWhatsAppTransportReady = outboundSourceType === "meta"
        ? isMetaTransportReady
        : isWuzapiTransportReady;
    const isConversationTransportReady = useCallback((conversation: Conversation) => (
        conversation.sourceType === "meta" ? isMetaTransportReady : isWuzapiTransportReady
    ), [isWuzapiTransportReady, isMetaTransportReady]);
    const shouldShowWhatsAppWarning = whatsAppSession !== null && !isWhatsAppTransportReady;
    const isMetaReplyWindowExpired = outboundSourceType === "meta" && (
        !selectedChat?.sessionExpiresAt ||
        !isWindowOpen ||
        (selectedChat?.sessionExpiresAt ? new Date(selectedChat.sessionExpiresAt).getTime() <= Date.now() : false)
    );
    const whatsAppWarningText = useMemo(() => {
        if (outboundSourceType === "meta") {
            if (!whatsAppSession?.metaConnected) {
                return "Conecta WhatsApp API oficial mediante Embedded Signup en Configuracion para responder desde este chat.";
            }

            return "WhatsApp API esta configurado, pero no se pudo validar el estado del canal en este momento.";
        }

        if (whatsAppSession?.error) {
            return whatsAppSession.error;
        }

        if (!whatsAppSession?.configured) {
            return "Configura el canal en Configuración para poder enviar y recibir mensajes desde el inbox.";
        }

        if (whatsAppSession?.loggedIn && !whatsAppSession?.connected) {
            return "Hay un número vinculado, pero el canal está pausado. Reconéctalo antes de responder desde Chats.";
        }

        if (whatsAppSession?.connected && whatsAppSession?.loggedIn === false) {
            return "El canal de WhatsApp está activo, pero la sesión todavía no aparece vinculada. Revisa el QR en Configuración.";
        }

        return "No hay un número de WhatsApp vinculado al CRM. Conéctalo en Configuración para enviar mensajes, usar plantillas y adjuntar archivos.";
    }, [outboundSourceType, whatsAppSession]);

    const refreshConversationsAndSelect = useCallback(async (conversationId: string) => {
        const url = new URL("/api/chat", window.location.origin);
        url.searchParams.set("limit", String(INBOX_CONVERSATION_LIMIT));
        const response = await fetch(url.toString(), { cache: "no-store" });
        const data = await response.json();
        if (!Array.isArray(data)) return null;

        const transformed = data.map(transformConversation);
        setConversations((prev) => mergeConversationSnapshots(prev, transformed));

        const target = transformed.find((conversation) => conversation.id === conversationId) || null;
        if (target) {
            setSelectedChat(target);
            setShowContactInfo(false);
        }

        return target;
    }, []);

    const clearInboxDeepLinkParams = useCallback(() => {
        if (typeof window === "undefined") return;

        const url = new URL(window.location.href);
        const paramsToClear = ["conversationId", "contactId", "phone", "sourceType", "source", "draft"];
        let changed = false;

        for (const param of paramsToClear) {
            if (url.searchParams.has(param)) {
                url.searchParams.delete(param);
                changed = true;
            }
        }

        if (changed) {
            const nextUrl = `${url.pathname}${url.search}${url.hash}`;
            window.history.replaceState(null, "", nextUrl);
        }
    }, []);

    const handleSelectConversation = useCallback((chat: Conversation) => {
        ignoreDeepLinkSelectionRef.current = true;
        clearInboxDeepLinkParams();
        setSelectedChat(chat);
        setShowContactInfo(false);
        setUnreadCounts(prev => {
            const next = { ...prev };
            delete next[chat.id];
            return next;
        });
    }, [clearInboxDeepLinkParams]);

    const handleCloseConversation = useCallback(() => {
        ignoreDeepLinkSelectionRef.current = true;
        clearInboxDeepLinkParams();
        setSelectedChat(null);
    }, [clearInboxDeepLinkParams]);

    const handleWindowChange = useCallback((open: boolean) => {
        setIsWindowOpen(open);
    }, []);

    const slashQuery = extractTemplateSlashQuery(inputText);
    const slashTemplateMatches = useMemo(() => {
        if (slashQuery === null) return [];

        const normalizedQuery = slashQuery.trim().toLowerCase();
        return templates
            .filter((template) => template.isActive)
            .filter((template) => {
                if (!normalizedQuery) return true;
                return (
                    template.shortcut?.toLowerCase().includes(normalizedQuery) ||
                    template.name.toLowerCase().includes(normalizedQuery)
                );
            })
            .slice(0, 6);
    }, [slashQuery, templates]);

    const setReaction = async (msgId: string, emoji: string | null) => {
        // Optimistic update
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction: emoji } : m));
        try {
            const response = await fetch("/api/chat/reaction", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId: msgId, reaction: emoji }),
            });
            const result = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(result?.error || "No se pudo guardar la reaccion.");
            }

            if (emoji && result?.whatsappSynced === false && result?.whatsappWarning) {
                console.warn("[Reaction]", result.whatsappWarning);
            }
        } catch (error) {
            console.error("Reaction error:", error);
        }
    };

    const syncConversationPreview = useCallback((conversationId: string, nextMessages: Message[]) => {
        const lastVisibleMessage = [...nextMessages].reverse().find((message) => message.type !== "system") || null;

        setConversations((prev) =>
            prev.map((conversation) =>
                conversation.id !== conversationId
                    ? conversation
                    : {
                        ...conversation,
                        messages: lastVisibleMessage ? [{ ...lastVisibleMessage }] : [],
                        lastMessageType: lastVisibleMessage?.type || "text",
                        updatedAt: lastVisibleMessage?.createdAt || conversation.updatedAt,
                    },
            ),
        );

        setSelectedChat((prev) =>
            prev && prev.id === conversationId
                ? {
                    ...prev,
                    messages: lastVisibleMessage ? [{ ...lastVisibleMessage }] : [],
                    lastMessageType: lastVisibleMessage?.type || prev.lastMessageType,
                    updatedAt: lastVisibleMessage?.createdAt || prev.updatedAt,
                }
                : prev,
        );
    }, []);

    const deleteMessageLocally = useCallback(async (messageId: string) => {
        if (!selectedChat) return;

        const response = await fetch("/api/chat/message", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversationId: selectedChat.id,
                messageId,
            }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || "No se pudo eliminar el mensaje.");
        }

        let nextMessagesSnapshot: Message[] = [];
        setMessages((prev) => {
            nextMessagesSnapshot = prev.filter((message) => message.id !== messageId);
            return nextMessagesSnapshot;
        });
        syncConversationPreview(selectedChat.id, nextMessagesSnapshot);

        setReplyingTo((prev) => (prev?.id === messageId ? null : prev));
        setViewerMessageId((prev) => (prev === messageId ? null : prev));
        setEmojiPickerMsgId((prev) => (prev === messageId ? null : prev));
        setForwardMsg((prev) => (prev?.id === messageId ? null : prev));
    }, [selectedChat, syncConversationPreview]);

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showMicPermission, setShowMicPermission] = useState(false);
    const [micPermissionGranted, setMicPermissionGranted] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const conversationsViewportRef = useRef<HTMLDivElement>(null);

    // Scroll tracking state
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
    const [hasMoreConversations, setHasMoreConversations] = useState(true);
    const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
    const prevMessagesLenRef = useRef(0);
    const isFirstLoadRef = useRef(true);
    const oldestMessageCursorRef = useRef<string | null>(null);
    const hasMoreMessagesRef = useRef(true);
    const isLoadingOlderMessagesRef = useRef(false);
    const isPrependingOlderMessagesRef = useRef(false);

    // Unread message count tracking (per conversation)
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [hasLoadedUnreadCounts, setHasLoadedUnreadCounts] = useState(false);
    const isFirstFetchRef = useRef(true);
    const ignoreDeepLinkSelectionRef = useRef(false);
    const prevConvTimestampsRef = useRef<Record<string, string>>({});
    const conversationsCursorRef = useRef<string | null>(null);
    const oldestConversationCursorRef = useRef<string | null>(null);
    const hasMoreConversationsRef = useRef(true);
    const isLoadingMoreConversationsRef = useRef(false);
    const conversationsPollInFlightRef = useRef(false);

    // Ref to keep the selected chat ID accessible inside polling closures
    const selectedChatIdRef = useRef<string | null>(null);
    const selectedChatUpdatedAtRef = useRef<string | null>(null);
    const forceFullMessagesSyncRef = useRef(false);
    const appliedInboxDraftRef = useRef<string | null>(null);

    const setHasMoreMessagesState = useCallback((next: boolean) => {
        hasMoreMessagesRef.current = next;
        setHasMoreMessages(next);
    }, []);

    const setHasMoreConversationsState = useCallback((next: boolean) => {
        hasMoreConversationsRef.current = next;
        setHasMoreConversations(next);
    }, []);

    useEffect(() => {
        const activeChat = selectedChat;
        selectedChatIdRef.current = activeChat?.id ?? null;
        selectedChatUpdatedAtRef.current = activeChat ? toIsoTimestamp(activeChat.updatedAt) : null;
        if (!activeChat?.sessionExpiresAt) {
            setIsWindowOpen(true);
        }
    }, [selectedChat]);

    const restoreMobileInboxViewport = useCallback(() => {
        if (typeof window === "undefined" || window.innerWidth >= 768) {
            return;
        }

        requestAnimationFrame(() => {
            composerTextareaRef.current?.blur();

            const scroller = messagesContainerRef.current;
            if (scroller) {
                scroller.scrollTop = scroller.scrollHeight;
            }
        });
    }, []);

    useEffect(() => {
        setUnreadCounts({});
        writeUnreadCounts({});
        setHasLoadedUnreadCounts(true);
    }, []);

    useEffect(() => {
        if (!hasLoadedUnreadCounts) {
            return;
        }

        writeUnreadCounts(unreadCounts);
    }, [hasLoadedUnreadCounts, unreadCounts]);

    useEffect(() => {
        if (!selectedChat?.id) {
            return;
        }

        setUnreadCounts((prev) => {
            if (!(selectedChat.id in prev)) {
                return prev;
            }

            const next = { ...prev };
            delete next[selectedChat.id];
            return next;
        });
    }, [selectedChat?.id]);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await fetch("/api/users");
                const data = await response.json();
                if (Array.isArray(data)) {
                    setTeamUsers(data);
                }
            } catch (error) {
                console.error("Failed to fetch users:", error);
            }
        };

        fetchUsers();
    }, []);

    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const response = await fetch("/api/templates?activeOnly=true", { cache: "no-store" });
                const result = await response.json();
                if (response.ok && Array.isArray(result.templates)) {
                    setTemplates(result.templates);
                }
            } catch (error) {
                console.error("Failed to fetch templates:", error);
            }
        };

        fetchTemplates();
    }, []);

    useEffect(() => {
        const fetchWhatsAppSession = async () => {
            try {
                const response = await fetch("/api/whatsapp/session", { cache: "no-store" });
                const payload = await response.json();

                setWhatsAppSession({
                    configured: Boolean(payload?.configured),
                    connected: readOptionalBoolean(payload, ["connected", "Connected"]) ?? false,
                    loggedIn: readOptionalBoolean(payload, ["loggedIn", "LoggedIn", "logged_in", "isLoggedIn"]),
                    jid: readOptionalString(payload, ["jid", "JID", "Jid", "userJid", "UserJID"]),
                    qrCode: readOptionalString(payload, ["qrCode", "QRCode", "qrcode"]) || null,
                    metaConfigured: Boolean(payload?.metaConfigured),
                    metaConnected: Boolean(payload?.metaConnected),
                    phoneNumberId: readOptionalString(payload, ["phoneNumberId"]) || null,
                    error: payload?.error || undefined,
                });
            } catch (error) {
                setWhatsAppSession({
                    configured: false,
                    metaConfigured: false,
                    metaConnected: false,
                    error: error instanceof Error ? error.message : "No se pudo consultar el canal de WhatsApp.",
                });
            }
        };

        void fetchWhatsAppSession();
        const interval = setInterval(fetchWhatsAppSession, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        setHighlightedSlashIndex(0);
    }, [slashQuery]);

    // ──── Fetch conversations ────
    useEffect(() => {
        let disposed = false;

        const updateConversationCursor = (items: Conversation[]) => {
            for (const conversation of items) {
                const timestamp = toIsoTimestamp(conversation.serverUpdatedAt || conversation.updatedAt);
                if (!timestamp) continue;
                if (!conversationsCursorRef.current || timestamp > conversationsCursorRef.current) {
                    conversationsCursorRef.current = timestamp;
                }
            }
        };

        const fetchConversations = async (mode: "full" | "delta") => {
            if (disposed) return;
            if (mode === "delta" && !conversationsCursorRef.current) return;
            if (conversationsPollInFlightRef.current) return;

            conversationsPollInFlightRef.current = true;

            try {
                const url = new URL("/api/chat", window.location.origin);
                url.searchParams.set("limit", String(INBOX_CONVERSATION_LIMIT));
                if (mode === "delta" && conversationsCursorRef.current) {
                    url.searchParams.set("updatedSince", conversationsCursorRef.current);
                }

                const response = await fetch(url.toString(), { cache: "no-store" });
                const data = await response.json();
                if (!Array.isArray(data) || disposed) return;

                const transformed: Conversation[] = data.map(transformConversation);
                updateConversationCursor(transformed);
                if (mode === "full" && !oldestConversationCursorRef.current) {
                    oldestConversationCursorRef.current = getOldestConversationCursor(transformed);
                    setHasMoreConversationsState(transformed.length >= INBOX_CONVERSATION_LIMIT);
                }

                if (mode === "full") {
                    setConversations((prev) =>
                        isFirstFetchRef.current
                            ? transformed
                            : mergeConversationSnapshots(prev, transformed),
                    );
                } else if (transformed.length > 0) {
                    setConversations((prev) => mergeConversationSnapshots(prev, transformed));
                }

                const currentId = selectedChatIdRef.current;

                // Track unread counts: compare updatedAt timestamps.
                if (!isFirstFetchRef.current) {
                    const prevTimestamps = prevConvTimestampsRef.current;
                    setUnreadCounts((prev) => {
                        const next = { ...prev };
                        let playedSound = false;
                        for (const conv of transformed) {
                            if (conv.id === currentId) continue;
                            const prevTime = prevTimestamps[conv.id];
                            const newTime = toIsoTimestamp(conv.serverUpdatedAt || conv.updatedAt);
                            const hasInboundActivity = conv.messages[0]?.direction === "inbound";
                            if (prevTime && newTime && newTime !== prevTime && hasInboundActivity) {
                                next[conv.id] = (next[conv.id] || 0) + 1;

                                if (!playedSound) {
                                    maybePlayNotification(conv.isMuted);
                                    playedSound = true;
                                }
                            }
                        }
                        return next;
                    });
                }

                if (mode === "full") {
                    const timestamps: Record<string, string> = {};
                    for (const conv of transformed) {
                        const timestamp = toIsoTimestamp(conv.serverUpdatedAt || conv.updatedAt);
                        if (timestamp) {
                            timestamps[conv.id] = timestamp;
                        }
                    }
                    prevConvTimestampsRef.current = timestamps;
                } else if (transformed.length > 0) {
                    const nextTimestamps = { ...prevConvTimestampsRef.current };
                    for (const conv of transformed) {
                        const timestamp = toIsoTimestamp(conv.serverUpdatedAt || conv.updatedAt);
                        if (timestamp) {
                            nextTimestamps[conv.id] = timestamp;
                        }
                    }
                    prevConvTimestampsRef.current = nextTimestamps;
                }

                // Only auto-select a chat on the very first full load.
                if (isFirstFetchRef.current && mode === "full") {
                    isFirstFetchRef.current = false;

                    const conversationIdParam = ignoreDeepLinkSelectionRef.current ? null : searchParams.get("conversationId");
                    if (conversationIdParam && transformed.length > 0) {
                        const match = transformed.find((conversation) => conversation.id === conversationIdParam);
                        if (match) {
                            setSelectedChat(match);
                            return;
                        }
                    }

                    const contactIdParam = ignoreDeepLinkSelectionRef.current ? null : searchParams.get("contactId");
                    const phoneParam = ignoreDeepLinkSelectionRef.current ? null : searchParams.get("phone");
                    const sourceParam = ignoreDeepLinkSelectionRef.current ? null : searchParams.get("sourceType") || searchParams.get("source");
                    const requestedSource = sourceParam === "meta" || sourceParam === "wuzapi" ? sourceParam : null;
                    if ((contactIdParam || phoneParam) && transformed.length > 0) {
                        const contactMatches = transformed.filter((conversation) => {
                            if (contactIdParam && conversation.contact?.id === contactIdParam) return true;
                            return Boolean(phoneParam && conversation.contact?.phone?.includes(phoneParam.slice(-10)));
                        });
                        const match = requestedSource
                            ? contactMatches.find((conversation) => conversation.sourceType === requestedSource) || contactMatches[0]
                            : contactMatches[0];
                        if (match) {
                            setSelectedChat(match);
                            return;
                        }
                    }

                }

                if (currentId) {
                    const updated = transformed.find((conversation) => conversation.id === currentId);
                    if (updated) {
                        const previousUpdatedAt = selectedChatUpdatedAtRef.current;
                        const nextUpdatedAt = toIsoTimestamp(updated.updatedAt);
                        if (previousUpdatedAt && nextUpdatedAt && previousUpdatedAt !== nextUpdatedAt) {
                            forceFullMessagesSyncRef.current = true;
                        }
                        selectedChatUpdatedAtRef.current = nextUpdatedAt;
                        setSelectedChat(updated);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch conversations:", error);
            } finally {
                conversationsPollInFlightRef.current = false;
            }
        };

        void fetchConversations("full");

        const deltaInterval = setInterval(() => {
            void fetchConversations("delta");
        }, INBOX_DELTA_POLL_INTERVAL_MS);

        const fullResyncInterval = setInterval(() => {
            void fetchConversations("full");
        }, INBOX_FULL_RESYNC_INTERVAL_MS);

        return () => {
            disposed = true;
            clearInterval(deltaInterval);
            clearInterval(fullResyncInterval);
        };
    }, [searchParams, setHasMoreConversationsState]);

    useEffect(() => {
        const conversationIdParam = searchParams.get("conversationId");
        if (ignoreDeepLinkSelectionRef.current || !conversationIdParam || selectedChat?.id === conversationIdParam) {
            return;
        }

        const existing = conversations.find((conversation) => conversation.id === conversationIdParam);
        if (existing) {
            setSelectedChat(existing);
            setShowContactInfo(false);
            return;
        }

        void refreshConversationsAndSelect(conversationIdParam);
    }, [conversations, refreshConversationsAndSelect, searchParams, selectedChat?.id]);

    const loadOlderConversations = useCallback(async () => {
        if (isLoadingMoreConversationsRef.current || !hasMoreConversationsRef.current) return;

        const before = oldestConversationCursorRef.current;
        if (!before) {
            setHasMoreConversationsState(false);
            return;
        }

        isLoadingMoreConversationsRef.current = true;
        setIsLoadingMoreConversations(true);

        try {
            const url = new URL("/api/chat", window.location.origin);
            url.searchParams.set("limit", String(INBOX_CONVERSATION_LIMIT));
            url.searchParams.set("beforeUpdatedAt", before);

            const response = await fetch(url.toString(), { cache: "no-store" });
            const data = await response.json();
            const transformed: Conversation[] = Array.isArray(data)
                ? data.map(transformConversation)
                : [];

            if (transformed.length === 0) {
                setHasMoreConversationsState(false);
                return;
            }

            oldestConversationCursorRef.current = getOldestConversationCursor(transformed);
            setHasMoreConversationsState(transformed.length >= INBOX_CONVERSATION_LIMIT);
            setConversations((prev) => mergeConversationSnapshots(prev, transformed));

            const nextTimestamps = { ...prevConvTimestampsRef.current };
            for (const conv of transformed) {
                const timestamp = toIsoTimestamp(conv.serverUpdatedAt || conv.updatedAt);
                if (timestamp) {
                    nextTimestamps[conv.id] = timestamp;
                }
            }
            prevConvTimestampsRef.current = nextTimestamps;
        } catch (error) {
            console.error("Failed to fetch older conversations:", error);
        } finally {
            isLoadingMoreConversationsRef.current = false;
            setIsLoadingMoreConversations(false);
        }
    }, [setHasMoreConversationsState]);

    const handleConversationsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 220) {
            void loadOlderConversations();
        }
    }, [loadOlderConversations]);

    // ──── Fetch messages ────
    useEffect(() => {
        if (!selectedChat) return;

        // Reset messages state when chat changes to avoid showing old data
        setMessages([]);
        selectedChatUpdatedAtRef.current = toIsoTimestamp(selectedChat.updatedAt);
        forceFullMessagesSyncRef.current = false;
        oldestMessageCursorRef.current = null;
        isLoadingOlderMessagesRef.current = false;
        setIsLoadingOlderMessages(false);
        setHasMoreMessagesState(true);
        let lastMessageDate: string | null = null;
        let isFetching = false;

        const fetchMessages = async (isInitial = false) => {
            if (isFetching) return;
            isFetching = true;
            try {
                const shouldFullSync = isInitial || forceFullMessagesSyncRef.current;
                if (shouldFullSync) {
                    forceFullMessagesSyncRef.current = false;
                }

                const url = new URL("/api/chat", window.location.origin);
                url.searchParams.append("conversationId", selectedChat.id);
                if (!shouldFullSync && lastMessageDate) {
                    url.searchParams.append("since", lastMessageDate);
                } else {
                    url.searchParams.append("messageLimit", String(INBOX_MESSAGE_PAGE_SIZE));
                }

                const response = await fetch(url.toString());
                const rawMessages = await response.json();
                const newMessages = Array.isArray(rawMessages)
                    ? rawMessages.map(normalizeMessageRecord)
                    : [];

                if (shouldFullSync) {
                    lastMessageDate = newMessages.length > 0
                        ? newMessages[newMessages.length - 1].createdAt.toISOString()
                        : null;

                    if (isInitial) {
                        oldestMessageCursorRef.current = newMessages[0]?.createdAt.toISOString() ?? null;
                        setHasMoreMessagesState(newMessages.length >= INBOX_MESSAGE_PAGE_SIZE);
                    }

                    setMessages((prev) => {
                        const optimisticMessages = prev.filter(isTemporaryMessage);
                        if (newMessages.length === 0) {
                            return isInitial ? optimisticMessages : prev;
                        }

                        return isInitial
                            ? collapseMessageDuplicates([...newMessages, ...optimisticMessages])
                            : mergeFetchedMessages(prev, newMessages);
                    });
                    return;
                }

                if (newMessages.length > 0) {
                    lastMessageDate = newMessages[newMessages.length - 1].createdAt.toISOString();

                    setMessages((prev) => {
                        const mergedMessages = mergeFetchedMessages(prev, newMessages);
                        const existingIds = new Set(prev.map((m) => m.id));
                        const uniqueNew = mergedMessages.filter((m) => !existingIds.has(m.id));

                        if (uniqueNew.length === 0) return prev;

                        // If there are genuinely new messages, show notifications or auto-scroll
                        if (prev.length > 0 && uniqueNew.some((m) => m.direction === "inbound")) {
                            // Play sound for incoming message in the active chat
                            maybePlayNotification(selectedChat.isMuted);

                            const el = messagesContainerRef.current;
                            if (el) {
                                const threshold = 150;
                                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
                                if (!atBottom) {
                                    setNewMessageCount((c) => c + uniqueNew.filter((m) => m.direction === "inbound").length);
                                } else {
                                    setTimeout(() => scrollToBottom("smooth"), 100);
                                }
                            }
                        }

                        return mergedMessages;
                    });
                }
            } catch (error) {
                console.error("Failed to fetch messages:", error);
            } finally {
                isFetching = false;
            }
        };

        fetchMessages(true);
        const interval = setInterval(() => fetchMessages(false), 2000);
        return () => clearInterval(interval);
    }, [selectedChat?.id, setHasMoreMessagesState]);

    // ──── Smart scroll logic ────
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        // Use scrollIntoView on the sentinel div — much more reliable on mobile
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
        } else if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
        setNewMessageCount(0);
    }, []);

    const loadOlderMessages = useCallback(async () => {
        if (!selectedChat?.id || isLoadingOlderMessagesRef.current || !hasMoreMessagesRef.current) return;

        const before = oldestMessageCursorRef.current;
        if (!before) {
            setHasMoreMessagesState(false);
            return;
        }

        const scroller = messagesContainerRef.current;
        const previousScrollHeight = scroller?.scrollHeight ?? 0;
        const previousScrollTop = scroller?.scrollTop ?? 0;

        isLoadingOlderMessagesRef.current = true;
        setIsLoadingOlderMessages(true);

        try {
            const url = new URL("/api/chat", window.location.origin);
            url.searchParams.append("conversationId", selectedChat.id);
            url.searchParams.append("before", before);
            url.searchParams.append("messageLimit", String(INBOX_MESSAGE_PAGE_SIZE));

            const response = await fetch(url.toString(), { cache: "no-store" });
            const rawMessages = await response.json();
            const olderMessages = Array.isArray(rawMessages)
                ? rawMessages.map(normalizeMessageRecord)
                : [];

            if (olderMessages.length === 0) {
                setHasMoreMessagesState(false);
                return;
            }

            oldestMessageCursorRef.current = olderMessages[0]?.createdAt.toISOString() ?? before;
            setHasMoreMessagesState(olderMessages.length >= INBOX_MESSAGE_PAGE_SIZE);
            isPrependingOlderMessagesRef.current = true;

            setMessages((prev) => {
                const next = collapseMessageDuplicates([...olderMessages, ...prev]);
                if (next.length === prev.length) {
                    isPrependingOlderMessagesRef.current = false;
                }
                return next;
            });

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const currentScroller = messagesContainerRef.current;
                    if (!currentScroller || selectedChatIdRef.current !== selectedChat.id) return;
                    currentScroller.scrollTop = currentScroller.scrollHeight - previousScrollHeight + previousScrollTop;
                });
            });
        } catch (error) {
            console.error("Failed to fetch older messages:", error);
        } finally {
            isLoadingOlderMessagesRef.current = false;
            setIsLoadingOlderMessages(false);
        }
    }, [selectedChat?.id, setHasMoreMessagesState]);

    // Check if user is near the bottom of the messages
    const handleMessagesScroll = useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const threshold = 100; // px from bottom
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        setIsAtBottom(atBottom);
        if (atBottom) setNewMessageCount(0);

        if (el.scrollTop < 140) {
            void loadOlderMessages();
        }
    }, [loadOlderMessages]);

    // Auto-scroll only when at bottom or on first load / chat switch
    useEffect(() => {
        if (messages.length === 0) return;

        if (isFirstLoadRef.current) {
            // First load of this chat: scroll to bottom instantly
            isFirstLoadRef.current = false;
            // Use multiple attempts because mobile layout can be slow to settle
            setTimeout(() => scrollToBottom("instant"), 50);
            setTimeout(() => scrollToBottom("instant"), 200);
            setTimeout(() => scrollToBottom("instant"), 500);
            prevMessagesLenRef.current = messages.length;
            return;
        }

        const newCount = messages.length - prevMessagesLenRef.current;
        if (newCount > 0) {
            if (isPrependingOlderMessagesRef.current) {
                isPrependingOlderMessagesRef.current = false;
                prevMessagesLenRef.current = messages.length;
                return;
            }

            // Check if any new message is inbound → play notification
            const newMessages = messages.slice(-newCount);
            const hasInbound = newMessages.some(m => m.direction === "inbound");
            if (hasInbound && selectedChat) {
                maybePlayNotification(selectedChat.isMuted);
            }

            if (isAtBottom) {
                // User is at bottom → auto-scroll to new messages
                scrollToBottom();
            } else {
                // User is scrolled up → show badge with count
                setNewMessageCount(prev => prev + newCount);
            }
        }
        prevMessagesLenRef.current = messages.length;
    }, [messages, isAtBottom, scrollToBottom, selectedChat]);

    // Reset scroll state when switching chats
    useEffect(() => {
        setIsAtBottom(true);
        setNewMessageCount(0);
        isFirstLoadRef.current = true;
        prevMessagesLenRef.current = 0;
        isPrependingOlderMessagesRef.current = false;
    }, [selectedChat?.id]);

    useEffect(() => {
        if (!selectedChat?.id || typeof window === "undefined") return;
        if (!searchParams.get("draft")) return;

        const draft = parseStoredInboxDraft(window.sessionStorage.getItem(INBOX_DRAFT_STORAGE_KEY));
        if (!draft || draft.conversationId !== selectedChat.id) return;

        const draftKey = `${draft.conversationId}:${draft.createdAt}:${draft.mediaUrl || "text"}`;
        if (appliedInboxDraftRef.current === draftKey) return;

        appliedInboxDraftRef.current = draftKey;
        setInputText(draft.content || "");
        setPendingFile(draft.mediaUrl ? {
            url: draft.mediaUrl,
            fileName: draft.fileName,
            mimeType: draft.mimeType,
            mediaCategory: draft.mediaCategory,
            previewUrl: draft.previewUrl,
        } : null);
        setReplyingTo(null);
        window.sessionStorage.removeItem(INBOX_DRAFT_STORAGE_KEY);
        window.history.replaceState(null, "", `/dashboard/inbox?conversationId=${encodeURIComponent(selectedChat.id)}`);
        setTimeout(() => scrollToBottom("instant"), 150);
    }, [scrollToBottom, searchParams, selectedChat?.id]);

    // Cleanup
    useEffect(() => {
        return () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); };
    }, []);

    // ──── Conversation Actions ────
    const setConversationBotState = useCallback((conversationId: string, botActive: boolean) => {
        setConversations(prev => prev.map((conversation) =>
            conversation.id === conversationId
                ? { ...conversation, botActive }
                : conversation,
        ));

        setSelectedChat(prev =>
            prev?.id === conversationId
                ? { ...prev, botActive }
                : prev,
        );
    }, []);

    const performAction = async (action: string, extra: Record<string, unknown> = {}) => {
        if (!selectedChat) return;
        try {
            const res = await fetch("/api/conversation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedChat.id, action, ...extra }),
            });
            const result = await res.json();
            console.log("[Action]", action, result);

            if (action === "delete") {
                setSelectedChat(null);
                setMessages([]);
            }
            if (action === "clear") {
                setMessages([]);
            }

            // Refresh conversations
            const convRes = await fetch(`/api/chat?limit=${INBOX_CONVERSATION_LIMIT}`, { cache: "no-store" });
            const convData = await convRes.json();
            if (Array.isArray(convData)) {
                const transformed: Conversation[] = convData.map(transformConversation);
                setConversations((prev) => mergeConversationSnapshots(prev, transformed));
                if (selectedChat && action !== "delete") {
                    const updated = transformed.find(c => c.id === selectedChat.id);
                    if (updated) setSelectedChat(updated);
                }
            }
        } catch (error) {
            console.error("[Action] error:", error);
        }
    };

    const handleHumanModeToggle = async (checked: boolean) => {
        if (!selectedChat) return;
        const nextBotActive = !checked;
        if (selectedChat.botActive === nextBotActive) return;

        setConversationBotState(selectedChat.id, nextBotActive);
        await performAction("toggleBot", { botActive: nextBotActive });
    };

    const updateConversationAssignment = useCallback((conversationId: string, assignedUser: TeamUser | null) => {
        setConversations((prev) =>
            prev.map((conversation) =>
                conversation.id === conversationId
                    ? {
                        ...conversation,
                        assignedUserId: assignedUser?.id || null,
                        assignedUser,
                    }
                    : conversation,
            ),
        );

        setSelectedChat((prev) =>
            prev?.id === conversationId
                ? {
                    ...prev,
                    assignedUserId: assignedUser?.id || null,
                    assignedUser,
                }
                : prev,
        );
    }, []);

    const handleAssignConversation = async (nextAssignedUserId: string) => {
        if (!selectedChat) return;
        const assignee = teamUsers.find((user) => user.id === nextAssignedUserId) || null;
        updateConversationAssignment(selectedChat.id, assignee);
        await performAction("assign", { assignedUserId: nextAssignedUserId });
    };

    const handleConfirmAction = () => {
        if (confirmAction) {
            if (confirmAction.kind === "message" && confirmAction.messageId) {
                deleteMessageLocally(confirmAction.messageId).catch((error) => {
                    console.error("deleteMessage error:", error);
                    alert(error instanceof Error ? error.message : "No se pudo eliminar el mensaje.");
                });
            } else {
                performAction(confirmAction.type);
            }
            setConfirmAction(null);
        }
    };

    // ──── Filter conversations by search ────
    const filteredConversations = conversations.filter(conv => {
        if (viewFilter === "mine" && conv.assignedUserId !== currentUserId) return false;
        if (viewFilter === "unassigned" && conv.assignedUserId) return false;
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const name = (conv.contact?.name || "").toLowerCase();
        const phone = (conv.contact?.phone || "").toLowerCase();
        const lastMsg = (conv.messages[0]?.content || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
    });

    // ──── Voice Recording ────
    const assignableUsers = canAssignAnyUser
        ? teamUsers
        : teamUsers.filter((user) => user.id === currentUserId || user.id === selectedChat?.assignedUserId);

    const requestMicPermission = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            setMicPermissionGranted(true);
            setShowMicPermission(false);
            startRecording();
        } catch {
            setShowMicPermission(false);
        }
    };

    const handleMicClick = () => {
        if (!isWhatsAppTransportReady) return;
        if (isRecording) { stopRecording(); return; }
        if (!micPermissionGranted) {
            navigator.permissions?.query({ name: "microphone" as PermissionName })
                .then(result => {
                    if (result.state === "granted") { setMicPermissionGranted(true); startRecording(); }
                    else setShowMicPermission(true);
                })
                .catch(() => setShowMicPermission(true));
        } else {
            startRecording();
        }
    };

    const startRecording = async () => {
        if (!isWhatsAppTransportReady) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true }
            });

            // Priority: OGG Opus (WhatsApp's native voice format, well-supported by browsers)
            // Chromium browsers falsely claim audio/mp4 support but output WebM containers
            const mimeTypes = [
                "audio/ogg;codecs=opus", // WhatsApp native voice note format
                "audio/webm;codecs=opus", // Will be converted to send as ogg
                "audio/ogg",
                "audio/webm",
            ];

            let mimeType = "";
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }

            if (!mimeType) {
                console.warn("No suitable audio MIME type found, defaulting to default");
                mimeType = ""; // Let browser decide
            }

            console.log("Recording with MIME type:", mimeType);

            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunksRef.current = [];
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());

                const actualMimeType = mediaRecorder.mimeType;
                // Always use OGG for WhatsApp compatibility
                // Even if browser records as webm, WhatsApp can often handle it when sent as audio type
                let ext = "ogg";
                let blobType = "audio/ogg; codecs=opus";

                if (actualMimeType.includes("ogg")) {
                    ext = "ogg";
                    blobType = "audio/ogg; codecs=opus";
                } else if (actualMimeType.includes("webm")) {
                    // WebM/Opus is very similar to OGG/Opus internally
                    // Send as .ogg anyway - WhatsApp handles this better
                    ext = "ogg";
                    blobType = "audio/ogg; codecs=opus";
                }

                console.log(`Recording finished. Mime: ${actualMimeType}, Sending as: ${blobType}, Ext: ${ext}`);

                const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
                if (audioBlob.size > 0) await uploadAndSendAudio(audioBlob, ext, blobType);
            };

            mediaRecorder.start(250);
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
        } catch (err) {
            console.error("Failed to start recording:", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current?.state !== "inactive") {
            mediaRecorderRef.current!.ondataavailable = null;
            mediaRecorderRef.current!.onstop = null;
            mediaRecorderRef.current!.stop();
            mediaRecorderRef.current!.stream.getTracks().forEach(track => track.stop());
        }
        audioChunksRef.current = [];
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    const uploadAndSendAudio = async (audioBlob: Blob, ext: string, mimeType: string) => {
        if (!selectedChat || !isWhatsAppTransportReady) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", audioBlob, `nota-de-voz-${Date.now()}.${ext}`);
            const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
            const uploadResult = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok || !uploadResult.success) {
                throw new Error(uploadResult.error || "No se pudo subir el audio.");
            }
            if (uploadResult.success) {
                await sendMediaMessage(uploadResult.url, "audio", uploadResult.fileName, mimeType);
            }
        } catch (error) {
            console.error("Upload audio error:", error);
            const message = error instanceof Error ? error.message : "Error inesperado";
            alert(`Error al enviar audio: ${message}`);
        } finally {
            setIsUploading(false);
        }
    };

    const formatRecordingTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

    // ──── File Upload ────
    const uploadSelectedFile = async (file: File) => {
        if (!isWhatsAppTransportReady) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo subir el archivo.");
            }
            if (result.success) {
                const previewUrl = ["image", "video"].includes(result.mediaCategory)
                    ? URL.createObjectURL(file)
                    : undefined;
                setPendingFile({ ...result, previewUrl });
            }
        } catch (error) {
            console.error("Upload error:", error);
            const message = error instanceof Error ? error.message : "Error inesperado";
            alert(`Error al subir archivo: ${message}`);
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await uploadSelectedFile(file);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (imageInputRef.current) imageInputRef.current.value = "";
        }
    };

    const handleComposerPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (!selectedChat || !isWhatsAppTransportReady || isUploading) return;

        const imageItem = Array.from(e.clipboardData.items).find(
            (item) => item.kind === "file" && item.type.startsWith("image/")
        );

        if (!imageItem) return;

        const pastedFile = imageItem.getAsFile();
        if (!pastedFile) return;

        e.preventDefault();

        const fileName = pastedFile.name?.trim()
            ? pastedFile.name
            : `imagen-portapapeles-${Date.now()}.${fileExtensionFromMimeType(pastedFile.type)}`;

        const normalizedFile = new File([pastedFile], fileName, {
            type: pastedFile.type || "image/png",
            lastModified: Date.now(),
        });

        await uploadSelectedFile(normalizedFile);
    };

    const markTemplateUsed = async (templateId: string) => {
        const usedAt = new Date().toISOString();
        setTemplates((prev) =>
            prev.map((template) =>
                template.id === templateId
                    ? {
                        ...template,
                        usageCount: template.usageCount + 1,
                        lastUsedAt: usedAt,
                    }
                    : template,
            ),
        );

        try {
            await fetch(`/api/templates/${templateId}/use`, { method: "POST" });
        } catch (error) {
            console.error("Failed to register template usage:", error);
        }
    };

    const applyTemplate = async (template: TemplateRecord) => {
        if (!selectedChat) return;

        const renderedContent = renderTemplateContent(template.content || "", {
            contact: {
                name: selectedChat.contact?.name,
                company: selectedChat.contact?.company,
                phone: selectedChat.contact?.phone,
            },
            agentName: currentUserName,
        });

        setInputText(renderedContent);
        setReplyingTo(null);

        if (template.type === "text") {
            setPendingFile(null);
        } else if (template.mediaUrl) {
            setPendingFile({
                url: template.mediaUrl,
                fileName: template.mediaFileName || template.name,
                mimeType: template.mediaType || (template.type === "image" ? "image/*" : "application/octet-stream"),
                mediaCategory: template.type,
                previewUrl: template.type === "image" ? getSafeMediaUrl(template.mediaUrl) : undefined,
            });
        }

        await markTemplateUsed(template.id);
    };

    const openQuoteBuilder = useCallback(() => {
        if (!selectedChat) return;
        setQuoteBuilderOpen(true);
    }, [selectedChat]);

    const handleQuoteGenerated = useCallback(async (asset: GeneratedQuoteAsset) => {
        setIsUploading(true);
        try {
            const file = new File([asset.blob], asset.fileName, { type: asset.mimeType });
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo generar la cotizacion.");
            }

            setInputText(asset.caption);
            setPendingFile({
                url: result.url,
                fileName: result.fileName || asset.fileName,
                mimeType: result.mimeType || asset.mimeType,
                mediaCategory: result.mediaCategory || asset.mediaCategory,
                previewUrl: asset.previewUrl,
            });
            setReplyingTo(null);
            setQuoteBuilderOpen(false);
        } catch (error) {
            alert(error instanceof Error ? error.message : "No se pudo generar la cotizacion.");
        } finally {
            setIsUploading(false);
        }
    }, []);

    const handleComposerKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slashQuery !== null && slashTemplateMatches.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightedSlashIndex((prev) => (prev + 1) % slashTemplateMatches.length);
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightedSlashIndex((prev) => (prev - 1 + slashTemplateMatches.length) % slashTemplateMatches.length);
                return;
            }

            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                await applyTemplate(slashTemplateMatches[Math.min(highlightedSlashIndex, slashTemplateMatches.length - 1)]);
                return;
            }
        }

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            await handleSendMessage();
        }
    };

    // ──── Send Media ────
    const sendMediaMessage = async (mediaUrl: string, mediaCategory: string, fileName?: string, mimeType?: string, caption?: string) => {
        if (!selectedChat || !isWhatsAppTransportReady) return;

        const fullMediaUrl = mediaUrl.startsWith("http") ? mediaUrl : `${window.location.origin}${mediaUrl}`;

        // Optimistic update
        const optimisticId = "temp-" + Date.now();
        const optimistic: Message = {
            id: optimisticId, content: caption || `[${mediaCategory}]`,
            senderId: "me", direction: "outbound", createdAt: new Date(),
            type: mediaCategory,
            sourceType: outboundSourceType,
            sourceId: outboundSourceType === selectedChat.sourceType ? selectedChat.sourceId || null : null,
            senderType: "human",
            mediaUrl: fullMediaUrl,
            mediaType: mimeType,
            mediaFileName: fileName,
        };
        setMessages(prev => [...prev, optimistic]);
        setConversationBotState(selectedChat.id, false);
        setPendingFile(null);
        restoreMobileInboxViewport();

        try {
            const res = await fetch("/api/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId: selectedChat.id, content: caption || `[${mediaCategory}]`,
                    direction: "outbound", type: mediaCategory,
                    sourceType: outboundSourceType,
                    sourceId: outboundSourceType === selectedChat.sourceType ? selectedChat.sourceId || null : null,
                    mediaUrl: fullMediaUrl, mediaType: mimeType, mediaFileName: fileName,
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to send message");
            }

            const result = await res.json();
            if (result?.message) {
                const persistedMessage = normalizeMessageRecord(result.message);
                if (result.conversationId && result.conversationId !== selectedChat.id) {
                    setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
                    await refreshConversationsAndSelect(result.conversationId);
                } else {
                    setMessages((prev) => replaceOptimisticMessage(prev, optimisticId, persistedMessage));
                }
            }

        } catch (error: unknown) {
            console.error("sendMediaMessage error:", error);
            const message = error instanceof Error ? error.message : "Error inesperado";
            alert(`Error al enviar mensaje multimedia: ${message}`);

            // Remove optimistic message on failure
            setMessages(prev => prev.filter(m => m.id !== optimisticId));
        }
    };

    // ──── Send Text ────
    const handleSendMessage = async () => {
        if (!isWhatsAppTransportReady) return;
        if (pendingFile) {
            await sendMediaMessage(pendingFile.url, pendingFile.mediaCategory, pendingFile.fileName, pendingFile.mimeType, inputText.trim() || undefined);
            setInputText("");
            setReplyingTo(null);
            return;
        }
        if (!inputText.trim() || !selectedChat) return;
        // Build content with optional reply quote
        let fullContent = inputText;
        if (replyingTo) {
            const quotedSnippet = (replyingTo.content || "").slice(0, 100);
            fullContent = `> ${quotedSnippet}\n\n${inputText}`;
        }
        const optimistic: Message = {
            id: "temp-" + Date.now(), content: fullContent,
            senderId: "me",
            direction: "outbound",
            createdAt: new Date(),
            type: "text",
            sourceType: outboundSourceType,
            sourceId: outboundSourceType === selectedChat.sourceType ? selectedChat.sourceId || null : null,
            senderType: "human",
        };
        setMessages(prev => [...prev, optimistic]);
        setConversationBotState(selectedChat.id, false);
        setInputText("");
        setReplyingTo(null);
        restoreMobileInboxViewport();
        // Always scroll to bottom when user sends a message
        setTimeout(() => scrollToBottom("smooth"), 100);
        try {
            const res = await fetch("/api/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId: selectedChat.id,
                    content: fullContent,
                    direction: "outbound",
                    sourceType: outboundSourceType,
                    sourceId: outboundSourceType === selectedChat.sourceType ? selectedChat.sourceId || null : null,
                }),
            });
            if (!res.ok) throw new Error("Failed");
            const result = await res.json();
            if (result?.message) {
                const persistedMessage = normalizeMessageRecord(result.message);
                if (result.conversationId && result.conversationId !== selectedChat.id) {
                    setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
                    await refreshConversationsAndSelect(result.conversationId);
                } else {
                    setMessages((prev) => replaceOptimisticMessage(prev, optimistic.id, persistedMessage));
                }
            }
        } catch (error) {
            console.error("sendMessage error:", error);
            setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
        }
    };

    // ──── Forward Message ────
    const handleForward = async (targetConvId: string) => {
        if (!forwardMsg || !isWhatsAppTransportReady) return;
        try {
            await fetch("/api/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId: targetConvId,
                    content: forwardMsg.content,
                    direction: "outbound",
                    sourceType: outboundSourceType,
                }),
            });
        } catch (error) {
            console.error("Forward error:", error);
        }
        setForwardMsg(null);
    };

    return (
        <>
            {showMicPermission && <MicPermissionBanner onAllow={requestMicPermission} onDeny={() => setShowMicPermission(false)} />}
            {confirmAction && (
                <ConfirmModal
                    title={confirmAction.title}
                    description={confirmAction.desc}
                    variant="destructive"
                    onConfirm={handleConfirmAction}
                    onCancel={() => setConfirmAction(null)}
                />
            )}
            {reactionTargetMessage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
                    onClick={() => setEmojiPickerMsgId(null)}
                >
                    <div
                        className="w-full max-w-md rounded-[2rem] border border-border/60 bg-card/95 p-5 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.6)] backdrop-blur-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-base font-semibold tracking-tight">Reaccionar al mensaje</h3>
                                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                    {reactionTargetMessage.content || `[${reactionTargetMessage.type}]`}
                                </p>
                            </div>
                            <button
                                className="rounded-full border border-border/60 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                onClick={() => setEmojiPickerMsgId(null)}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                            {REACTION_EMOJIS.map((emoji) => (
                                <button
                                    key={emoji}
                                    className="flex h-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/35 text-2xl transition hover:scale-[1.04] hover:bg-muted"
                                    onClick={() => {
                                        setReaction(reactionTargetMessage.id, emoji);
                                        setEmojiPickerMsgId(null);
                                    }}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>

                        {reactionTargetMessage.reaction && (
                            <button
                                className="mt-4 w-full rounded-2xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                onClick={() => {
                                    setReaction(reactionTargetMessage.id, null);
                                    setEmojiPickerMsgId(null);
                                }}
                            >
                                Quitar reaccion actual
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div
                className="fixed inset-x-2 bottom-2 top-16 z-10 flex overflow-hidden overscroll-none rounded-2xl border border-border bg-card shadow-soft md:relative md:inset-auto md:z-auto md:h-full md:min-h-0 md:rounded-none md:border-0 md:shadow-none"
            >
                {/* ──── Sidebar ──── */}
                <div className={cn("min-h-0 w-full border-r border-border bg-card md:w-[20.5rem] 2xl:w-[22rem] flex flex-col", selectedChat ? "hidden md:flex" : "flex")}>
                    <div className="space-y-3 border-b border-border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
                                    {isWuzapiTransportReady || isMetaTransportReady ? "WhatsApp conectado" : "Centro de mensajes"}
                                </p>
                                <h2 className="mt-1 text-xl font-semibold tracking-tight">Bandeja</h2>
                            </div>
                            <span className="mt-1 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                                {filteredConversations.length} chats
                            </span>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Buscar chats..."
                                className="h-10 rounded-xl border-border bg-background/70 pl-10 shadow-none placeholder:text-muted-foreground/75 focus-visible:border-primary/35"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="inline-flex w-full flex-wrap gap-1 rounded-xl bg-secondary/60 p-1">
                            {[
                                { id: "all", label: "Todos" },
                                { id: "mine", label: "Mios" },
                                { id: "unassigned", label: "Sin asignar" },
                            ].map((filter) => (
                                <button
                                    key={filter.id}
                                    type="button"
                                    onClick={() => setViewFilter(filter.id as "all" | "mine" | "unassigned")}
                                    className={cn(
                                        "flex-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                                        viewFilter === filter.id
                                            ? "border-border bg-card text-foreground shadow-sm"
                                            : "border-transparent bg-transparent text-muted-foreground hover:bg-card/70 hover:text-foreground",
                                    )}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <ScrollArea
                        type="always"
                        className="min-h-0 flex-1 px-2 py-2"
                        viewportRef={conversationsViewportRef}
                        onViewportScroll={handleConversationsScroll}
                    >
                        <div className="flex flex-col gap-1">
                            {filteredConversations.length === 0 && (
                                <div className="rounded-[1.6rem] border border-dashed border-border/60 bg-background/50 p-10 text-center text-sm text-muted-foreground">
                                    {searchQuery ? "No se encontraron chats" : "Sin conversaciones"}
                                </div>
                            )}
                            {filteredConversations.map((chat) => {
                                const currentModeLabel = getConversationModeLabel(chat);
                                const chatTransportReady = isConversationTransportReady(chat);
                                return (
                                <button
                                    key={chat.id}
                                    onClick={() => {
                                        handleSelectConversation(chat);
                                    }}
                                    className={cn(
                                        "relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-all",
                                        selectedChat?.id === chat.id
                                            ? "border-primary/15 bg-accent/65 shadow-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                                            : "border-transparent bg-transparent hover:border-border hover:bg-background/70",
                                        !chatTransportReady && selectedChat?.id !== chat.id && "opacity-80",
                                    )}
                                >
                                    <div className="relative shrink-0">
                                        <Avatar className="h-10 w-10 ring-1 ring-black/5 dark:ring-white/10">
                                            <AvatarImage
                                                src={chat.contact?.avatarUrl || undefined}
                                                alt={chat.contact?.name || "Contacto"}
                                            />
                                            <AvatarFallback className={cn(getAvatarColor(chat.contact?.name), "text-white font-semibold text-[13px]")}>
                                                {chat.isGroup ? <Users className="h-4 w-4" /> : (chat.contact?.name?.charAt(0)?.toUpperCase() || "?")}
                                            </AvatarFallback>
                                        </Avatar>
                                        {chat.isFavorite && (
                                            <Star className="absolute -top-0.5 -right-0.5 h-3 w-3 text-yellow-500 fill-yellow-500" />
                                        )}
                                        <ConversationSourceIcon
                                            sourceType={chat.sourceType}
                                            className="absolute -bottom-1 -right-1"
                                        />
                                    </div>
                                    <div className="min-w-0 overflow-hidden">
                                        <div className="flex min-w-0 items-start gap-1.5">
                                            <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold tracking-tight leading-tight">
                                                {chat.contact?.name || "Desconocido"}
                                                {chat.isMuted && <BellOff className="h-3 w-3 text-muted-foreground" />}
                                            </span>
                                        </div>
                                        {chat.contact?.phone && (
                                            <p className="mt-0.5 text-[10px] text-muted-foreground/85 truncate leading-tight">{formatDisplayPhone(chat.contact.phone)}</p>
                                        )}
                                        <p className="text-[10px] text-muted-foreground/80 truncate leading-tight">
                                            {chat.assignedUser
                                                ? `Asignado a ${chat.assignedUser.name || chat.assignedUser.email}`
                                                : "Sin asignar"}
                                        </p>
                                        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground truncate">
                                            {getLastMessagePreview(chat)}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                                        <span className="text-[10px] font-medium text-muted-foreground/85 whitespace-nowrap">
                                            {formatConversationListTimestamp(chat.updatedAt, operationContext.locale, operationContext.timeZone)}
                                        </span>
                                        <MessageResponderBadge
                                            label={currentModeLabel}
                                            compact
                                        />
                                        {unreadCounts[chat.id] > 0 && (
                                            <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                                                {unreadCounts[chat.id]}
                                            </span>
                                        )}
                                    </div>
                                </button>
                                );
                            })}
                            {hasMoreConversations && (
                                <button
                                    type="button"
                                    onClick={() => void loadOlderConversations()}
                                    disabled={isLoadingMoreConversations}
                                    className="mt-2 rounded-[1rem] border border-dashed border-border/60 bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-background disabled:cursor-wait disabled:opacity-70"
                                >
                                    {isLoadingMoreConversations
                                        ? "Cargando mas chats..."
                                        : searchQuery.trim()
                                            ? "Cargar mas chats para buscar"
                                            : "Cargar mas chats"}
                                </button>
                            )}
                            {!hasMoreConversations && conversations.length > 0 && !searchQuery.trim() && (
                                <div className="px-3 py-2 text-center text-[11px] text-muted-foreground/70">
                                    Fin del historial de chats
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* ──── Main Chat ──── */}
                <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background", selectedChat ? "flex" : "hidden md:flex")}>
                    {selectedChat ? (
                        <>
                            {/* Header */}
                            <div className="flex min-h-[4.5rem] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 md:px-4">
                                <div className="flex items-center gap-1 overflow-hidden">
                                    {/* Back button on mobile */}
                                    <button className="md:hidden flex-shrink-0 rounded-full border border-border/60 bg-background/90 p-2 shadow-sm hover:bg-muted" onClick={handleCloseConversation}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                                    </button>
                                    <button className="ml-1 flex items-center gap-3 overflow-hidden text-left transition hover:opacity-80 md:ml-0" onClick={() => setShowContactInfo(true)}>
                                        <div className="relative shrink-0">
                                        <Avatar className="h-10 w-10 flex-shrink-0 ring-1 ring-black/5 dark:ring-white/10">
                                                <AvatarImage
                                                    src={selectedChat.contact?.avatarUrl || undefined}
                                                    alt={selectedChat.contact?.name || "Contacto"}
                                                />
                                                <AvatarFallback>{selectedChat.contact?.name?.charAt(0) || "?"}</AvatarFallback>
                                            </Avatar>
                                            <ConversationSourceIcon
                                                sourceType={selectedChat.sourceType}
                                                className="absolute -bottom-1 -right-1"
                                            />
                                        </div>
                                        <div className="overflow-hidden">
                                            <div className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-tight">
                                                <span className="truncate">{selectedChat.contact?.name || "Desconocido"}</span>
                                                {selectedChat.status === "closed" && (
                                                    <Badge variant="secondary" className="shrink-0 rounded-full border border-border/50 bg-background/80 px-2 py-0.5 text-[10px]">Cerrada</Badge>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">{formatDisplayPhone(selectedChat.contact?.phone)}</div>
                                            <div className="text-[11px] text-muted-foreground truncate">
                                                {selectedChat.assignedUser
                                                    ? `Asignado a ${selectedChat.assignedUser.name || selectedChat.assignedUser.email}`
                                                    : "Sin responsable asignado"}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                                <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                                    <Button
                                        variant="ghost"
                                        className="hidden h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold shadow-none lg:inline-flex"
                                        onClick={openQuoteBuilder}
                                        title="Crear cotizacion para este contacto"
                                    >
                                        <FileText className="h-4 w-4" />
                                        Cotizar
                                    </Button>
                                    <div className="hidden min-w-[150px] lg:block">
                                        <Select
                                            value={selectedChat.assignedUserId || "__unassigned__"}
                                            onValueChange={(value) => handleAssignConversation(value === "__unassigned__" ? "" : value)}
                                        >
                                            <SelectTrigger className="h-9 w-full rounded-xl border-border bg-background text-xs shadow-none">
                                                <SelectValue placeholder="Asignar chat" />
                                            </SelectTrigger>
                                            <SelectContent align="end">
                                                <SelectItem value="__unassigned__">Sin asignar</SelectItem>
                                                {assignableUsers.map((user) => (
                                                    <SelectItem key={user.id} value={user.id}>
                                                        {user.name || user.email}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex h-9 items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 px-2.5 shadow-none">
                                        {selectedChat.botActive ? (
                                            <Bot className="h-3.5 w-3.5 text-emerald-600" />
                                        ) : (
                                            <UserIcon className="h-3.5 w-3.5 text-amber-600" />
                                        )}
                                        <div className="hidden sm:block">
                                            <p className="text-[11px] font-medium leading-none">
                                                {selectedChat.botActive ? "Bot activo" : "Modo humano"}
                                            </p>
                                            <p className="mt-0.5 text-[10px] leading-none text-muted-foreground">
                                                {selectedChat.botActive ? "Responde automatico" : "Bot pausado"}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={!selectedChat.botActive}
                                            onCheckedChange={handleHumanModeToggle}
                                            aria-label="Cambiar entre bot activo y modo humano"
                                        />
                                    </div>
                                    <Button variant="ghost" size="icon" className="hidden h-9 w-9 rounded-xl border border-border bg-background shadow-none sm:inline-flex xl:hidden" onClick={() => setShowContactInfo(!showContactInfo)} title="Info del contacto">
                                        <Info className="h-4 w-4" />
                                    </Button>
                                    <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
                                    {/* Dropdown Menu */}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-border bg-background shadow-none">
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-52">
                                            <DropdownMenuItem onClick={() => setShowContactInfo(true)}>
                                                <Info className="h-4 w-4 mr-2" /> Info. del contacto
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={openQuoteBuilder}>
                                                <FileText className="h-4 w-4 mr-2" /> Crear cotizacion
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => performAction("mute")}>
                                                {selectedChat.isMuted
                                                    ? <><Bell className="h-4 w-4 mr-2" /> Activar notificaciones</>
                                                    : <><BellOff className="h-4 w-4 mr-2" /> Silenciar notificaciones</>
                                                }
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => performAction("favorite")}>
                                                <Star className={cn("h-4 w-4 mr-2", selectedChat.isFavorite && "fill-yellow-500 text-yellow-500")} />
                                                {selectedChat.isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => performAction(selectedChat.status === "active" ? "close" : "reopen")}>
                                                <Archive className="h-4 w-4 mr-2" />
                                                {selectedChat.status === "active" ? "Cerrar chat" : "Reabrir chat"}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => setConfirmAction({ type: "clear", title: "Vaciar chat", desc: "¿Estás seguro de que quieres eliminar todos los mensajes de esta conversación? Esta acción no se puede deshacer." })}
                                            >
                                                <Eraser className="h-4 w-4 mr-2" /> Vaciar chat
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => setConfirmAction({ type: "delete", title: "Eliminar chat", desc: "¿Estás seguro de que quieres eliminar esta conversación por completo? Esta acción no se puede deshacer." })}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" /> Eliminar chat
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="relative flex-1 min-h-0 overflow-hidden">
                                <div
                                    ref={messagesContainerRef}
                                    onScroll={handleMessagesScroll}
                                    className="h-full overflow-y-auto bg-[linear-gradient(180deg,hsl(42_31%_96%),hsl(45_35%_98%))] p-4 dark:bg-background sm:px-6"
                                    style={{ scrollBehavior: "auto" }}
                                >
                                    {/* Padding at bottom for scroll space */}
                                    <div className="mx-auto flex max-w-[58rem] flex-col gap-3 pb-4">
                                        {isLoadingOlderMessages && (
                                            <div className="flex justify-center">
                                                <Badge variant="outline" className="rounded-full border-border/60 bg-card/80 px-3.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                                                    Cargando mensajes anteriores...
                                                </Badge>
                                            </div>
                                        )}
                                        {!hasMoreMessages && messages.length > 0 && (
                                            <div className="flex justify-center">
                                                <Badge variant="outline" className="rounded-full border-border/50 bg-card/70 px-3.5 py-1 text-[11px] font-medium text-muted-foreground/80 shadow-sm">
                                                    Inicio del historial
                                                </Badge>
                                            </div>
                                        )}
                                        {messages.map((msg, idx) => {
                                            // Dynamic date separators
                                            const msgDate = new Date(msg.createdAt);
                                            const prevDate = idx > 0 ? new Date(messages[idx - 1].createdAt) : null;
                                            const msgDateKey = getOperationDateKey(msgDate, operationContext.timeZone);
                                            const prevDateKey = prevDate ? getOperationDateKey(prevDate, operationContext.timeZone) : null;
                                            const showDateSep = idx === 0 || msgDateKey !== prevDateKey;
                                            const responderLabel = getMessageResponderLabel(msg);

                                            let dateLabel = "";
                                            if (showDateSep) {
                                                const todayKey = getOperationTodayKey(operationContext.timeZone);
                                                const yesterdayKey = shiftDateKey(todayKey, -1);
                                                if (msgDateKey === todayKey) {
                                                    dateLabel = "Hoy";
                                                } else if (msgDateKey === yesterdayKey) {
                                                    dateLabel = "Ayer";
                                                } else {
                                                    dateLabel = formatDateInOperationZone(msgDate, operationContext.locale, operationContext.timeZone, { day: "numeric", month: "numeric", year: "numeric" });
                                                }
                                            }

                                            if (msg.type === "system") {
                                                const adPreview = parseInboundAdPreviewMessageContent(msg.content);
                                                const previewTargetUrl =
                                                    adPreview?.sourceUrl ||
                                                    adPreview?.mediaUrl ||
                                                    adPreview?.thumbnailUrl ||
                                                    null;
                                                const previewImageUrl = getSafeMediaUrl(
                                                    adPreview?.thumbnailUrl || adPreview?.mediaUrl || null,
                                                );
                                                const previewTitle =
                                                    adPreview?.title ||
                                                    adPreview?.productHint ||
                                                    "Anuncio detectado de Facebook Ads";
                                                const previewBody = adPreview?.body || adPreview?.context || null;
                                                const previewHost = toDisplayHost(previewTargetUrl || undefined);

                                                return (
                                                    <React.Fragment key={msg.id}>
                                                        {showDateSep && (
                                                            <div className="my-5 flex justify-center">
                                                                <Badge variant="outline" className="rounded-full border-border/60 bg-card/75 px-3.5 py-1 text-[11px] font-medium text-foreground/80 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.55)] backdrop-blur-md">
                                                                    {dateLabel}
                                                                </Badge>
                                                            </div>
                                                        )}
                                                        {adPreview ? (
                                                            <div className="flex justify-start">
                                                                <div className="w-full max-w-[min(92%,26rem)] overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-[0_20px_45px_-32px_rgba(15,23,42,0.45)]">
                                                                    {previewImageUrl ? (
                                                                        previewTargetUrl ? (
                                                                            <a href={previewTargetUrl} target="_blank" rel="noreferrer">
                                                                                <img
                                                                                    src={previewImageUrl}
                                                                                    alt={previewTitle}
                                                                                    className="h-40 w-full object-cover"
                                                                                />
                                                                            </a>
                                                                        ) : (
                                                                            <img
                                                                                src={previewImageUrl}
                                                                                alt={previewTitle}
                                                                                className="h-40 w-full object-cover"
                                                                            />
                                                                        )
                                                                    ) : (
                                                                        <div className="flex h-24 w-full items-center justify-center bg-muted/70 px-4 text-sm font-medium text-muted-foreground">
                                                                            Vista previa del anuncio
                                                                        </div>
                                                                    )}
                                                                    <div className="space-y-1.5 p-3">
                                                                        <p className="text-sm font-semibold leading-tight text-foreground">
                                                                            {previewTitle}
                                                                        </p>
                                                                        {previewBody && (
                                                                            <p className="text-xs leading-relaxed text-muted-foreground">
                                                                                {previewBody}
                                                                            </p>
                                                                        )}
                                                                        {previewHost && (
                                                                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                                                                                {previewHost}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex justify-center">
                                                                <div className="max-w-[90%] rounded-full border border-emerald-200/70 bg-emerald-50/90 px-4 py-2 text-center text-[12px] font-medium text-emerald-700 shadow-[0_16px_34px_-28px_rgba(16,185,129,0.5)] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                                                                    {msg.content}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            }

                                            return (
                                                <React.Fragment key={msg.id}>
                                                    {showDateSep && (
                                                        <div className="my-5 flex justify-center">
                                                            <Badge variant="outline" className="rounded-full border-border/60 bg-card/75 px-3.5 py-1 text-[11px] font-medium text-foreground/80 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.55)] backdrop-blur-md">
                                                                {dateLabel}
                                                            </Badge>
                                                        </div>
                                                    )}
                                                    <div
                                                        className={cn(
                                                            "group/msg flex max-w-[88%] gap-0.5 sm:max-w-[82%] 2xl:max-w-[76%]",
                                                            msg.direction === "outbound" ? "self-end flex-row-reverse" : "self-start flex-row"
                                                        )}
                                                    >
                                                        {/* Bubble */}
                                                        <div className={cn("flex flex-col", msg.direction === "outbound" ? "items-end" : "items-start")}>
                                                            {responderLabel && <MessageResponderBadge label={responderLabel} />}
                                                            <div
                                                                className={cn(
                                                                    "relative overflow-visible rounded-2xl border px-3.5 py-2.5 text-sm break-words [overflow-wrap:anywhere] shadow-[0_6px_18px_-14px_rgba(53,59,35,0.35)]",
                                                                    msg.direction === "outbound"
                                                                        ? "text-foreground"
                                                                        : "border-border bg-card text-foreground",
                                                                        (idx === 0 || messages[idx - 1].direction !== msg.direction)
                                                                            ? msg.direction === "outbound"
                                                                                ? "rounded-tr-sm"
                                                                        : "rounded-tl-sm"
                                                                    : ""
                                                            )}
                                                                style={
                                                                    msg.direction === "outbound"
                                                                        ? {
                                                                            borderColor: "var(--chat-outbound-border)",
                                                                            background: "var(--chat-outbound-bg)",
                                                                        }
                                                                        : undefined
                                                                }
                                                        >
                                                            <MediaContent msg={msg} onImageClick={setViewerMessageId} />
                                                            {/* Emoji reaction display */}
                                                            {reactions[msg.id] && (
                                                                <span
                                                                    className={cn(
                                                                        "absolute -bottom-3 z-10 flex min-h-7 min-w-7 items-center justify-center rounded-full border border-border/40 bg-card px-1.5 text-base shadow-sm cursor-pointer transition-transform hover:scale-110",
                                                                        msg.direction === "outbound" ? "right-2" : "left-2",
                                                                    )}
                                                                    onClick={() => setReaction(msg.id, null)}
                                                                    title="Quitar reacción"
                                                                >
                                                                    {reactions[msg.id]}
                                                                </span>
                                                            )}
                                                            <div className={cn(
                                                                "mt-2 flex items-center justify-end gap-1.5 text-[10px] font-medium",
                                                                msg.direction === "outbound"
                                                                    ? msg.status === "failed"
                                                                        ? "text-destructive"
                                                                        : "text-foreground/50"
                                                                    : "text-muted-foreground"
                                                            )}>
                                                                {msg.direction === "outbound" && msg.status === "failed" && (
                                                                    <span className="inline-flex items-center gap-1 font-semibold">
                                                                        <AlertTriangle className="h-3 w-3" />
                                                                        No enviado
                                                                    </span>
                                                                )}
                                                                <p>
                                                                    {formatTimeInOperationZone(msg.createdAt, operationContext.locale, operationContext.timeZone)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        </div>
                                                        {/* Context menu on hover */}
                                                        <div className="relative">
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <button className="self-start mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted/60 shrink-0">
                                                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    </button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align={msg.direction === "outbound" ? "end" : "start"} className="w-44">
                                                                    <DropdownMenuItem className="gap-2 text-sm" onClick={() => {
                                                                        setReplyingTo(msg);
                                                                    }}>
                                                                        <Reply className="h-4 w-4" /> Responder
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem className="gap-2 text-sm" onClick={() => {
                                                                        navigator.clipboard.writeText(msg.content || "");
                                                                    }}>
                                                                        <Copy className="h-4 w-4" /> Copiar
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        className="gap-2 text-sm"
                                                                        onSelect={() => {
                                                                            setEmojiPickerMsgId(msg.id);
                                                                        }}
                                                                    >
                                                                        <SmilePlus className="h-4 w-4" /> Reaccionar
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem className="gap-2 text-sm" onClick={() => {
                                                                        setForwardMsg(msg);
                                                                    }}>
                                                                        <Forward className="h-4 w-4" /> Reenviar
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                        className="gap-2 text-sm text-destructive focus:text-destructive"
                                                                        onClick={() => {
                                                                            setConfirmAction({
                                                                                kind: "message",
                                                                                type: "delete",
                                                                                messageId: msg.id,
                                                                                title: "Eliminar mensaje",
                                                                                desc: "Este borrado es solo local en el CRM. El mensaje no se eliminara del WhatsApp del cliente. Â¿Quieres continuar?",
                                                                            });
                                                                        }}
                                                                    >
                                                                        <Trash2 className="h-4 w-4" /> Eliminar mensaje
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                            {/* Emoji picker popup */}
                                                            {false && emojiPickerMsgId === msg.id && (
                                                                <div className={cn(
                                                                    "absolute z-50 w-[14.5rem] rounded-2xl border border-border/60 bg-card/95 p-2 shadow-xl backdrop-blur-md animate-in zoom-in-50 duration-150",
                                                                    msg.direction === "outbound" ? "right-0 top-8" : "left-0 top-8"
                                                                )} data-reaction-menu="true">
                                                                    <div className="mb-2 flex items-center justify-between px-1">
                                                                        <span className="text-[11px] font-medium text-muted-foreground">Reacciona rapido</span>
                                                                        <button
                                                                            className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                                                                            onClick={() => setEmojiPickerMsgId(null)}
                                                                        >
                                                                            Cerrar
                                                                        </button>
                                                                    </div>
                                                                    {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                                                                        <button
                                                                            key={emoji}
                                                                            className="text-xl hover:scale-125 transition-transform p-0.5"
                                                                            onClick={() => {
                                                                                setReaction(msg.id, emoji);
                                                                                setEmojiPickerMsgId(null);
                                                                            }}
                                                                        >
                                                                            {emoji}
                                                                        </button>
                                                                    ))}
                                                                    <div className="mt-2 grid grid-cols-5 gap-1.5">
                                                                        {REACTION_EMOJIS.slice(6).map((emoji) => (
                                                                            <button
                                                                                key={emoji}
                                                                                className="flex h-9 items-center justify-center rounded-xl border border-transparent bg-muted/40 text-xl transition hover:scale-[1.04] hover:border-border hover:bg-muted/70"
                                                                                onClick={() => {
                                                                                    setReaction(msg.id, emoji);
                                                                                    setEmojiPickerMsgId(null);
                                                                                }}
                                                                            >
                                                                                {emoji}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                        <div ref={messagesEndRef} />
                                    </div>
                                </div>

                                {/* Floating scroll-to-bottom button */}
                                {!isAtBottom && (
                                    <button
                                        onClick={() => scrollToBottom()}
                                        className="absolute bottom-28 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card/90 shadow-[0_20px_40px_-28px_rgba(15,23,42,0.55)] backdrop-blur-xl transition-all duration-200 hover:scale-105 hover:bg-accent sm:bottom-32"
                                        title="Ir al último mensaje"
                                    >
                                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                        {newMessageCount > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                                                {newMessageCount}
                                            </span>
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* Pending file preview */}
                            {pendingFile && (
                                <div className="border-t border-border/50 bg-card/72 px-4 pt-3 backdrop-blur-2xl">
                                    <div className="mx-auto flex max-w-[54rem] items-center gap-3 rounded-[1.3rem] border border-border/50 bg-background/75 p-3 shadow-[0_18px_34px_-30px_rgba(15,23,42,0.45)]">
                                        {pendingFile.mediaCategory === "image" ? (
                                            <img
                                                src={pendingFile.previewUrl || getSafeMediaUrl(pendingFile.url)}
                                                alt="Preview"
                                                className="h-16 w-16 rounded-xl object-cover"
                                            />
                                        ) : pendingFile.mediaCategory === "video" ? (
                                            <video
                                                src={pendingFile.previewUrl || getSafeMediaUrl(pendingFile.url)}
                                                className="h-16 w-16 rounded-xl object-cover"
                                                muted
                                                playsInline
                                                preload="metadata"
                                            />
                                        ) : pendingFile.mediaCategory === "audio" ? (
                                            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                                                <Mic className="h-8 w-8 text-primary" />
                                            </div>
                                        ) : (
                                            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                                                <FileText className="h-8 w-8 text-primary" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{pendingFile.fileName}</p>
                                            <p className="text-xs text-muted-foreground">{pendingFile.mimeType}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPendingFile(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Window Timer */}
                            {outboundSourceType === "meta" ? (
                                <WindowTimer expiresAt={selectedChat.sessionExpiresAt} onWindowChange={handleWindowChange} />
                            ) : null}

                            {/* Input Area — Locked when 24h window is closed */}
                            {isMetaReplyWindowExpired ? (
                                /* ═══ LOCKED: 24h window expired ═══ */
                                <div className="shrink-0 space-y-0">
                                    <p className="text-xs text-center text-muted-foreground px-6 py-3">
                                        Solo puedes responder a esta conversación utilizando un mensaje plantilla debido a la{" "}
                                        <span className="text-primary underline cursor-help" title="WhatsApp requiere que las empresas respondan dentro de las 24 horas posteriores al último mensaje del cliente.">
                                            restricción de la ventana de mensajes de 24 horas
                                        </span>
                                    </p>
                                    <div className="flex justify-center pb-4">
                                        <Button
                                            variant="outline"
                                            className="rounded-full px-6 gap-2 border-border hover:bg-primary/5 hover:border-primary/30"
                                            onClick={() => setTemplateModalOpen(true)}
                                        >
                                            <LayoutTemplate className="h-4 w-4" />
                                            Mensaje de plantilla (WhatsApp API)
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                /* ═══ UNLOCKED: Normal input area ═══ */
                                <div
                                    className="shrink-0 border-t border-border bg-card px-3 pt-3"
                                    style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
                                >
                                    {shouldShowWhatsAppWarning && (
                                        <div className="mx-auto mb-3 max-w-[54rem] rounded-[1.35rem] border border-amber-200/80 bg-amber-50/95 px-4 py-3 text-amber-950 shadow-[0_18px_40px_-28px_rgba(217,119,6,0.35)]">
                                            <div className="flex items-start gap-3">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                                <div>
                                                    <p className="text-sm font-semibold">No puedes responder todavía desde este chat</p>
                                                    <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
                                                        {whatsAppWarningText}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {replyingTo && (
                                        <div className="mb-2">
                                            <div className="mx-auto flex max-w-[54rem] items-center gap-2 rounded-t-[1.2rem] border border-b-0 border-border/50 bg-background/75 px-4 py-2 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.35)]">
                                                <div className="w-1 h-8 rounded-full bg-primary shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-semibold text-primary">Respondiendo</p>
                                                    <p className="text-xs text-muted-foreground truncate">{replyingTo.content?.slice(0, 80)}</p>
                                                </div>
                                                <button className="shrink-0 p-1 rounded hover:bg-muted" onClick={() => setReplyingTo(null)}>
                                                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {slashQuery !== null && slashTemplateMatches.length > 0 && !isRecording && (
                                        <div className="mx-auto mb-3 max-w-[54rem] rounded-[1.35rem] border border-border/60 bg-background/90 p-2 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                                            <div className="px-2 pb-2 pt-1">
                                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                                    Plantillas por atajo
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                {slashTemplateMatches.map((template, index) => (
                                                    <button
                                                        key={template.id}
                                                        className={`flex w-full items-start gap-3 rounded-[1rem] px-3 py-2 text-left transition ${
                                                            index === highlightedSlashIndex ? "bg-primary/8" : "hover:bg-muted/50"
                                                        }`}
                                                        onClick={() => { void applyTemplate(template); }}
                                                    >
                                                        <div className="rounded-xl bg-primary/10 p-2 text-primary">
                                                            {template.type === "image" ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <p className="truncate text-sm font-medium">{template.name}</p>
                                                                {template.shortcut ? (
                                                                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                                                        /{template.shortcut}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <p className="line-clamp-1 text-xs text-muted-foreground">
                                                                {template.content || template.mediaFileName || "Plantilla multimedia"}
                                                            </p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {isRecording ? (
                                        <div className="mx-auto flex max-w-[54rem] items-center gap-3 rounded-[1.75rem] border border-border/60 bg-background/85 p-2 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0" onClick={cancelRecording} title="Cancelar">
                                                <X className="h-6 w-6" />
                                            </Button>
                                            <div className="flex-1 flex items-center justify-center gap-3 px-4 h-12 bg-destructive/5 rounded-full">
                                                <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                                                <span className="text-sm font-medium text-destructive">Grabando audio...</span>
                                                <span className="text-sm font-mono text-muted-foreground hidden sm:inline">{formatRecordingTime(recordingTime)}</span>
                                            </div>
                                            <Button size="icon" className="h-12 w-12 rounded-full shrink-0 bg-green-500 hover:bg-green-600 text-white" onClick={stopRecording} title="Enviar">
                                                <Send className="h-5 w-5 ml-1" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="mx-auto flex max-w-[58rem] items-end gap-2 rounded-2xl border border-border bg-background p-1.5 shadow-sm">
                                            <input ref={fileInputRef} type="file" className="hidden"
                                                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                                                onChange={handleFileSelect}
                                            />
                                            <input ref={imageInputRef} type="file" className="hidden"
                                                accept="image/*"
                                                onChange={handleFileSelect}
                                            />
                                            <div className="flex gap-1 pb-1 pl-1">
                                                <TemplatePicker templates={templates} onApply={(template) => { void applyTemplate(template); }} disabled={!selectedChat || isUploading || !isWhatsAppTransportReady} />
                                                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full border border-transparent text-muted-foreground hover:border-border/50 hover:text-foreground hover:bg-muted/50"
                                                    onClick={() => fileInputRef.current?.click()} disabled={isUploading || !isWhatsAppTransportReady} title="Adjuntar archivo">
                                                    {isUploading
                                                        ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                                        : <Paperclip className="h-5 w-5" />}
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full border border-transparent text-muted-foreground hover:border-border/50 hover:text-foreground hover:bg-muted/50"
                                                    onClick={() => imageInputRef.current?.click()} disabled={isUploading || !isWhatsAppTransportReady} title="Enviar imagen">
                                                    <ImageIcon className="h-5 w-5" />
                                                </Button>
                                            </div>
                                            <div className="mb-1 flex-1 rounded-[1.25rem] border border-transparent bg-muted/20 p-1 transition-all focus-within:border-border/60 focus-within:bg-background/92 focus-within:ring-1 ring-primary/30">
                                                <Textarea
                                                    ref={composerTextareaRef}
                                                    rows={1}
                                                    placeholder={isWhatsAppTransportReady ? (pendingFile ? "Agregar descripción..." : "Escribe un mensaje...") : "Conecta un número de WhatsApp para responder desde este chat..."}
                                                    className="min-h-[44px] max-h-32 resize-none border-0 bg-transparent px-3 py-3 text-base shadow-none focus-visible:ring-0"
                                                    disabled={!isWhatsAppTransportReady}
                                                    value={inputText}
                                                    onChange={(e) => setInputText(e.target.value)}
                                                    onPaste={handleComposerPaste}
                                                    onKeyDown={(e) => { void handleComposerKeyDown(e); }}
                                                />
                                            </div>
                                            <div className="pb-1 pr-1 shrink-0">
                                                {(inputText.trim() || pendingFile) ? (
                                                    <Button size="icon" className="h-11 w-11 rounded-xl animate-in zoom-in-50 duration-200 bg-primary text-primary-foreground shadow-none hover:bg-primary/90" onClick={handleSendMessage} disabled={!isWhatsAppTransportReady}>
                                                        <Send className="h-5 w-5 ml-0.5" />
                                                    </Button>
                                                ) : (
                                                    <Button size="icon" className="h-11 w-11 shrink-0 rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90" onClick={handleMicClick} title="Nota de voz" disabled={!isWhatsAppTransportReady}>
                                                        <Mic className="h-5 w-5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-1 flex-col items-center justify-center bg-[linear-gradient(180deg,hsl(42_31%_96%),hsl(45_35%_98%))] px-6 text-center dark:bg-background">
                            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5 text-primary">
                                <MessageSquare className="h-5 w-5" />
                            </span>
                            <p className="text-sm font-semibold">Selecciona una conversación</p>
                            <p className="mt-1 text-xs text-muted-foreground">Elige un chat de la bandeja para consultar su historial.</p>
                        </div>
                    )}
                </div>

                {/* ──── Contact Info Panel ──── */}
                {selectedChat && (
                    <div className="hidden h-full shrink-0 xl:flex">
                        <ContactInfoPanel conversation={selectedChat} onClose={() => setShowContactInfo(false)} showClose={false} />
                    </div>
                )}
                {showContactInfo && selectedChat && (
                    <div className="absolute inset-y-0 right-0 z-30 flex h-full shadow-2xl xl:hidden">
                        <ContactInfoPanel conversation={selectedChat} onClose={() => setShowContactInfo(false)} />
                    </div>
                )}
            </div >

            {/* Image Viewer Lightbox */}
            {
                viewerMessageId && selectedChat && (
                    <ImageViewer
                        conversation={selectedChat}
                        messages={messages}
                        initialMessageId={viewerMessageId}
                        onClose={() => setViewerMessageId(null)}
                    />
                )
            }
            {selectedChat && (
                <MetaTemplateSendModal
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                    conversationId={selectedChat.id}
                    contactName={selectedChat.contact?.name}
                    contactPhone={selectedChat.contact?.phone}
                    onSent={(rawResult) => {
                        const result = rawResult as { message?: RawMessageRecord; conversationId?: string | null };
                        if (!result.message) return;

                        const normalized = normalizeMessageRecord(result.message);
                        if (result.conversationId && result.conversationId !== selectedChat.id) {
                            void refreshConversationsAndSelect(result.conversationId);
                            return;
                        }

                        setMessages((prev) => mergeFetchedMessages(prev, [normalized]));
                        const nextExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                        setIsWindowOpen(true);
                        setSelectedChat((prev) => prev ? {
                            ...prev,
                            sessionExpiresAt: nextExpiry,
                            updatedAt: normalized.createdAt,
                            messages: [normalized],
                        } : prev);
                        setConversations((prev) =>
                            prev.map((conversation) =>
                                conversation.id === selectedChat.id
                                    ? {
                                        ...conversation,
                                        sessionExpiresAt: nextExpiry,
                                        updatedAt: normalized.createdAt,
                                        messages: [normalized],
                                    }
                                    : conversation,
                            ),
                        );
                    }}
                />
            )}
            {selectedChat && (
                <Dialog open={quoteBuilderOpen} onOpenChange={setQuoteBuilderOpen}>
                    <DialogContent className="max-h-[94vh] w-[96vw] max-w-[88rem] overflow-hidden p-0 sm:max-w-[88rem]">
                        <DialogHeader className="border-b px-5 py-4">
                            <DialogTitle>Crear cotizacion</DialogTitle>
                            <DialogDescription>
                                Ajusta la cotizacion para {selectedChat.contact?.name || "este contacto"} y genera el contenido listo para enviar.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="max-h-[calc(94vh-6.5rem)] overflow-y-auto p-4">
                            <QuoteBuilderPanel
                                mode="compact"
                                initialContact={{
                                    name: selectedChat.contact?.name,
                                    phone: selectedChat.contact?.phone,
                                    company: selectedChat.contact?.company,
                                }}
                                agentName={currentUserName}
                                onGenerate={handleQuoteGenerated}
                            />
                        </div>
                    </DialogContent>
                </Dialog>
            )}
            {/* Forward Message Dialog */}
            {forwardMsg && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setForwardMsg(null)}>
                    <div className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b">
                            <h3 className="text-base font-semibold">Reenviar mensaje</h3>
                            <button className="p-1 rounded hover:bg-muted" onClick={() => setForwardMsg(null)}>
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-3 py-2 border-b">
                            <div className="px-3 py-2 rounded-lg bg-muted/40 text-xs text-muted-foreground line-clamp-2">
                                {forwardMsg.content?.slice(0, 120)}
                            </div>
                        </div>
                        <ScrollArea className="max-h-64">
                            <div className="py-1">
                                {conversations
                                    .filter(c => c.id !== selectedChat?.id)
                                    .map(conv => (
                                        <button
                                            key={conv.id}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                                            onClick={() => handleForward(conv.id)}
                                        >
                                            <Avatar className="h-9 w-9 shrink-0">
                                                <AvatarImage
                                                    src={conv.contact?.avatarUrl || undefined}
                                                    alt={conv.contact?.name || "Contacto"}
                                                />
                                                <AvatarFallback className={cn("text-white text-sm font-bold", getAvatarColor(conv.contact?.name))}>
                                                    {(conv.contact?.name || "?").charAt(0).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{conv.contact?.name || "Desconocido"}</p>
                                                <p className="text-xs text-muted-foreground truncate">{conv.contact?.phone || ""}</p>
                                            </div>
                                        </button>
                                    ))}
                                {conversations.filter(c => c.id !== selectedChat?.id).length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-6">No hay otras conversaciones</p>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            )}
        </>
    );
}

