import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processInboundMessage, type InboundAttribution } from "@/app/actions/chat";
import { buildPhoneMatchClauses, normalizePhoneDigits, uniquePhoneCandidates } from "@/lib/phone";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { MESSAGE_SOURCE_WUZAPI, resolveMessageSourceId } from "@/lib/message-source";
import { getBearerToken, safeSecretEqual } from "@/lib/security";
import { downloadWuzapiMedia } from "@/lib/wuzapi";
import { refreshWhatsAppAvatarForContact } from "@/lib/whatsapp-avatar";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";

type JsonObject = Record<string, unknown>;

type WuzapiWebhookEvent = JsonObject & {
    Info?: JsonObject;
    Message?: unknown;
    PushName?: string;
};

type WuzapiWebhookPayload = {
    token?: string;
    type?: string;
    event?: WuzapiWebhookEvent;
    base64?: string;
    mimeType?: string;
    fileName?: string;
    s3?: {
        url?: string;
        mimeType?: string;
        fileName?: string;
    };
};

function asRecord(value: unknown): JsonObject | null {
    return typeof value === "object" && value !== null ? (value as JsonObject) : null;
}

function getString(record: JsonObject | null, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
}

function getStringCaseInsensitive(record: JsonObject | null, key: string): string | undefined {
    if (!record) return undefined;

    const direct = getString(record, key);
    if (direct !== undefined) return direct;

    const normalizedKey = key.toLowerCase();
    for (const [entryKey, entryValue] of Object.entries(record)) {
        if (entryKey.toLowerCase() !== normalizedKey) continue;
        if (typeof entryValue === "string") return entryValue;
    }

    return undefined;
}

function getNumber(record: JsonObject | null, key: string): number | undefined {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function parseProviderTimestamp(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const millis = value > 10_000_000_000 ? value : value * 1000;
        const parsed = new Date(millis);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) return null;

        if (/^\d+(\.\d+)?$/.test(normalized)) {
            return parseProviderTimestamp(Number(normalized));
        }

        const parsed = new Date(normalized);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function resolveMessageOccurredAt(info: JsonObject, event: WuzapiWebhookEvent): Date | null {
    const candidates: unknown[] = [
        info["Timestamp"],
        info["timestamp"],
        info["MessageTimestamp"],
        info["messageTimestamp"],
        info["ServerTimestamp"],
        info["serverTimestamp"],
        event["Timestamp"],
        event["timestamp"],
    ];

    for (const candidate of candidates) {
        const parsed = parseProviderTimestamp(candidate);
        if (parsed) return parsed;
    }

    return null;
}

function getBoolean(record: JsonObject | null, key: string): boolean | undefined {
    const value = record?.[key];
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return undefined;
}

function normalizeCustomerNameValue(value: string | null | undefined): string | undefined {
    if (!value) return undefined;

    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;

    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return undefined;
    }

    return normalized;
}

function getNestedRecord(record: JsonObject | null, key: string): JsonObject | null {
    return asRecord(record?.[key]);
}

function getNestedRecordAny(record: JsonObject | null, keys: string[]): JsonObject | null {
    for (const key of keys) {
        const nested = getNestedRecord(record, key);
        if (nested) return nested;
    }
    return null;
}

function pickFirstString(...values: Array<string | undefined>) {
    return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function decodeBase64ToText(value: string | undefined) {
    if (!value) return undefined;

    const candidates = [
        value,
        value.replace(/-/g, "+").replace(/_/g, "/"),
    ];

    const seen = new Set<string>();

    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);

        const missingPadding = candidate.length % 4;
        const padded = missingPadding === 0 ? candidate : candidate.padEnd(candidate.length + (4 - missingPadding), "=");

        try {
            const decoded = Buffer.from(padded, "base64").toString("utf8").trim();
            if (!decoded) continue;
            if (/[\u0000-\u0008\u000B-\u001F]/.test(decoded)) continue;

            const printableChars = [...decoded].filter((char) => {
                const code = char.charCodeAt(0);
                return code === 10 || code === 13 || code === 9 || (code >= 32 && code <= 126) || code >= 160;
            }).length;
            const printableRatio = printableChars / decoded.length;

            if (printableRatio < 0.72) continue;
            return decoded;
        } catch {
            // continue trying with the next variant
        }
    }

    return undefined;
}

function collectStringValuesDeep(value: unknown, depth = 0, limit = 80): string[] {
    if (depth > 6 || limit <= 0) return [];

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (Array.isArray(value)) {
        const result: string[] = [];
        for (const item of value) {
            if (result.length >= limit) break;
            result.push(...collectStringValuesDeep(item, depth + 1, limit - result.length));
        }
        return result;
    }

    if (typeof value === "object" && value !== null) {
        const result: string[] = [];
        for (const item of Object.values(value as Record<string, unknown>)) {
            if (result.length >= limit) break;
            result.push(...collectStringValuesDeep(item, depth + 1, limit - result.length));
        }
        return result;
    }

    return [];
}

function pickStringWithKeywords(candidates: string[], keywords: string[]) {
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
    return candidates.find((candidate) => {
        const normalized = candidate.toLowerCase();
        return normalizedKeywords.some((keyword) => normalized.includes(keyword));
    });
}

function sanitizeAttributionContextText(value: string | undefined) {
    if (!value) return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.slice(0, 320);
}

