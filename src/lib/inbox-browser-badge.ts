"use client";

import { DEFAULT_BRAND_FAVICON_URL } from "./branding.ts";
import { BRAND_LOTUS_BACKGROUND, BRAND_LOTUS_INK, BRAND_LOTUS_PATHS } from "./brand-lotus.ts";

export type InboxUnreadCounts = Record<string, number>;

export const INBOX_UNREAD_STORAGE_KEY = "zencrm_inbox_unread_counts";
export const INBOX_UNREAD_EVENT = "zencrm:inbox-unread-change";

declare global {
    interface Window {
        __zencrmBaseTitle?: string;
        __zencrmBaseFaviconHref?: string;
    }
}

function sanitizeUnreadCounts(raw: unknown): InboxUnreadCounts {
    if (!raw || typeof raw !== "object") {
        return {};
    }

    const next: InboxUnreadCounts = {};
    for (const [conversationId, value] of Object.entries(raw as Record<string, unknown>)) {
        const count = Number(value);
        if (!conversationId || !Number.isFinite(count) || count <= 0) {
            continue;
        }

        next[conversationId] = Math.floor(count);
    }

    return next;
}

function formatTitleCount(total: number): string {
    return total > 99 ? "99+" : String(total);
}

function formatFaviconCount(total: number): string {
    if (total > 99) return "99";
    if (total > 9) return "9+";
    return String(total);
}

function getBaseTitle(): string {
    if (typeof document === "undefined") {
        return "Zen CRM";
    }

    window.__zencrmBaseTitle = document.title.replace(/^\(\d+\+?\)\s+/, "") || window.__zencrmBaseTitle || "Zen CRM";

    return window.__zencrmBaseTitle;
}

function getBaseFaviconHref(): string {
    if (typeof document === "undefined") {
        return DEFAULT_BRAND_FAVICON_URL;
    }
    // Configured metadata follows the file-convention /favicon.ico. Prefer that custom icon,
    // and re-read it after tenant navigation rather than caching another business's branding.
    const icons = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]:not([data-zen-dynamic-favicon="true"])');
    window.__zencrmBaseFaviconHref = Array.from(icons).at(-1)?.href || DEFAULT_BRAND_FAVICON_URL;
    return window.__zencrmBaseFaviconHref;
}

function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

function drawBaseIcon(ctx: CanvasRenderingContext2D, size: number) {
    ctx.clearRect(0, 0, size, size);

    drawRoundedRect(ctx, 2, 2, size - 4, size - 4, 16);
    ctx.fillStyle = BRAND_LOTUS_BACKGROUND;
    ctx.fill();
    ctx.save();
    ctx.translate(8, 11);
    ctx.scale(2, 2);
    ctx.strokeStyle = BRAND_LOTUS_INK;
    ctx.lineWidth = 1.9;
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";
    for (const path of BRAND_LOTUS_PATHS) ctx.stroke(new Path2D(path));
    ctx.restore();
}

function applyDocumentTitleBadge(totalUnread: number) {
    if (typeof document === "undefined") {
        return;
    }

    const baseTitle = getBaseTitle();
    document.title = totalUnread > 0
        ? `(${formatTitleCount(totalUnread)}) ${baseTitle}`
        : baseTitle;
}

async function drawConfiguredBaseIcon(ctx: CanvasRenderingContext2D, size: number) {
    const baseFaviconHref = getBaseFaviconHref();

    try {
        await new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                ctx.clearRect(0, 0, size, size);
                ctx.drawImage(image, 6, 6, size - 12, size - 12);
                resolve();
            };
            image.onerror = () => reject(new Error("No se pudo cargar el favicon base."));
            image.src = baseFaviconHref;
        });
    } catch {
        drawBaseIcon(ctx, size);
    }
}

let faviconBadgeRevision = 0;

async function applyFaviconBadge(totalUnread: number) {
    const revision = ++faviconBadgeRevision;
    if (typeof document === "undefined") {
        return;
    }

    if (totalUnread <= 0) {
        const dynamicIcon = document.querySelector<HTMLLinkElement>('link[data-zen-dynamic-favicon="true"]');
        dynamicIcon?.remove();
        return;
    }

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return;
    }

    await drawConfiguredBaseIcon(ctx, size);
    // A cleared count or a newer update must not be overwritten by an earlier image load.
    if (revision !== faviconBadgeRevision) return;

    const badgeRadius = 14;
    const badgeX = 14;
    const badgeY = 14;

    ctx.beginPath();
    ctx.fillStyle = "#22c55e";
    ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = totalUnread > 9 ? "bold 14px Arial" : "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(formatFaviconCount(totalUnread), badgeX, badgeY + 0.5);

    let iconLink = document.querySelector<HTMLLinkElement>('link[data-zen-dynamic-favicon="true"]');
    if (!iconLink) {
        iconLink = document.createElement("link");
        iconLink.rel = "icon";
        iconLink.type = "image/png";
        iconLink.setAttribute("data-zen-dynamic-favicon", "true");
        document.head.appendChild(iconLink);
    }

    iconLink.href = canvas.toDataURL("image/png");
}

function notifyUnreadCountsChanged(counts: InboxUnreadCounts) {
    if (typeof window === "undefined") {
        return;
    }

    const totalUnread = getTotalUnreadCount(counts);
    applyDocumentTitleBadge(totalUnread);
    void applyFaviconBadge(totalUnread);
    window.dispatchEvent(
        new CustomEvent(INBOX_UNREAD_EVENT, {
            detail: {
                counts,
                totalUnread,
            },
        }),
    );
}

export function readUnreadCounts(): InboxUnreadCounts {
    if (typeof window === "undefined") {
        return {};
    }

    try {
        const stored = window.localStorage.getItem(INBOX_UNREAD_STORAGE_KEY);
        if (!stored) {
            return {};
        }

        return sanitizeUnreadCounts(JSON.parse(stored));
    } catch {
        return {};
    }
}

export function getTotalUnreadCount(counts: InboxUnreadCounts): number {
    return Object.values(counts).reduce((total, count) => total + count, 0);
}

export function writeUnreadCounts(counts: InboxUnreadCounts): InboxUnreadCounts {
    const next = sanitizeUnreadCounts(counts);

    if (typeof window !== "undefined") {
        window.localStorage.setItem(INBOX_UNREAD_STORAGE_KEY, JSON.stringify(next));
    }

    notifyUnreadCountsChanged(next);
    return next;
}

export function updateUnreadCounts(
    updater: (current: InboxUnreadCounts) => InboxUnreadCounts,
): InboxUnreadCounts {
    return writeUnreadCounts(updater(readUnreadCounts()));
}

export function incrementUnreadCounts(conversationIds: string[]) {
    if (conversationIds.length === 0) {
        return;
    }

    updateUnreadCounts((current) => {
        const next = { ...current };
        for (const conversationId of conversationIds) {
            if (!conversationId) continue;
            next[conversationId] = (next[conversationId] || 0) + 1;
        }
        return next;
    });
}

export function clearUnreadCount(conversationId: string) {
    if (!conversationId) {
        return;
    }

    updateUnreadCounts((current) => {
        if (!(conversationId in current)) {
            return current;
        }

        const next = { ...current };
        delete next[conversationId];
        return next;
    });
}

export function applyUnreadBrowserBadge(counts: InboxUnreadCounts) {
    notifyUnreadCountsChanged(sanitizeUnreadCounts(counts));
}
