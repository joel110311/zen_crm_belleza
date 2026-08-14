import { prisma } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/phone";
import { getWuzapiAvatar, type WuzapiAvatarRecord } from "@/lib/wuzapi";

const AVATAR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AVATAR_RETRY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const AVATAR_BATCH_LIMIT = 24;
const AVATAR_BATCH_CONCURRENCY = 4;

type ContactAvatarRecord = {
    id: string;
    phone: string;
    whatsappAvatarUrl: string | null;
    whatsappAvatarPictureId: string | null;
    whatsappAvatarCheckedAt: Date | null;
    whatsappAvatarUpdatedAt: Date | null;
};

function readString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function toHttpsUrl(value: string | null) {
    if (!value) return null;

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractAvatarData(payload: WuzapiAvatarRecord | null | undefined) {
    if (!payload) {
        return {
            avatarUrl: null,
            pictureId: null,
        };
    }

    return {
        avatarUrl: toHttpsUrl(
            readString(payload.URL) ||
                readString(payload.Url) ||
                readString(payload.url),
        ),
        pictureId:
            readString(payload.ID) ||
            readString(payload.Id) ||
            readString(payload.PictureID),
    };
}

function isAvatarRefreshDue(contact: ContactAvatarRecord, force = false) {
    if (force) return true;
    if (!contact.phone) return false;

    const checkedAt = contact.whatsappAvatarCheckedAt?.getTime() || 0;
    if (!checkedAt) return true;

    const refreshEvery = contact.whatsappAvatarUrl
        ? AVATAR_REFRESH_INTERVAL_MS
        : AVATAR_RETRY_INTERVAL_MS;

    return Date.now() - checkedAt >= refreshEvery;
}

async function refreshSingleAvatar(contact: ContactAvatarRecord) {
    const now = new Date();
    const normalizedPhone = normalizePhoneDigits(contact.phone);

    if (!normalizedPhone) {
        await prisma.contact.update({
            where: { id: contact.id },
            data: {
                whatsappAvatarCheckedAt: now,
            },
        });
        return;
    }

    try {
        const payload = await getWuzapiAvatar(normalizedPhone, true);
        const { avatarUrl, pictureId } = extractAvatarData(payload);

        await prisma.contact.update({
            where: { id: contact.id },
            data: {
                whatsappAvatarUrl: avatarUrl,
                whatsappAvatarPictureId: pictureId,
                whatsappAvatarCheckedAt: now,
                whatsappAvatarUpdatedAt: avatarUrl ? now : null,
            },
        });
    } catch (error) {
        await prisma.contact.update({
            where: { id: contact.id },
            data: {
                whatsappAvatarCheckedAt: now,
            },
        });

        console.warn("[WhatsAppAvatar] Failed to refresh avatar", {
            contactId: contact.id,
            phone: normalizedPhone,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

type RefreshAvatarOptions = {
    force?: boolean;
    limit?: number;
    concurrency?: number;
};

export async function refreshWhatsAppAvatarForContact(contactId: string, options: RefreshAvatarOptions = {}) {
    if (!contactId) return 0;

    return refreshWhatsAppAvatarForContacts([contactId], {
        ...options,
        limit: 1,
    });
}

export async function refreshWhatsAppAvatarForContacts(
    contactIds: string[],
    options: RefreshAvatarOptions = {},
) {
    const uniqueIds = [...new Set(contactIds.filter(Boolean))];
    if (uniqueIds.length === 0) return 0;

    const force = options.force === true;
    const limit = Math.max(1, Math.trunc(options.limit || AVATAR_BATCH_LIMIT));
    const concurrency = Math.max(
        1,
        Math.min(Math.trunc(options.concurrency || AVATAR_BATCH_CONCURRENCY), 8),
    );

    const contacts = await prisma.contact.findMany({
        where: {
            id: { in: uniqueIds },
        },
        select: {
            id: true,
            phone: true,
            whatsappAvatarUrl: true,
            whatsappAvatarPictureId: true,
            whatsappAvatarCheckedAt: true,
            whatsappAvatarUpdatedAt: true,
        },
    });

    const pending = contacts
        .filter((contact) => isAvatarRefreshDue(contact, force))
        .slice(0, limit);

    if (pending.length === 0) return 0;

    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
        while (cursor < pending.length) {
            const index = cursor;
            cursor += 1;
            await refreshSingleAvatar(pending[index]);
        }
    });

    await Promise.all(workers);
    return pending.length;
}

export function refreshWhatsAppAvatarForContactsInBackground(
    contactIds: string[],
    options: RefreshAvatarOptions = {},
) {
    if (!contactIds.length) return;

    void refreshWhatsAppAvatarForContacts(contactIds, options).catch((error) => {
        console.warn("[WhatsAppAvatar] Background refresh failed", error);
    });
}