function extractFirstUrlFromText(value: string | undefined) {
    if (!value) return undefined;
    const match = value.match(/https?:\/\/[^\s<>"')]+/i);
    return match?.[0];
}

function pickUrlWithKeywords(candidates: string[], keywords: string[]) {
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
    for (const candidate of candidates) {
        const extractedUrl = /^https?:\/\//i.test(candidate) ? candidate : extractFirstUrlFromText(candidate);
        if (!extractedUrl) continue;
        const normalized = candidate.toLowerCase();
        if (normalizedKeywords.some((keyword) => normalized.includes(keyword))) {
            return extractedUrl;
        }
    }
    return undefined;
}

function buildAdsContextText(values: Array<string | undefined>) {
    const keywords = [
        "pulsera",
        "glowsync",
        "audioritm",
        "beatband",
        "concierto",
        "control",
        "led",
        "alcancia",
        "ventilador",
        "tatuaje",
    ];

    const selected = values
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length >= 4)
        .filter((value) => !/^https?:\/\//i.test(value))
        .filter((value) => keywords.some((keyword) => value.toLowerCase().includes(keyword)))
        .slice(0, 6);

    if (selected.length === 0) return undefined;
    return sanitizeAttributionContextText(selected.join(" | "));
}

function logInboundAttributionSummary(attribution?: InboundAttribution) {
    if (!attribution) return;

    console.info("[Webhook][Attribution]", {
        conversionSource: attribution.conversionSource || null,
        entryPointConversionSource: attribution.entryPointConversionSource || null,
        entryPointConversionExternalSource: attribution.entryPointConversionExternalSource || null,
        entryPointConversionExternalMedium: attribution.entryPointConversionExternalMedium || null,
        entryPointConversionApp: attribution.entryPointConversionApp || null,
        hasAdTitle: Boolean(attribution.adTitle),
        hasAdBody: Boolean(attribution.adBody),
        hasAdContextText: Boolean(attribution.adContextText),
        hasAdSourceUrl: Boolean(attribution.adSourceUrl),
        hasAdMediaUrl: Boolean(attribution.adMediaUrl),
        hasAdThumbnailUrl: Boolean(attribution.adThumbnailUrl),
        adMediaType: attribution.adMediaType || null,
        hasDecodedConversionData: Boolean(attribution.decodedConversionData),
        hasDecodedCtwaPayload: Boolean(attribution.decodedCtwaPayload),
    });
}

function decodeBase64ToTextLegacy(value: string | undefined) {
    if (!value) return undefined;

    try {
        const decoded = Buffer.from(value, "base64").toString("utf8").trim();
        if (!decoded) return undefined;
        if (/[\u0000-\u0008\u000B-\u001F]/.test(decoded)) return undefined;
        return decoded;
    } catch {
        return undefined;
    }
}

function extractExternalAdReply(messageNode: unknown): JsonObject | null {
    const message = asRecord(unwrapMessageNode(messageNode));
    if (!message) return null;

    const contextCandidates = [
        getNestedRecord(getNestedRecord(message, "extendedTextMessage"), "contextInfo"),
        getNestedRecord(getNestedRecord(message, "imageMessage"), "contextInfo"),
        getNestedRecord(getNestedRecord(message, "videoMessage"), "contextInfo"),
        getNestedRecord(getNestedRecord(message, "documentMessage"), "contextInfo"),
    ];

    for (const contextInfo of contextCandidates) {
        const externalAdReply = getNestedRecordAny(contextInfo, [
            "externalAdReply",
            "ExternalAdReply",
            "externalAdReplyInfo",
            "ExternalAdReplyInfo",
            "externalAdReplyContext",
            "ExternalAdReplyContext",
            "quotedAd",
            "QuotedAd",
        ]);
        if (externalAdReply) {
            return externalAdReply;
        }
    }

    return null;
}

function extractMessageContextCandidates(messageNode: unknown): JsonObject[] {
    const message = asRecord(unwrapMessageNode(messageNode));
    if (!message) return [];

    return [
        getNestedRecordAny(message, ["messageContextInfo", "MessageContextInfo", "contextInfo", "ContextInfo"]),
        getNestedRecordAny(getNestedRecordAny(message, ["extendedTextMessage", "ExtendedTextMessage"]), ["contextInfo", "ContextInfo"]),
        getNestedRecordAny(getNestedRecordAny(message, ["imageMessage", "ImageMessage"]), ["contextInfo", "ContextInfo"]),
        getNestedRecordAny(getNestedRecordAny(message, ["videoMessage", "VideoMessage"]), ["contextInfo", "ContextInfo"]),
        getNestedRecordAny(getNestedRecordAny(message, ["documentMessage", "DocumentMessage"]), ["contextInfo", "ContextInfo"]),
    ].filter((entry): entry is JsonObject => Boolean(entry));
}

function extractInboundAttribution(
    info: JsonObject,
    messageNode: unknown,
    rawPayload?: unknown,
): InboundAttribution | undefined {
    const payloadRecord = asRecord(rawPayload);
    const payloadEventRecord = asRecord(payloadRecord?.event);
    const msgMetaInfo = getNestedRecordAny(info, ["MsgMetaInfo", "msgMetaInfo"]);
    const directContextInfo = getNestedRecordAny(info, ["contextInfo", "ContextInfo"]);
    const nestedContextInfo = getNestedRecordAny(msgMetaInfo, ["contextInfo", "ContextInfo"]);
    const payloadContextInfo = getNestedRecordAny(payloadRecord, ["contextInfo", "ContextInfo"]);
    const payloadEventContextInfo = getNestedRecordAny(payloadEventRecord, ["contextInfo", "ContextInfo"]);
    const messageContextCandidates = extractMessageContextCandidates(messageNode);
    const contextCandidates = [
        nestedContextInfo,
        directContextInfo,
        payloadContextInfo,
        payloadEventContextInfo,
        ...messageContextCandidates,
    ].filter(
        (entry): entry is JsonObject => Boolean(entry),
    );
    const externalAdReply = extractExternalAdReply(messageNode);
    const externalAdReplyStrings = collectStringValuesDeep(externalAdReply);
    const contextStrings = contextCandidates.flatMap((context) => collectStringValuesDeep(context));

    const contextValues = (...keys: string[]) =>
        contextCandidates.flatMap((context) =>
            keys.map((key) => getStringCaseInsensitive(context, key)),
        );

    const conversionSource = pickFirstString(
        ...contextValues("conversionSource", "conversion_source"),
        getStringCaseInsensitive(info, "conversionSource"),
        getStringCaseInsensitive(payloadEventRecord, "conversionSource"),
        getStringCaseInsensitive(payloadRecord, "conversionSource"),
    );
    const entryPointConversionSource = pickFirstString(
        ...contextValues("entryPointConversionSource", "entry_point_conversion_source"),
        getStringCaseInsensitive(info, "entryPointConversionSource"),
        getStringCaseInsensitive(payloadEventRecord, "entryPointConversionSource"),
        getStringCaseInsensitive(payloadRecord, "entryPointConversionSource"),
    );
    const entryPointConversionExternalSource = pickFirstString(
        ...contextValues("entryPointConversionExternalSource", "entry_point_conversion_external_source"),
        getStringCaseInsensitive(info, "entryPointConversionExternalSource"),
        getStringCaseInsensitive(payloadEventRecord, "entryPointConversionExternalSource"),
        getStringCaseInsensitive(payloadRecord, "entryPointConversionExternalSource"),
    );
    const entryPointConversionExternalMedium = pickFirstString(
        ...contextValues("entryPointConversionExternalMedium", "entry_point_conversion_external_medium"),
        getStringCaseInsensitive(info, "entryPointConversionExternalMedium"),
        getStringCaseInsensitive(payloadEventRecord, "entryPointConversionExternalMedium"),
        getStringCaseInsensitive(payloadRecord, "entryPointConversionExternalMedium"),
    );
    const entryPointConversionApp = pickFirstString(
        ...contextValues("entryPointConversionApp", "entry_point_conversion_app"),
        getStringCaseInsensitive(info, "entryPointConversionApp"),
        getStringCaseInsensitive(payloadEventRecord, "entryPointConversionApp"),
        getStringCaseInsensitive(payloadRecord, "entryPointConversionApp"),
    );
    const ctwaSignals = pickFirstString(
        ...contextValues("ctwaSignals", "ctwa_signals"),
        getStringCaseInsensitive(info, "ctwaSignals"),
        getStringCaseInsensitive(payloadEventRecord, "ctwaSignals"),
        getStringCaseInsensitive(payloadRecord, "ctwaSignals"),
    );
    const conversionData = pickFirstString(
        ...contextValues("conversionData", "conversion_data"),
        getStringCaseInsensitive(payloadEventRecord, "conversionData"),
        getStringCaseInsensitive(payloadRecord, "conversionData"),
    );
    const ctwaPayload = pickFirstString(
        ...contextValues("ctwaPayload", "ctwa_payload"),
        getStringCaseInsensitive(payloadEventRecord, "ctwaPayload"),
        getStringCaseInsensitive(payloadRecord, "ctwaPayload"),
    );
    const adTitle = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "title"),
        getStringCaseInsensitive(externalAdReply, "headline"),
        pickStringWithKeywords(externalAdReplyStrings, ["pulsera", "led", "glow", "audio", "beatband", "concierto"]),
    );
    const adBody = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "body"),
        getStringCaseInsensitive(externalAdReply, "description"),
        pickStringWithKeywords(externalAdReplyStrings, ["pulsera", "led", "glow", "audio", "beatband", "concierto"]),
        pickStringWithKeywords(contextStrings, ["pulsera", "led", "glow", "audio", "beatband", "concierto"]),
        ...contextValues("text", "caption"),
    );
    const adSourceUrl = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "sourceUrl"),
        getStringCaseInsensitive(externalAdReply, "sourceURL"),
        getStringCaseInsensitive(externalAdReply, "matchedText"),
        getStringCaseInsensitive(externalAdReply, "canonicalUrl"),
        pickUrlWithKeywords(externalAdReplyStrings, ["fb.me", "facebook", "instagram", "ads", "anuncio", "referral"]),
        pickUrlWithKeywords(contextStrings, ["fb.me", "facebook", "instagram", "ads", "anuncio", "referral"]),
    );
    const adThumbnailUrl = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "thumbnailUrl"),
        getStringCaseInsensitive(externalAdReply, "thumbnailURL"),
        getStringCaseInsensitive(externalAdReply, "jpegThumbnailUrl"),
        getStringCaseInsensitive(externalAdReply, "previewUrl"),
    );
    const adMediaUrl = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "mediaUrl"),
        getStringCaseInsensitive(externalAdReply, "mediaURL"),
        getStringCaseInsensitive(externalAdReply, "videoUrl"),
        getStringCaseInsensitive(externalAdReply, "imageUrl"),
        adThumbnailUrl,
    );
    const adMediaType = pickFirstString(
        getStringCaseInsensitive(externalAdReply, "mediaType"),
        getStringCaseInsensitive(externalAdReply, "previewType"),
    );
    const decodedConversionData = decodeBase64ToText(conversionData) || decodeBase64ToTextLegacy(conversionData);
    const decodedCtwaPayload = decodeBase64ToText(ctwaPayload) || decodeBase64ToTextLegacy(ctwaPayload);
    const adContextText = buildAdsContextText([
        adTitle,
        adBody,
        adSourceUrl,
        adMediaUrl,
        adThumbnailUrl,
        decodedConversionData,
        decodedCtwaPayload,
        ...externalAdReplyStrings,
        ...contextStrings,
    ]);

    const attribution: InboundAttribution = {
        conversionSource,
        entryPointConversionSource,
        entryPointConversionExternalSource,
        entryPointConversionExternalMedium,
        entryPointConversionApp,
        ctwaSignals,
        adTitle,
        adBody,
        adSourceUrl,
        adMediaUrl,
        adThumbnailUrl,
        adMediaType,
        adContextText,
        conversionData,
        ctwaPayload,
        decodedConversionData,
        decodedCtwaPayload,
    };

    const hasAnyValue = Object.values(attribution).some((value) => {
        if (typeof value === "string") return value.trim().length > 0;
        return false;
    });

    if (hasAnyValue) {
        return attribution;
    }

    return undefined;
}

function resolveCustomerName(payload: WuzapiWebhookPayload, info: JsonObject) {
    const eventRecord = asRecord(payload.event);
    const candidates = [
        getString(info, "PushName"),
        getString(info, "pushName"),
        getString(info, "SenderName"),
        getString(info, "senderName"),
        getString(info, "Notify"),
        getString(info, "notify"),
        getString(info, "VerifiedName"),
        getString(info, "verifiedName"),
        getString(info, "FullName"),
        getString(info, "fullName"),
        getString(eventRecord, "PushName"),
        getString(eventRecord, "pushName"),
        getString(eventRecord, "SenderName"),
        getString(eventRecord, "senderName"),
        getString(eventRecord, "Notify"),
        getString(eventRecord, "notify"),
    ];

    return candidates
        .map((candidate) => normalizeCustomerNameValue(candidate))
        .find(Boolean);
}

function normalizeComparableName(value: string | undefined) {
    return value
        ?.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function resolveOutboundContactName(payload: WuzapiWebhookPayload, info: JsonObject) {
    const eventRecord = asRecord(payload.event);

    const senderIdentityNames = [
        getString(info, "PushName"),
        getString(info, "pushName"),
        getString(info, "SenderName"),
        getString(info, "senderName"),
        getString(eventRecord, "PushName"),
        getString(eventRecord, "pushName"),
        getString(eventRecord, "SenderName"),
        getString(eventRecord, "senderName"),
    ]
        .map((value) => normalizeCustomerNameValue(value))
        .filter((value): value is string => Boolean(value))
        .map((value) => normalizeComparableName(value))
        .filter((value): value is string => Boolean(value));

    const senderIdentitySet = new Set(senderIdentityNames);

    const recipientCandidates = [
        getString(info, "RecipientName"),
        getString(info, "recipientName"),
        getString(info, "RecipientPushName"),
        getString(info, "recipientPushName"),
        getString(info, "ChatName"),
        getString(info, "chatName"),
        getString(info, "RemoteName"),
        getString(info, "remoteName"),
        getString(info, "Notify"),
        getString(info, "notify"),
        getString(eventRecord, "RecipientName"),
        getString(eventRecord, "recipientName"),
        getString(eventRecord, "RecipientPushName"),
        getString(eventRecord, "recipientPushName"),
        getString(eventRecord, "ChatName"),
        getString(eventRecord, "chatName"),
        getString(eventRecord, "RemoteName"),
        getString(eventRecord, "remoteName"),
        getString(eventRecord, "Notify"),
        getString(eventRecord, "notify"),
    ];

    for (const candidate of recipientCandidates) {
        const normalized = normalizeCustomerNameValue(candidate);
        if (!normalized) continue;

        const comparable = normalizeComparableName(normalized);
        if (comparable && senderIdentitySet.has(comparable)) {
            continue;
        }

        return normalized;
    }

    return undefined;
}

type MediaPayload = {
    type?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaFileName?: string;
};

type DownloadRequestPayload = {
    Url: string;
    DirectPath?: string;
    MediaKey: string;
    Mimetype: string;
    FileEncSHA256?: string;
    FileSHA256: string;
    FileLength: number;
};

type ExtractedMessageDetails = {
    text: string;
    type: "text" | "image" | "document" | "audio" | "video";
    mimeType?: string;
    fileName?: string;
    ignore?: boolean;
    downloadKind?: "image" | "audio" | "video" | "document" | "sticker";
    downloadPayload?: DownloadRequestPayload;
    previewDataUrl?: string;
};

type ExtractedReactionEvent = {
    targetProviderMessageId: string;
    reaction: string | null;
};

type ExtractedDeleteEvent = {
    targetProviderMessageId: string;
};

function isLidAddress(value: unknown) {
    if (!value) return false;

    if (typeof value === "string") {
        return normalizeJidValue(value).toLowerCase().includes("@lid");
    }

    if (typeof value === "object") {
        const maybeObject = value as Record<string, unknown>;
        const server = maybeObject.Server || maybeObject.server || maybeObject.RawServer || maybeObject.rawServer;
        if (typeof server === "string" && server.toLowerCase().includes("lid")) {
            return true;
        }

        const jidString = maybeObject.String || maybeObject.string;
        if (typeof jidString === "string" && isLidAddress(jidString)) {
            return true;
        }
    }

    return false;
}

function normalizeJidValue(value: string) {
    return value.replace(/:\d+@/, "@").trim();
}

function extractJidPhone(value: unknown): string {
    if (!value) return "";
    if (isLidAddress(value)) return "";

    if (typeof value === "string") {
        const normalized = normalizeJidValue(value);
        const candidate = normalized.includes("@")
            ? normalized.split("@")[0]
            : normalized;
        return normalizePhoneDigits(candidate);
    }

    if (typeof value === "object") {
        const maybeObject = value as Record<string, unknown>;
        const user = maybeObject.User || maybeObject.user;
        if (typeof user === "string") {
            return normalizePhoneDigits(user);
        }

        const jidString = maybeObject.String || maybeObject.string;
        if (typeof jidString === "string") {
            return extractJidPhone(jidString);
        }
    }

    return "";
}

function pickPreferredPhoneSource(info: JsonObject) {
    const candidates = [
        info["Chat"],
        info["chat"],
        info["SenderAlt"],
        info["senderAlt"],
        info["RecipientAlt"],
        info["recipientAlt"],
        info["Sender"],
        info["sender"],
    ];

    return (
        candidates.find((candidate) => candidate && !isLidAddress(candidate)) ||
        candidates.find(Boolean) ||
        ""
    );
}

function pickPreferredOutboundPhoneSource(info: JsonObject) {
    const candidates = [
        info["RecipientAlt"],
        info["recipientAlt"],
        info["Recipient"],
        info["recipient"],
        info["Chat"],
        info["chat"],
        info["RemoteJid"],
        info["remoteJid"],
        info["SenderAlt"],
        info["senderAlt"],
    ];

    return (
        candidates.find((candidate) => candidate && !isLidAddress(candidate)) ||
        candidates.find(Boolean) ||
        ""
    );
}

function unwrapMessageNode(node: unknown): unknown {
    const record = asRecord(node);
    if (!record) return node;

    const deviceSentMessage = getNestedRecord(record, "deviceSentMessage");
    if (deviceSentMessage?.message) return unwrapMessageNode(deviceSentMessage.message);

    const editedMessage = getNestedRecord(record, "editedMessage");
    if (editedMessage?.message) return unwrapMessageNode(editedMessage.message);

    const ephemeralMessage = getNestedRecord(record, "ephemeralMessage");
    if (ephemeralMessage?.message) return unwrapMessageNode(ephemeralMessage.message);

    const viewOnceMessage = getNestedRecord(record, "viewOnceMessage");
    if (viewOnceMessage?.message) return unwrapMessageNode(viewOnceMessage.message);

    const viewOnceMessageV2 = getNestedRecord(record, "viewOnceMessageV2");
    if (viewOnceMessageV2?.message) return unwrapMessageNode(viewOnceMessageV2.message);

    return record;
}

function extFromMimeType(mimeType: string) {
    if (mimeType.includes("jpeg")) return ".jpg";
    if (mimeType.includes("png")) return ".png";
    if (mimeType.includes("webp")) return ".webp";
    if (mimeType.includes("pdf")) return ".pdf";
    if (mimeType.includes("ogg")) return ".ogg";
    if (mimeType.includes("mpeg")) return ".mp3";
    if (mimeType.includes("mp4")) return ".mp4";
    if (mimeType.includes("quicktime")) return ".mov";
    if (mimeType.includes("plain")) return ".txt";
    return "";
}

function buildDownloadPayload(record: JsonObject | null): DownloadRequestPayload | undefined {
    if (!record) return undefined;

    const url = getString(record, "URL");
    const mediaKey = getString(record, "mediaKey");
    const mimeType = getString(record, "mimetype");
    const fileSha256 = getString(record, "fileSHA256");
    const fileLength = getNumber(record, "fileLength");

    if (!url || !mediaKey || !mimeType || !fileSha256 || !fileLength) {
        return undefined;
    }

    return {
        Url: url,
        DirectPath: getString(record, "directPath"),
        MediaKey: mediaKey,
        Mimetype: mimeType,
        FileEncSHA256: getString(record, "fileEncSHA256"),
        FileSHA256: fileSha256,
        FileLength: fileLength,
    };
}

function decodeDataUrl(dataUrl: string) {
    const [, base64 = ""] = dataUrl.split(",", 2);
    return Buffer.from(base64, "base64");
}

function extractMessageDetails(messageNode: unknown): ExtractedMessageDetails {
    const message = asRecord(unwrapMessageNode(messageNode));

    if (!message) {
        return {
            text: "[Mensaje de WhatsApp]",
            type: "text" as const,
            ignore: true,
        };
    }

    const protocolMessage = getNestedRecord(message, "protocolMessage");
    if (protocolMessage) {
        return {
            text: "[Evento de sistema de WhatsApp]",
            type: "text" as const,
            ignore: true,
        };
    }

    const conversation = getString(message, "conversation");
    if (conversation) {
        return { text: conversation, type: "text" as const };
    }

    const extendedTextMessage = getNestedRecord(message, "extendedTextMessage");
    const extendedText = getString(extendedTextMessage, "text");
    if (extendedText) {
        return { text: extendedText, type: "text" as const };
    }

    const imageMessage = getNestedRecord(message, "imageMessage");
    if (imageMessage) {
        return {
            text: getString(imageMessage, "caption") || "[Imagen]",
            type: "image" as const,
            mimeType: getString(imageMessage, "mimetype"),
            fileName: getString(imageMessage, "fileName"),
            downloadKind: "image",
            downloadPayload: buildDownloadPayload(imageMessage),
            previewDataUrl: getString(imageMessage, "JPEGThumbnail")
                ? `data:image/jpeg;base64,${getString(imageMessage, "JPEGThumbnail")}`
                : undefined,
        };
    }

    const documentMessage = getNestedRecord(message, "documentMessage");
    if (documentMessage) {
        return {
            text: getString(documentMessage, "caption") || getString(documentMessage, "fileName") || "[Documento]",
            type: "document" as const,
            mimeType: getString(documentMessage, "mimetype"),
            fileName: getString(documentMessage, "fileName"),
            downloadKind: "document",
            downloadPayload: buildDownloadPayload(documentMessage),
        };
    }

    const audioMessage = getNestedRecord(message, "audioMessage");
    if (audioMessage) {
        return {
            text: "[Audio]",
            type: "audio" as const,
            mimeType: getString(audioMessage, "mimetype"),
            downloadKind: "audio",
            downloadPayload: buildDownloadPayload(audioMessage),
        };
    }

    const videoMessage = getNestedRecord(message, "videoMessage");
    if (videoMessage) {
        return {
            text: getString(videoMessage, "caption") || "[Video]",
            type: "video" as const,
            mimeType: getString(videoMessage, "mimetype"),
            fileName: getString(videoMessage, "fileName"),
            downloadKind: "video",
            downloadPayload: buildDownloadPayload(videoMessage),
        };
    }

    const stickerMessage = getNestedRecord(message, "stickerMessage");
    if (stickerMessage) {
        return {
            text: "[Sticker]",
            type: "image" as const,
            mimeType: getString(stickerMessage, "mimetype"),
            downloadKind: "sticker",
            downloadPayload: buildDownloadPayload(stickerMessage),
        };
    }

    return {
        text: "[Mensaje de WhatsApp]",
        type: "text",
        ignore: true,
    };
}

function extractReactionEvent(messageNode: unknown): ExtractedReactionEvent | null {
    const message = asRecord(unwrapMessageNode(messageNode));
    if (!message) return null;

    const reactionMessage = getNestedRecord(message, "reactionMessage");
    if (!reactionMessage) return null;

    const reactionKey = getNestedRecord(reactionMessage, "key") || getNestedRecord(reactionMessage, "Key");
    const targetProviderMessageId = (
        getString(reactionKey, "id") ||
        getString(reactionKey, "ID") ||
        getString(reactionMessage, "id") ||
        getString(reactionMessage, "ID") ||
        getString(reactionMessage, "stanzaId") ||
        ""
    ).trim();

    if (!targetProviderMessageId) return null;

    const reactionValue = (getString(reactionMessage, "text") || getString(reactionMessage, "Text") || "").trim();
    return {
        targetProviderMessageId,
        reaction: reactionValue || null,
    };
}

function isDeleteProtocolType(value: unknown) {
    if (typeof value === "number") {
        return value === 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toUpperCase();
        return (
            normalized === "0" ||
            normalized === "REVOKE" ||
            normalized.includes("REVOKE") ||
            normalized.includes("DELETE")
        );
    }

    return false;
}

function extractDeleteEvent(messageNode: unknown): ExtractedDeleteEvent | null {
    const message = asRecord(unwrapMessageNode(messageNode));
    if (!message) return null;

    const protocolMessage = getNestedRecord(message, "protocolMessage");
    if (!protocolMessage) return null;

    const protocolType = protocolMessage.type ?? protocolMessage.Type;
    if (protocolType !== undefined && !isDeleteProtocolType(protocolType)) {
        return null;
    }

    const protocolKey = getNestedRecord(protocolMessage, "key") || getNestedRecord(protocolMessage, "Key");
    const targetProviderMessageId = (
        getString(protocolKey, "id") ||
        getString(protocolKey, "ID") ||
        getString(protocolMessage, "id") ||
        getString(protocolMessage, "ID") ||
        getString(protocolMessage, "stanzaId") ||
        getString(protocolMessage, "stanzaID") ||
        ""
    ).trim();

    if (!targetProviderMessageId) return null;

    return { targetProviderMessageId };
}

async function applyReactionEvent(event: ExtractedReactionEvent, phoneCandidates: string[]) {
    const normalizedCandidates = uniquePhoneCandidates(phoneCandidates);
    const phoneClauses = buildPhoneMatchClauses(normalizedCandidates);

    const scopedWhere = {
        providerMessageId: event.targetProviderMessageId,
        sourceType: MESSAGE_SOURCE_WUZAPI,
        ...(phoneClauses.length > 0
            ? {
                conversation: {
                    contact: {
                        OR: phoneClauses,
                    },
                },
            }
            : {}),
    };

    let targetMessage = await prisma.message.findFirst({
        where: scopedWhere,
        select: {
            id: true,
            conversationId: true,
            reaction: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    if (!targetMessage && phoneClauses.length > 0) {
        targetMessage = await prisma.message.findFirst({
            where: {
                providerMessageId: event.targetProviderMessageId,
                sourceType: MESSAGE_SOURCE_WUZAPI,
            },
            select: {
                id: true,
                conversationId: true,
                reaction: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }

    if (!targetMessage) {
        console.warn("[Webhook] Reaction ignored because target message was not found", {
            targetProviderMessageId: event.targetProviderMessageId,
            phoneCandidates: normalizedCandidates,
        });
        return;
    }

    if (targetMessage.reaction === event.reaction) {
        return;
    }

    await prisma.message.update({
        where: { id: targetMessage.id },
        data: { reaction: event.reaction },
    });

    await prisma.conversation.update({
        where: { id: targetMessage.conversationId },
        data: { updatedAt: new Date() },
    });

    revalidatePath("/dashboard/inbox");
}

async function applyDeleteEvent(event: ExtractedDeleteEvent, phoneCandidates: string[]) {
    const normalizedCandidates = uniquePhoneCandidates(phoneCandidates);
    const phoneClauses = buildPhoneMatchClauses(normalizedCandidates);

    const scopedWhere = {
        providerMessageId: event.targetProviderMessageId,
        sourceType: MESSAGE_SOURCE_WUZAPI,
        ...(phoneClauses.length > 0
            ? {
                conversation: {
                    contact: {
                        OR: phoneClauses,
                    },
                },
            }
            : {}),
    };

    let targetMessage = await prisma.message.findFirst({
        where: scopedWhere,
        select: {
            id: true,
            conversationId: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    if (!targetMessage) {
        targetMessage = await prisma.message.findFirst({
            where: {
                providerMessageId: event.targetProviderMessageId,
                sourceType: MESSAGE_SOURCE_WUZAPI,
            },
            select: {
                id: true,
                conversationId: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }

    if (!targetMessage) {
        console.warn("[Webhook] Delete event ignored because target message was not found", {
            targetProviderMessageId: event.targetProviderMessageId,
            phoneCandidates: normalizedCandidates,
        });
        return;
    }

    await prisma.message.delete({
        where: { id: targetMessage.id },
    });

    await prisma.conversation.update({
        where: { id: targetMessage.conversationId },
        data: { updatedAt: new Date() },
    });

    revalidatePath("/dashboard/inbox");
}

function resolvePhoneFromInfo(info: JsonObject, isFromMe: boolean) {
    return resolvePhoneCandidatesFromInfo(info, isFromMe)[0] || "";
}

function resolvePhoneCandidatesFromInfo(info: JsonObject, isFromMe: boolean) {
    const candidates = isFromMe
        ? [
            info["RecipientAlt"],
            info["recipientAlt"],
            info["Recipient"],
            info["recipient"],
            info["Chat"],
            info["chat"],
            info["RemoteJid"],
            info["remoteJid"],
        ]
        : [
            info["Chat"],
            info["chat"],
            info["SenderAlt"],
            info["senderAlt"],
            info["RecipientAlt"],
            info["recipientAlt"],
            info["Sender"],
            info["sender"],
        ];

    return uniquePhoneCandidates(candidates.map((candidate) => extractJidPhone(candidate)));
}

async function findContactByPhoneCandidates(phoneCandidates: string[]) {
    const phoneClauses = buildPhoneMatchClauses(phoneCandidates);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: {
            OR: phoneClauses,
        },
    });
}

function resolveProviderMessageId(info: JsonObject) {
    return (
        getString(info, "ID") ||
        getString(info, "Id") ||
        getString(info, "id") ||
        getString(info, "MessageID") ||
        getString(info, "messageId") ||
        ""
    ).trim();
}

function stringContainsNonDirectJid(value: string) {
    const normalized = normalizeJidValue(value).toLowerCase();
    return normalized.includes("@g.us") || normalized.includes("@broadcast") || normalized.includes("@newsletter");
}

function valueContainsNonDirectJid(value: unknown): boolean {
    if (!value) return false;

    if (typeof value === "string") {
        return stringContainsNonDirectJid(value);
    }

    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return Object.values(record).some((entry) => valueContainsNonDirectJid(entry));
    }

    return false;
}

function isNonDirectChat(info: JsonObject) {
    const explicitGroupFlag = getBoolean(info, "IsGroup") ?? getBoolean(info, "isGroup");
    if (explicitGroupFlag) {
        return true;
    }

    const candidates = [
        info["Chat"],
        info["chat"],
        info["RemoteJid"],
        info["remoteJid"],
        info["Sender"],
        info["sender"],
        info["Recipient"],
        info["recipient"],
        info["MessageSource"],
        info["messageSource"],
    ];

    return candidates.some((candidate) => valueContainsNonDirectJid(candidate));
}

function normalizeIncomingPayload(raw: unknown): WuzapiWebhookPayload {
    const payload = asRecord(raw);
    if (!payload) {
        return {};
    }

    const jsonData = getString(payload, "jsonData");
    if (!jsonData) {
        return payload as WuzapiWebhookPayload;
    }

    try {
        const parsed = JSON.parse(jsonData) as WuzapiWebhookPayload;
        return {
            ...parsed,
            token: getString(payload, "token") || getString(payload, "Token") || parsed.token,
            base64: getString(payload, "base64") || parsed.base64,
            mimeType: getString(payload, "mimeType") || parsed.mimeType,
            fileName: getString(payload, "fileName") || parsed.fileName,
            s3: parsed.s3,
        };
    } catch {
        return payload as WuzapiWebhookPayload;
    }
}

async function saveIncomingMedia(payload: WuzapiWebhookPayload, details: ExtractedMessageDetails) {
    const fileName =
        payload.s3?.fileName ||
        payload.fileName ||
        details.fileName ||
        `wa-${Date.now()}${extFromMimeType(payload.s3?.mimeType || payload.mimeType || details.mimeType || "")}`;
    const mimeType = payload.s3?.mimeType || payload.mimeType || details.mimeType || undefined;

    if (payload.s3?.url) {
        return {
            type: details.type,
            mediaUrl: payload.s3.url,
            mediaType: mimeType,
            mediaFileName: fileName,
        } satisfies MediaPayload;
    }

    if (!payload.base64) {
        if (details.downloadKind && details.downloadPayload) {
            try {
                const downloaded = await downloadWuzapiMedia(details.downloadKind, details.downloadPayload);
                if (downloaded.Data) {
                    const uploadsDir = path.join(process.cwd(), "public", "uploads");
                    await mkdir(uploadsDir, { recursive: true });
                    const downloadedMimeType = downloaded.Mimetype || mimeType || details.downloadPayload.Mimetype;
                    const extension = path.extname(fileName) || extFromMimeType(downloadedMimeType || "") || "";
                    const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
                    const absoluteFilePath = path.join(uploadsDir, safeFileName);
                    await writeFile(absoluteFilePath, decodeDataUrl(downloaded.Data));

                    return {
                        type: details.type,
                        mediaUrl: `/uploads/${safeFileName}`,
                        mediaType: downloadedMimeType,
                        mediaFileName: fileName,
                    } satisfies MediaPayload;
                }
            } catch (error) {
                console.error("[Webhook] Failed to download media from WuzAPI:", error);
            }
        }

        if (details.previewDataUrl) {
            const uploadsDir = path.join(process.cwd(), "public", "uploads");
            await mkdir(uploadsDir, { recursive: true });
            const extension = path.extname(fileName) || ".jpg";
            const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
            const absoluteFilePath = path.join(uploadsDir, safeFileName);
            await writeFile(absoluteFilePath, decodeDataUrl(details.previewDataUrl));

            return {
                type: details.type,
                mediaUrl: `/uploads/${safeFileName}`,
                mediaType: mimeType || "image/jpeg",
                mediaFileName: fileName,
            } satisfies MediaPayload;
        }

        return {
            type: details.type,
            mediaType: mimeType,
            mediaFileName: fileName,
        } satisfies MediaPayload;
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const extension = path.extname(fileName) || extFromMimeType(mimeType || "") || "";
    const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
    const absoluteFilePath = path.join(uploadsDir, safeFileName);
    const buffer = Buffer.from(payload.base64, "base64");
    await writeFile(absoluteFilePath, buffer);

    return {
        type: details.type,
        mediaUrl: `/uploads/${safeFileName}`,
        mediaType: mimeType,
        mediaFileName: fileName,
    } satisfies MediaPayload;
}

async function storeOutboundEcho(
    phoneCandidates: string[],
    text: string,
    media: MediaPayload,
    sourceId: string | null,
    customerName?: string,
    providerMessageId?: string,
    occurredAt?: Date | null,
) {
    if (providerMessageId) {
        const existingMessage = await prisma.message.findFirst({
            where: {
                providerMessageId,
                sourceType: MESSAGE_SOURCE_WUZAPI,
            },
            include: { conversation: true },
        });

        if (existingMessage) {
            const shouldPauseBot = existingMessage.senderType !== "bot";
            await prisma.message.update({
                where: { id: existingMessage.id },
                data: {
                    status: existingMessage.status === "sent" ? existingMessage.status : "sent",
                    ...(occurredAt ? { createdAt: occurredAt } : {}),
                },
            });

            await prisma.conversation.update({
                where: { id: existingMessage.conversationId },
                data: {
                    updatedAt: new Date(),
                    ...(shouldPauseBot ? { botActive: false } : {}),
                },
            });

            revalidatePath("/dashboard/inbox");
            return;
        }
    }

    const normalizedCandidates = uniquePhoneCandidates(phoneCandidates);
    if (normalizedCandidates.length === 0) return;

    const normalizedCustomerName = normalizeCustomerNameValue(customerName);
    let contact = await findContactByPhoneCandidates(normalizedCandidates);

    if (!contact) {
        const primaryPhone = normalizedCandidates[0];
        try {
            contact = await prisma.contact.create({
                data: {
                    phone: primaryPhone,
                    name: normalizedCustomerName,
                    status: "lead",
                },
            });
        } catch (error) {
            console.warn("[Webhook] Failed to create contact from outbound echo, retrying lookup", {
                phone: primaryPhone,
                providerMessageId,
                error,
            });
            contact = await findContactByPhoneCandidates(normalizedCandidates);
        }
    } else if (normalizedCustomerName && !normalizeCustomerNameValue(contact.name)) {
        contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: normalizedCustomerName },
        });
    }

    if (!contact) {
        console.warn("[Webhook] Outbound echo ignored because contact could not be resolved", {
            providerMessageId,
            phoneCandidates: normalizedCandidates,
        });
        return;
    }

    const shouldAwaitInitialAvatarRefresh = !contact.whatsappAvatarCheckedAt;
    if (shouldAwaitInitialAvatarRefresh) {
        try {
            await refreshWhatsAppAvatarForContact(contact.id, { force: true });
        } catch (avatarError) {
            console.warn("[Webhook] Failed to refresh WhatsApp avatar for first outbound echo", avatarError);
        }
    } else {
        void refreshWhatsAppAvatarForContact(contact.id).catch((avatarError) => {
            console.warn("[Webhook] Failed to refresh WhatsApp avatar for outbound echo", avatarError);
        });
    }

    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: contact.id,
        sourceType: MESSAGE_SOURCE_WUZAPI,
        sourceId,
        defaults: {
            botActive: false,
        },
    });

    const duplicate = await prisma.message.findFirst({
        where: {
            conversationId: conversation.id,
            sourceType: MESSAGE_SOURCE_WUZAPI,
            OR: [
                ...(providerMessageId ? [{ providerMessageId }] : []),
                ...(providerMessageId
                    ? [{
                        providerMessageId: null,
                        content: text,
                        direction: "outbound",
                        type: media.type || "text",
                        createdAt: { gte: new Date(Date.now() - 15000) },
                    }]
                    : [{
                        content: text,
                        direction: "outbound",
                        type: media.type || "text",
                        createdAt: { gte: new Date(Date.now() - 15000) },
                    }]),
            ],
        },
    });

    if (duplicate) {
        const shouldPauseBot = duplicate.senderType !== "bot";
        if ((providerMessageId && !duplicate.providerMessageId) || occurredAt) {
            await prisma.message.update({
                where: { id: duplicate.id },
                data: {
                    ...(providerMessageId && !duplicate.providerMessageId ? { providerMessageId } : {}),
                    ...(occurredAt ? { createdAt: occurredAt } : {}),
                },
            });
        }

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
                ...(shouldPauseBot ? { botActive: false } : {}),
            },
        });
        return;
    }

    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: text,
            direction: "outbound",
            status: "sent",
            type: media.type || "text",
            mediaUrl: media.mediaUrl || null,
            mediaType: media.mediaType || null,
            mediaFileName: media.mediaFileName || null,
            senderType: "human",
            providerMessageId: providerMessageId || null,
            sourceType: MESSAGE_SOURCE_WUZAPI,
            sourceId,
            ...(occurredAt ? { createdAt: occurredAt } : {}),
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            botActive: false,
        },
    });

    revalidatePath("/dashboard/inbox");
}

export async function GET() {
    return NextResponse.json({ ok: true, channel: "whatsapp-webhook" });
}

function parseWebhookBody(rawBody: string, contentType: string | null) {
    if (contentType?.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(rawBody));
    }

    try {
        return JSON.parse(rawBody) as unknown;
    } catch {
        return Object.fromEntries(new URLSearchParams(rawBody));
    }
}

function hasValidWuzapiSignature(rawBody: string, headers: Headers) {
    const hmacKey = (process.env.WUZAPI_GLOBAL_HMAC_KEY || "").trim();
    const receivedSignature = (headers.get("x-hmac-signature") || "")
        .trim()
        .replace(/^sha256=/i, "")
        .toLowerCase();
    if (!hmacKey || !/^[a-f0-9]{64}$/.test(receivedSignature)) return false;

    const expectedSignature = crypto.createHmac("sha256", hmacKey).update(rawBody).digest("hex");
    return safeSecretEqual(receivedSignature, expectedSignature);
}

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        const rawPayload = parseWebhookBody(rawBody, req.headers.get("content-type"));
        const payload = normalizeIncomingPayload(rawPayload);
        const hasValidSignature = hasValidWuzapiSignature(rawBody, req.headers);
        let settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>> | null = null;
        let expectedToken = process.env.WUZAPI_USER_TOKEN || "";
        if (!expectedToken) {
            settings = await getSystemSettingsOrDefaults();
            expectedToken = settings.whatsappUserToken || "";
        }
        const receivedToken = payload.token || getBearerToken(req.headers) || req.headers.get("x-api-token") || "";

        if (!hasValidSignature && !expectedToken) {
            return new NextResponse("Webhook not configured", { status: 503 });
        }
        if (!hasValidSignature && !safeSecretEqual(receivedToken, expectedToken)) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        settings ||= await getSystemSettingsOrDefaults();
        const wuzapiSourceId = resolveMessageSourceId(MESSAGE_SOURCE_WUZAPI, settings);

        if (payload.type !== "Message" || !payload.event?.Info) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const info = payload.event.Info;
        if (isNonDirectChat(info)) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const isFromMe = getBoolean(info, "IsFromMe") ?? getBoolean(info, "isFromMe") ?? false;
        const occurredAt = resolveMessageOccurredAt(info, payload.event);
        const phoneCandidates = resolvePhoneCandidatesFromInfo(info, isFromMe);
        const deleteEvent = extractDeleteEvent(payload.event.Message);
        if (deleteEvent) {
            await applyDeleteEvent(deleteEvent, phoneCandidates);
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const reactionEvent = extractReactionEvent(payload.event.Message);
        if (reactionEvent) {
            await applyReactionEvent(reactionEvent, phoneCandidates);
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const messageDetails = extractMessageDetails(payload.event.Message);
        if (messageDetails.ignore) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const media = messageDetails.type !== "text"
            ? await saveIncomingMedia(payload, messageDetails)
            : undefined;

        const phone = phoneCandidates[0] || "";
        const providerMessageId = resolveProviderMessageId(info);

        if (!phone) {
            console.warn("[Webhook] Ignoring message without resolvable phone", {
                isFromMe,
                chat: getString(info, "Chat") || getString(info, "chat"),
                senderAlt: getString(info, "SenderAlt") || getString(info, "senderAlt"),
                recipientAlt: getString(info, "RecipientAlt") || getString(info, "recipientAlt"),
            });
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        if (isFromMe) {
            const outboundContactName = resolveOutboundContactName(payload, info);
            await storeOutboundEcho(
                phoneCandidates,
                messageDetails.text,
                media || {},
                wuzapiSourceId,
                outboundContactName,
                providerMessageId,
                occurredAt,
            );
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const customerName = resolveCustomerName(payload, info);
        const inboundAttribution = extractInboundAttribution(info, payload.event.Message, payload);
        logInboundAttributionSummary(inboundAttribution);

        await processInboundMessage(
            phone,
            messageDetails.text,
            customerName,
            media,
            providerMessageId,
            inboundAttribution,
            {
                sourceType: MESSAGE_SOURCE_WUZAPI,
                sourceId: wuzapiSourceId,
                occurredAt,
            },
        );
        return new NextResponse("EVENT_RECEIVED", { status: 200 });
    } catch (error) {
        console.error("Webhook Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
