"use server";

import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { revalidatePath } from "next/cache";
import { enrichContactFromMessage } from "@/lib/ai-enrichment";
import { resolveMediaToDataUrl } from "@/lib/media-data-url";
import {
    findBestCatalogItem,
    findBestCatalogItemInDevelopment,
    findCatalogAvailabilitySummary,
    getCatalogDevelopmentContext,
    parseCatalogAssetIntent,
    splitCatalogAssets,
} from "@/lib/catalog/catalog";
import { sendWuzapiMediaMessage, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { generateConversationReply } from "@/lib/ai/chatbot";
import { getSystemSettingsOrDefaults, type AppSystemSettings } from "@/lib/system-settings";
import { buildInboundMediaContext, shouldSkipAutoReplyText } from "@/lib/ai/media-understanding";
import { maybeHandleAppointmentBooking } from "@/lib/ai/appointment-booking";
import { processLeadAutomationTurn } from "@/lib/ai/lead-intelligence";
import { buildPhoneMatchClauses, normalizePhoneDigits } from "@/lib/phone";
import { sendMetaMediaMessage, sendMetaTextMessage } from "@/lib/meta-whatsapp";
import {
    normalizeMessageSourceType,
    resolveMessageSourceId,
    type MessageSourceType,
} from "@/lib/message-source";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { markBulkCampaignReplyForContact } from "@/lib/bulk-campaigns";
import { refreshWhatsAppAvatarForContact } from "@/lib/whatsapp-avatar";
import {
    buildInboundAdPreviewFingerprint,
    buildInboundAdPreviewMessageContent,
    normalizeInboundAdPreviewPayload,
    parseInboundAdPreviewMessageContent,
    type InboundAdPreviewPayload,
    INBOUND_AD_PREVIEW_PREFIX,
} from "@/lib/inbound-ad-preview";

const CATALOG_OFFER_EXPIRY_MS = 1000 * 60 * 90;
const KNOWLEDGE_IMAGE_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const KNOWLEDGE_MARKDOWN_LINK_WITH_URL_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const KNOWLEDGE_IMAGE_MIN_SCORE = 3;
const BOT_REPLY_DELAY_MIN_MS = 4000;
const BOT_REPLY_DELAY_MAX_MS = 16000;
const KNOWLEDGE_IMAGE_TOKEN_STOPWORDS = new Set([
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "un",
    "una",
    "y",
    "o",
    "por",
    "para",
    "con",
    "sin",
    "que",
    "quiero",
    "necesito",
    "informacion",
    "info",
    "producto",
    "productos",
    "imagen",
    "imagenes",
    "foto",
    "fotos",
    "manda",
    "mandame",
    "enviar",
    "enviame",
    "tienes",
    "tengo",
    "puedes",
    "puedo",
]);

type CatalogItemMatch = NonNullable<Awaited<ReturnType<typeof findBestCatalogItem>>>;
type KnowledgeImageEntry = {
    label: string;
    imageUrl: string;
    searchableText: string;
    normalizedLabel: string;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampBotDelayMs(value: number, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.round(value), BOT_REPLY_DELAY_MIN_MS), BOT_REPLY_DELAY_MAX_MS);
}

function resolveRandomBotReplyDelayMs(settings: AppSystemSettings) {
    const minMs = clampBotDelayMs(settings.botReplyDelayMinMs || BOT_REPLY_DELAY_MIN_MS, BOT_REPLY_DELAY_MIN_MS);
    const maxMs = clampBotDelayMs(settings.botReplyDelayMaxMs || BOT_REPLY_DELAY_MAX_MS, BOT_REPLY_DELAY_MAX_MS);
    const lower = Math.min(minMs, maxMs);
    const upper = Math.max(minMs, maxMs);

    if (upper <= lower) return lower;

    return lower + Math.floor(Math.random() * (upper - lower + 1));
}

export type InboundAttribution = {
    conversionSource?: string;
    entryPointConversionSource?: string;
    entryPointConversionExternalSource?: string;
    entryPointConversionExternalMedium?: string;
    entryPointConversionApp?: string;
    ctwaSignals?: string;
    adTitle?: string;
    adBody?: string;
    adContextText?: string;
    adSourceUrl?: string;
    adMediaUrl?: string;
    adThumbnailUrl?: string;
    adMediaType?: string;
    conversionData?: string;
    ctwaPayload?: string;
    decodedConversionData?: string;
    decodedCtwaPayload?: string;
};

type InboundMediaPayload = {
    type?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaFileName?: string;
};

export type InboundMessageSource = {
    sourceType?: MessageSourceType | null;
    sourceId?: string | null;
    occurredAt?: Date | null;
};

const FALLBACK_EXTENSION_BY_MIME: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/avif": ".avif",
    "application/pdf": ".pdf",
};

function buildSourceMediaHash(sourceUrl: string) {
    return crypto.createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16);
}

function sanitizeMediaBaseName(fileName: string) {
    const parsed = path.parse(fileName || "media");
    const normalized = (parsed.name || "media")
        .replace(/[^\w-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);

    return normalized || "media";
}

function normalizeMediaExtension(fileName: string, mimeType: string) {
    const parsed = path.parse(fileName || "media");
    const extension = parsed.ext?.toLowerCase();
    if (extension) {
        return extension.startsWith(".") ? extension : `.${extension}`;
    }

    const normalizedMime = (mimeType || "").split(";")[0]?.trim().toLowerCase();
    return FALLBACK_EXTENSION_BY_MIME[normalizedMime] || ".bin";
}

function decodeBase64DataUrl(dataUrl: string) {
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex === -1) {
        throw new Error("Formato de data URL invalido.");
    }

    const payload = dataUrl.slice(commaIndex + 1);
    return Buffer.from(payload, "base64");
}

async function persistAutomatedMediaToUploads(params: {
    sourceUrl: string;
    dataUrl: string;
    fileName: string;
    mimeType: string;
}) {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const sourceHash = buildSourceMediaHash(params.sourceUrl);
    const baseName = sanitizeMediaBaseName(params.fileName);
    const extension = normalizeMediaExtension(params.fileName, params.mimeType);
    const safeFileName = `${baseName}-${sourceHash}${extension}`;

    await writeFile(path.join(uploadsDir, safeFileName), decodeBase64DataUrl(params.dataUrl));

    return {
        mediaUrl: `/uploads/${safeFileName}`,
        sourceHash,
    };
}

function normalizeContactName(name?: string | null) {
    const normalized = name?.trim().replace(/\s+/g, " ") || "";
    if (!normalized) return null;
    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return null;
    }
    return normalized;
}

function appendSection(base: string, extra: string | null) {
    const trimmedBase = base.trim();
    const trimmedExtra = extra?.trim();
    if (!trimmedExtra) return trimmedBase;
    if (!trimmedBase) return trimmedExtra;
    return `${trimmedBase}\n\n${trimmedExtra}`;
}

function normalizeCatalogComparableText(value: string | null | undefined) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeAttributionToken(value: string | null | undefined) {
    return normalizeCatalogComparableText(value).replace(/\s+/g, "_").slice(0, 48);
}

function detectFacebookAdsProductHint(attribution?: InboundAttribution) {
    if (!attribution) return null;

    const combined = [
        attribution.adTitle,
        attribution.adBody,
        attribution.adContextText,
        attribution.decodedConversionData,
        attribution.decodedCtwaPayload,
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(" ");

    const normalized = normalizeCatalogComparableText(combined);
    if (!normalized) return null;

    const glowRegex = /\b(glow ?sync|concierto|control remoto|control a distancia|tipo concierto)\b/;
    const audioRegex = /\b(audiorit|audioritm|beatbands?|sin control|ritmo de la musica)\b/;

    const glowMatch = normalized.match(glowRegex);
    const audioMatch = normalized.match(audioRegex);

    if (glowMatch && !audioMatch) {
        return "Pulseras GlowSync tipo concierto";
    }

    if (audioMatch && !glowMatch) {
        return "Pulseras BeatBands Audioritmicas";
    }

    if (audioMatch && glowMatch) {
        const audioIndex = normalized.indexOf(audioMatch[0]);
        const glowIndex = normalized.indexOf(glowMatch[0]);
        return glowIndex >= 0 && glowIndex < audioIndex
            ? "Pulseras GlowSync tipo concierto"
            : "Pulseras BeatBands Audioritmicas";
    }

    if (/\bpulseras? led\b/.test(normalized)) {
        return "Pulseras LED";
    }

    return null;
}

function hasFacebookAdsAttribution(attribution?: InboundAttribution) {
    if (!attribution) return false;

    const values = [
        attribution.conversionSource,
        attribution.entryPointConversionSource,
        attribution.entryPointConversionExternalSource,
        attribution.entryPointConversionExternalMedium,
        attribution.entryPointConversionApp,
        attribution.ctwaSignals,
        attribution.adTitle,
        attribution.adBody,
        attribution.adContextText,
        attribution.decodedConversionData,
        attribution.decodedCtwaPayload,
    ]
        .map((value) => normalizeCatalogComparableText(value))
        .filter(Boolean);

    return values.some((value) =>
        value.includes("facebook") ||
        value.includes("fb ads") ||
        value.includes("fb") ||
        value.includes("ctwa"),
    );
}

function resolveInboundDealSource(attribution?: InboundAttribution) {
    return hasFacebookAdsAttribution(attribution) ? "facebook_ads" : "whatsapp";
}

function buildInboundAttributionTags(attribution?: InboundAttribution) {
    if (!attribution) return [] as string[];

    const tags = new Set<string>();

    if (hasFacebookAdsAttribution(attribution)) {
        tags.add("src_facebook_ads");
    }

    const entryToken = normalizeAttributionToken(attribution.entryPointConversionSource);
    if (entryToken) {
        tags.add(`entry_${entryToken}`);
    }

    const externalSourceToken = normalizeAttributionToken(attribution.entryPointConversionExternalSource);
    if (externalSourceToken) {
        tags.add(`extsrc_${externalSourceToken}`);
    }

    const externalMediumToken = normalizeAttributionToken(attribution.entryPointConversionExternalMedium);
    if (externalMediumToken && externalMediumToken !== "unavailable") {
        tags.add(`extmedium_${externalMediumToken}`);
    }

    const appToken = normalizeAttributionToken(attribution.entryPointConversionApp);
    if (appToken) {
        tags.add(`entryapp_${appToken}`);
    }

    const conversionToken = normalizeAttributionToken(attribution.conversionSource);
    if (conversionToken) {
        tags.add(`convsrc_${conversionToken}`);
    }

    return [...tags];
}

function buildInboundAttributionInstruction(attribution?: InboundAttribution) {
    if (!attribution || !hasFacebookAdsAttribution(attribution)) {
        return null;
    }

    const productHint = detectFacebookAdsProductHint(attribution);

    const lines = [
        "CONTEXTO DE ORIGEN: Este lead llega desde Facebook Ads (Click to WhatsApp).",
        attribution.adTitle ? `Anuncio detectado (titulo): ${attribution.adTitle}` : null,
        attribution.adBody ? `Anuncio detectado (texto): ${attribution.adBody}` : null,
        attribution.adContextText ? `Contexto detectado del anuncio: ${attribution.adContextText}` : null,
        attribution.entryPointConversionSource
            ? `entryPointConversionSource: ${attribution.entryPointConversionSource}`
            : null,
        attribution.conversionSource ? `conversionSource: ${attribution.conversionSource}` : null,
        productHint ? `Producto detectado por anuncio: ${productHint}.` : null,
        productHint
            ? "Usa el producto detectado como pista comercial inicial, pero sigue siempre las instrucciones del prompt del agente."
            : "Si el cliente llega con texto generico, usa el contexto del anuncio como pista inicial y sigue el prompt del agente.",
        "No fuerces una sola opcion de producto si el prompt indica presentar alternativas.",
        "Usa este contexto para responder con continuidad comercial y evita bienvenida generica.",
        "No menciones al cliente que usaste metadatos internos de anuncios.",
    ];

    return lines.filter(Boolean).join(" ");
}

function buildInboundAdPreviewPayloadFromAttribution(attribution?: InboundAttribution) {
    if (!attribution || !hasFacebookAdsAttribution(attribution)) {
        return null;
    }

    const productHint = detectFacebookAdsProductHint(attribution) || undefined;

    return normalizeInboundAdPreviewPayload({
        source: "facebook_ads",
        title: attribution.adTitle,
        body: attribution.adBody,
        context: attribution.adContextText,
        sourceUrl: attribution.adSourceUrl,
        mediaUrl: attribution.adMediaUrl,
        thumbnailUrl: attribution.adThumbnailUrl,
        productHint,
        entryPointConversionSource: attribution.entryPointConversionSource,
        conversionSource: attribution.conversionSource,
    });
}

async function maybeCreateInboundAdPreviewSystemMessage(
    conversationId: string,
    payload: InboundAdPreviewPayload,
) {
    const serializedContent = buildInboundAdPreviewMessageContent(payload);
    if (!serializedContent) return;

    const fingerprint = buildInboundAdPreviewFingerprint(payload);
    if (!fingerprint) return;

    const latestAdPreviewMessage = await prisma.message.findFirst({
        where: {
            conversationId,
            type: "system",
            content: {
                startsWith: INBOUND_AD_PREVIEW_PREFIX,
            },
        },
        orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
        ],
        select: { content: true },
    });

    if (latestAdPreviewMessage?.content) {
        const latestPayload = parseInboundAdPreviewMessageContent(latestAdPreviewMessage.content);
        if (latestPayload) {
            const latestFingerprint = buildInboundAdPreviewFingerprint(latestPayload);
            if (latestFingerprint && latestFingerprint === fingerprint) {
                return;
            }
        }
    }

    await prisma.message.create({
        data: {
            conversationId,
            content: serializedContent,
            direction: "outbound",
            status: "sent",
            type: "system",
            senderType: "system",
        },
    });
}

function stripInternalDisclosureLines(content: string) {
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    const keptLines = lines.filter((line) => {
        const normalized = normalizeCatalogComparableText(line);
        if (!normalized) return true;

        return ![
            /\balerta interna\b/,
            /\balertas internas\b/,
            /\bnotificacion interna\b/,
            /\bnotificaciones internas\b/,
            /\baviso interno\b/,
            /\bcorreo interno\b/,
            /\binternal alert\b/,
            /\binternal notification\b/,
            /\bposible pedido\b/,
        ].some((pattern) => pattern.test(normalized));
    });

    return keptLines
        .join("\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function escapeRegexPattern(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKnowledgeImageUrl(value: string | null | undefined) {
    return (value || "")
        .trim()
        .replace(/[),.;|]+$/g, "");
}

function isLikelyKnowledgeImageUrl(url: string) {
    if (!url) return false;

    if (/\.(?:png|jpe?g|webp|gif|bmp|svg|heic|heif|avif)(?:[?#].*)?$/i.test(url)) {
        return true;
    }

    return /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?)/i.test(url);
}

function extractKnowledgeImageUrlsFromReply(reply: string) {
    const urls = new Set<string>();

    for (const match of reply.matchAll(KNOWLEDGE_MARKDOWN_LINK_WITH_URL_REGEX)) {
        const label = (match[1] || "").toLowerCase();
        const url = normalizeKnowledgeImageUrl(match[2]);
        if (!url) continue;

        if (/\b(imagen|imagenes|foto|fotos|galeria|galería|ver)\b/.test(label) || isLikelyKnowledgeImageUrl(url)) {
            urls.add(url);
        }
    }

    for (const match of reply.matchAll(KNOWLEDGE_IMAGE_URL_REGEX)) {
        const url = normalizeKnowledgeImageUrl(match[0]);
        if (!url || !isLikelyKnowledgeImageUrl(url)) continue;
        urls.add(url);
    }

    return [...urls];
}

function stripKnowledgeImageUrlsFromReply(reply: string, imageUrls: string[]) {
    if (!reply.trim() || imageUrls.length === 0) {
        return reply.trim();
    }

    let cleaned = reply;

    for (const rawUrl of imageUrls) {
        const url = normalizeKnowledgeImageUrl(rawUrl);
        if (!url) continue;
        const escapedUrl = escapeRegexPattern(url);

        cleaned = cleaned.replace(
            new RegExp(`!?\\[[^\\]\\n]{1,180}\\]\\(\\s*${escapedUrl}\\s*\\)`, "gi"),
            "",
        );
        cleaned = cleaned.replace(new RegExp(escapedUrl, "gi"), "");
    }

    cleaned = cleaned
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/(^|\n)[\s>*-]*\n/g, "$1")
        .trim();

    return cleaned;
}

async function sendPreferredImageUrlsFromReply(params: {
    conversationId: string;
    phone: string;
    imageUrls: string[];
}) {
    const normalizedUrls = [...new Set(
        params.imageUrls
            .map((url) => normalizeKnowledgeImageUrl(url))
            .filter(Boolean),
    )];

    if (normalizedUrls.length === 0) {
        return false;
    }

    let sentSomething = false;

    for (const imageUrl of normalizedUrls) {
        const alreadySent = await hasBotImageAlreadySentInConversation(params.conversationId, imageUrl);
        if (alreadySent) {
            continue;
        }

        const sent = await sendAutomatedBotMedia({
            conversationId: params.conversationId,
            phone: params.phone,
            mediaCategory: "image",
            mediaUrl: imageUrl,
            mediaLabel: "imagen_producto",
            development: "producto",
        });

        if (sent) {
            sentSomething = true;
            break;
        }
    }

    return sentSomething;
}

async function hasBotImageAlreadySentInConversation(conversationId: string, imageUrl: string) {
    const normalizedUrl = normalizeKnowledgeImageUrl(imageUrl);
    if (!normalizedUrl) {
        return false;
    }

    const sourceHash = buildSourceMediaHash(normalizedUrl);
    const alreadySent = await prisma.message.findFirst({
        where: {
            conversationId,
            direction: "outbound",
            senderType: "bot",
            type: "image",
            OR: [
                { mediaUrl: normalizedUrl },
                { mediaUrl: { contains: sourceHash } },
            ],
            status: {
                not: "failed",
            },
        },
        select: { id: true },
    });

    return Boolean(alreadySent);
}

function sanitizeComparablePhone(value: string | null | undefined) {
    return (value || "").replace(/\D/g, "");
}

function queueAvatarRefreshForConversation(conversationId: string) {
    void prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { contactId: true },
    }).then((conversation) => {
        if (!conversation?.contactId) return;
        return refreshWhatsAppAvatarForContact(conversation.contactId);
    }).catch((error) => {
        console.warn("[Avatar] Failed to queue conversation avatar refresh", error);
    });
}

function buildCatalogLookupQuery(
    history: Array<{ content: string; direction: string }>,
    latestUserMessage: string,
) {
    const pieces: string[] = [];

    for (const candidate of [
        latestUserMessage,
        ...history
            .filter((message) => message.direction === "inbound" && message.content?.trim())
            .slice(0, 4)
            .map((message) => message.content.trim()),
    ]) {
        const normalized = candidate.trim();
        if (!normalized) continue;
        if (pieces[pieces.length - 1] === normalized) continue;
        pieces.push(normalized);
    }

    return pieces.join("\n");
}

function latestMessageMentionsDevelopment(
    latestUserMessage: string,
    development: string,
) {
    const normalizedMessage = normalizeCatalogComparableText(latestUserMessage);
    const normalizedDevelopment = normalizeCatalogComparableText(development);

    return Boolean(normalizedMessage && normalizedDevelopment && normalizedMessage.includes(normalizedDevelopment));
}

function isCatalogDetailFollowUp(latestUserMessage: string) {
    const normalized = normalizeCatalogComparableText(latestUserMessage);
    if (!normalized) return false;

    if (
        /\b(recamara|recamaras|habitacion|habitaciones|bano|banos|amenidad|amenidades|modelo|tipologia|tipologias|metros|m2|superficie|medidas|precio|financiamiento|detalle|detalles|informacion|ubicacion|caracteristicas)\b/.test(
            normalized,
        )
    ) {
        return true;
    }

    if (/\bde\s+\d+\s*(recamara|recamaras|habitacion|habitaciones|m2|metros)\b/.test(normalized)) {
        return true;
    }

    if (
        /\b(dame mas|dame info|quiero saber mas|quiero mas informacion|mas informacion|mas detalles)\b/.test(
            normalized,
        )
    ) {
        return true;
    }

    return false;
}

function hasRecentCatalogOffer(offeredAt: Date | null | undefined) {
    if (!offeredAt) return false;
    return Date.now() - offeredAt.getTime() <= CATALOG_OFFER_EXPIRY_MS;
}

function isCatalogAssistantEnabled(
    settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>,
) {
    return Boolean(
        settings.catalogOfferImages ||
            settings.catalogOfferPdf ||
            settings.catalogIncludeLink,
    );
}

function cleanKnowledgeImageDescription(value: string) {
    return normalizeCatalogComparableText(
        value
            .replace(/\b(producto|nombre|descripcion|desc|imagen|image|url)\b\s*:/gi, " ")
            .replace(/[|;,]+/g, " ")
            .trim(),
    );
}

function extractKnowledgeImageEntries(rawContent: string | null | undefined): KnowledgeImageEntry[] {
    if (!rawContent?.trim()) {
        return [];
    }

    const entries: KnowledgeImageEntry[] = [];
    let previousTextLine: string | null = null;

    for (const rawLine of rawContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const urls = [...line.matchAll(KNOWLEDGE_IMAGE_URL_REGEX)]
            .map((match) => match[0]?.replace(/[),.;|]+$/, ""))
            .filter(Boolean) as string[];

        if (urls.length === 0) {
            const normalizedLine = cleanKnowledgeImageDescription(line);
            previousTextLine = normalizedLine || previousTextLine;
            continue;
        }

        let description = line;
        for (const url of urls) {
            description = description.replace(url, " ");
        }

        const rawLabelCandidate = description.split("|")[0] || description;
        const normalizedDescription = cleanKnowledgeImageDescription(description) || previousTextLine;
        previousTextLine = null;

        if (!normalizedDescription) {
            continue;
        }

        const normalizedLabel =
            normalizeCatalogComparableText(rawLabelCandidate) ||
            normalizeCatalogComparableText(normalizedDescription.split(" ").slice(0, 4).join(" "));

        if (!normalizedLabel) {
            continue;
        }

        entries.push({
            label: normalizedDescription,
            imageUrl: urls[0],
            searchableText: normalizedDescription,
            normalizedLabel,
        });
    }

    return entries;
}

function buildKnowledgeImageMatchTokens(text: string) {
    return [...new Set(normalizeCatalogComparableText(text)
        .split(" ")
        .filter((token) =>
            token.length >= 3 &&
            !KNOWLEDGE_IMAGE_TOKEN_STOPWORDS.has(token),
        ))];
}

function compactComparableText(value: string | null | undefined) {
    return normalizeCatalogComparableText(value).replace(/\s+/g, "");
}

function scoreKnowledgeImageEntry(
    entry: KnowledgeImageEntry,
    normalizedNeedle: string,
    tokens: string[],
) {
    let score = 0;

    if (entry.normalizedLabel.length >= 6 && normalizedNeedle.includes(entry.normalizedLabel)) {
        score += 8;
    }

    for (const token of tokens) {
        if (entry.searchableText.includes(token)) {
            score += token.length >= 6 ? 2 : 1;
        }
    }

    const compactSearchable = compactComparableText(entry.searchableText);
    const joinedTokens = tokens.join("");
    if (
        tokens.length >= 2 &&
        joinedTokens.length >= 6 &&
        compactSearchable.includes(joinedTokens)
    ) {
        score += 3;
    }

    return score;
}

function buildCatalogInstruction(
    catalogItem: CatalogItemMatch,
    developmentContext: Awaited<ReturnType<typeof getCatalogDevelopmentContext>> | null,
) {
    const verifiedEntries = developmentContext?.entries?.length
        ? developmentContext.entries
        : [
            {
                question: catalogItem.question,
                answer: catalogItem.answer,
            },
        ];

    return [
        verifiedEntries.length > 1
            ? "Se encontraron varias fichas estructuradas verificadas del mismo desarrollo."
            : "Se encontro una ficha estructurada del catalogo.",
        `Desarrollo: ${developmentContext?.development || catalogItem.development}.`,
        (developmentContext?.location || catalogItem.location)
            ? `Ubicacion base: ${developmentContext?.location || catalogItem.location}.`
            : null,
        "Construye una respuesta integrada, comercial y clara usando solo la informacion verificada de estas fichas:",
        ...verifiedEntries.map((entry, index) =>
            `Ficha ${index + 1}: ${entry.question} -> ${entry.answer}`,
        ),
        "Usa esta ficha como fuente prioritaria si la consulta del cliente corresponde a este desarrollo.",
        "Si el cliente esta dando seguimiento a este desarrollo o a una tipologia/modelo de este desarrollo, mantente en este mismo desarrollo y no vuelvas a sugerir otros desarrollos o zonas.",
        "Si el cliente menciona una variante concreta, como numero de recamaras, metros, tipologia o modelo, enfocate primero en esa variante especifica.",
        "No inventes caracteristicas, precios, amenidades ni ubicaciones que no esten en estas fichas.",
        "No menciones ni ofrezcas imagenes, PDF o ligas dentro del cuerpo principal de la respuesta; el sistema los ofrece aparte cuando corresponde.",
        "Esta prohibido volver a ofrecer imagenes, catalogos, brochures o ligas dentro del cuerpo principal de la respuesta.",
        "No repitas textual las preguntas del catalogo. Sintetiza la informacion en una sola respuesta bien organizada.",
        "Da una respuesta resumida y facil de leer. A la mayoria de los clientes no les gusta leer demasiado.",
        "Si el usuario solo pide informacion general del desarrollo, responde en formato breve: una introduccion corta, maximo 3 o 4 puntos clave y una pregunta final para continuar la conversacion.",
        "No enumeres todas las amenidades ni todas las caracteristicas si no te las pidieron. Prioriza solo lo mas vendedor y util.",
        "Si hay cantidades importantes, mencionalas de forma resumida, por ejemplo modelos, rango de recamaras o amenidades destacadas, sin copiar bloques demasiado largos.",
        "Evita parrafos largos. Prefiere frases cortas y bullets cortos.",
        "No abras siempre con frases repetitivas como 'Si, claro que si', 'Claro que si' o 'Con gusto'. Entra directo al punto con un tono vendedor y natural.",
        "Cuando respondas con esta ficha, usa formato de WhatsApp bien estructurado: parrafos cortos, listas simples cuando haya caracteristicas y *negritas* solo en la informacion importante.",
        "Resalta en *negritas* lo mas relevante, por ejemplo: nombre del desarrollo, ubicacion, recamaras, banos, amenidades, precio o beneficio principal si aparece en la ficha.",
        "No cierres la conversacion. Termina con una pregunta abierta breve que ayude a seguir vendiendo.",
    ]
        .filter(Boolean)
        .join(" ");
}

function buildCatalogOfferText(params: {
    offerImages: boolean;
    imageCount: number;
    offerPdf: boolean;
}) {
    const lines: string[] = [];

    if (params.offerImages) {
        const imageLabel =
            params.imageCount === 1
                ? "una imagen"
                : params.imageCount <= 3
                    ? `${params.imageCount} imagenes`
                    : `hasta ${params.imageCount} imagenes`;
        lines.push(`Si quieres, tambien puedo enviarte ${imageLabel} del desarrollo.`);
    }

    if (params.offerPdf) {
        lines.push("Y si te sirve, tambien te comparto el catalogo en PDF.");
    }

    return lines.join("\n");
}

function shouldAppendCatalogOffer(
    reply: string,
    params: {
        offerImages: boolean;
        offerPdf: boolean;
    },
) {
    const normalized = normalizeCatalogComparableText(reply);
    if (!normalized) return true;

    if (params.offerImages && /\b(imagen(?:es)?|foto(?:s)?|galeria)\b/.test(normalized)) {
        return false;
    }

    if (params.offerPdf && (/\b(pdf|catalogo|brochure|ficha)\b/.test(normalized))) {
        return false;
    }

    return true;
}

function buildCatalogAssetIntro(params: {
    development: string;
    sendImages: boolean;
    sendPdf: boolean;
}) {
    if (params.sendImages && params.sendPdf) {
        return `Claro, te comparto las imagenes y tambien el catalogo en PDF de ${params.development}.`;
    }

    if (params.sendImages) {
        return `Claro, te comparto las imagenes de ${params.development}.`;
    }

    if (params.sendPdf) {
        return `Claro, te comparto el catalogo en PDF de ${params.development}.`;
    }

    return `Claro, te comparto la informacion de ${params.development}.`;
}

function buildCatalogLinkMessage(
    development: string,
    linkAsset: { url: string },
) {
    return `Tambien te dejo la liga de ${development}:\n${linkAsset.url}`;
}

function buildCatalogAvailabilityReply(summary: Awaited<ReturnType<typeof findCatalogAvailabilitySummary>>) {
    if (!summary) return null;

    if (summary.noDirectMatches && summary.requestedLocation) {
        return [
            `Por ahora no tengo propiedades cargadas exactamente en *${summary.requestedLocation}*.`,
            "Si quieres, puedo buscarte opciones cercanas o en otra zona de Merida.",
            "¿Prefieres que te muestre opciones del norte, poniente, oriente o sur?",
        ].join("\n\n");
    }

    const lines = summary.developments.map((item) =>
        item.location
            ? `- *${item.development}* (${item.location})`
            : `- *${item.development}*`,
    );

    if (summary.developments.length === 1) {
        const onlyDevelopment = summary.developments[0];
        const locationFragment = onlyDevelopment.location
            ? ` en *${onlyDevelopment.location}*`
            : "";

        return [
            `Tengo informacion disponible de *${onlyDevelopment.development}*${locationFragment}.`,
            "Si quieres, te platico mas sobre este desarrollo y te comparto lo mas importante.",
            "¿Que te gustaria conocer primero: ubicacion, caracteristicas, amenidades o imagenes?",
        ].join("\n\n");
    }

    const intro = summary.locationHint
        ? `Tenemos varias opciones disponibles en *${summary.locationHint}*.`
        : "Tenemos varias opciones disponibles en esta zona.";

    return [
        intro,
        "Algunos de ellos son:",
        lines.join("\n"),
        "Si quieres, te ayudo a encontrar la opcion que mejor se ajuste a lo que buscas.",
        "¿Te interesa conocer alguno en particular o prefieres que te recomiende una opcion segun ubicacion, recamaras o tipo de propiedad?",
    ].join("\n\n");
}

function shouldEscalateUnknownReply(reply: string) {
    const normalized = normalizeCatalogComparableText(reply);
    if (!normalized) return false;

    return [
        /\bno (tengo|cuento con|dispongo de|encuentro|logro encontrar)(?: [a-z0-9 ]{0,40})?(informacion|dato|respuesta|contexto)\b/,
        /\bno tengo informacion especifica\b/,
        /\bno tengo una respuesta fiable\b/,
        /\bno puedo confirmarlo\b/,
        /\bno tengo suficiente informacion\b/,
        /\bte voy a canalizar con un asesor\b/,
        /\btransferirte con un asesor\b/,
    ].some((pattern) => pattern.test(normalized));
}

function buildEscalationCustomerReply() {
    return "Para darte una respuesta precisa, te voy a canalizar con un asesor humano y en un momento te atenderemos por aqui.";
}

function claimsUnverifiedAppointmentAvailability(reply: string) {
    const normalized = normalizeCatalogComparableText(reply);
    const claimsAvailability = /\b(disponibilidad|disponibles?|horarios? libres?|espacios? libres?)\b/.test(normalized);
    const containsSpecificTime = /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b/i.test(reply);
    return claimsAvailability && containsSpecificTime;
}

function buildVerifiedAvailabilityFallbackReply() {
    return [
        "*Necesito consultar la agenda real antes de ofrecerte una hora.*",
        "",
        "Dime el servicio que deseas y el día; revisaré su duración, la profesional compatible y todos los espacios libres.",
    ].join("\n");
}

function buildEscalationAlertMessage(params: {
    brandName?: string | null;
    contact: {
        name?: string | null;
        phone?: string | null;
        company?: string | null;
    };
    latestUserMessage: string;
    conversationId: string;
}) {
    const brandName = params.brandName?.trim() || "el CRM";
    const contactName = normalizeContactName(params.contact.name) || "Sin nombre";
    const company = params.contact.company?.trim();

    return [
        `🔔 *Escalacion automatica desde ${brandName}*`,
        `Cliente: *${contactName}*`,
        `Telefono: *${params.contact.phone || "Sin telefono"}*`,
        company ? `Empresa: *${company}*` : null,
        `Motivo: La IA no encontro una respuesta confiable para continuar sola.`,
        `Ultimo mensaje del cliente:`,
        params.latestUserMessage.trim() ? params.latestUserMessage.trim() : "(sin texto)",
        `Conversacion: ${params.conversationId}`,
    ]
        .filter(Boolean)
        .join("\n");
}

async function triggerHumanEscalation(params: {
    conversationId: string;
    escalationPhone: string;
    contactPhone: string;
    brandName?: string | null;
    contact: {
        name?: string | null;
        phone?: string | null;
        company?: string | null;
    };
    latestUserMessage: string;
}) {
    const escalationPhone = sanitizeComparablePhone(params.escalationPhone);
    const contactPhone = sanitizeComparablePhone(params.contactPhone);

    await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { botActive: false, updatedAt: new Date() },
    });

    if (!escalationPhone || escalationPhone === contactPhone) {
        return;
    }

    try {
        await sendWuzapiTextMessage(
            escalationPhone,
            buildEscalationAlertMessage({
                brandName: params.brandName,
                contact: params.contact,
                latestUserMessage: params.latestUserMessage,
                conversationId: params.conversationId,
            }),
        );
    } catch (error) {
        console.error("[Escalation] Failed to notify escalation phone:", error);
    }
}

async function touchAutomatedConversation(conversationId: string) {
    await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
    });

    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard/pipeline");
}

async function getAutomatedConversationSource(conversationId: string): Promise<{
    sourceType: MessageSourceType;
    sourceId: string | null;
}> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
            sourceType: true,
            sourceId: true,
        },
    });

    return {
        sourceType: normalizeMessageSourceType(conversation?.sourceType),
        sourceId: conversation?.sourceId || null,
    };
}

function buildPublicMediaUrl(mediaUrl: string) {
    if (/^https?:\/\//i.test(mediaUrl)) {
        return mediaUrl;
    }

    const appBaseUrl = (process.env.APP_BASE_URL || process.env.AUTH_URL || "").trim();
    if (!appBaseUrl) {
        throw new Error("APP_BASE_URL o AUTH_URL es requerido para enviar multimedia por WhatsApp API.");
    }

    return `${appBaseUrl.replace(/\/+$/, "")}${mediaUrl.startsWith("/") ? "" : "/"}${mediaUrl}`;
}

async function getAutomatedWelcomeMessage(params: {
    welcomeMessage?: string | null;
}) {
    return params.welcomeMessage?.trim() || null;
}

function normalizeWelcomeIntentText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s?!]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function shouldSendWelcomeForLatestMessage(
    latestUserMessage: string,
    options?: { forceSkipWelcome?: boolean },
) {
    if (options?.forceSkipWelcome) return false;

    const normalized = normalizeWelcomeIntentText(latestUserMessage || "");
    if (!normalized) return true;

    // If user already asks for something concrete, skip generic welcome.
    if (normalized.includes("?") || normalized.includes("¿")) {
        return false;
    }

    if (
        /\b(precio|cost|costo|cuanto|envio|entrega|cotizacion|informacion|info|disponible|quiero|necesito|busco|pedido|comprar|tienes|tienen|monterrey|reynosa|guadalajara|cdmx)\b/.test(
            normalized,
        )
    ) {
        return false;
    }

    return /^(hola+|hello+|hey+|saludos?|buen(?:os)?\s*dias|buenas?\s*tardes|buenas?\s*noches|que\s*tal|que\s*onda|buenas?)$/.test(
        normalized,
    );
}

function shouldSendAutomatedWelcome(
    currentInboundAt: Date,
    previousInboundAt: Date | null | undefined,
    repeatHours: number,
) {
    if (!previousInboundAt) {
        return true;
    }

    const repeatMs = Math.max(1, repeatHours || 24) * 60 * 60 * 1000;
    return currentInboundAt.getTime() - previousInboundAt.getTime() >= repeatMs;
}

async function persistCatalogState(params: {
    conversationId: string;
    catalogItemId: string | null;
    pendingImages: boolean;
    pendingPdf: boolean;
    pendingLink: boolean;
    offeredAt: Date | null;
    lastSentAt: Date | null;
}) {
    await prisma.catalogConversationState.upsert({
        where: { conversationId: params.conversationId },
        create: {
            conversationId: params.conversationId,
            catalogItemId: params.catalogItemId,
            pendingImages: params.pendingImages,
            pendingPdf: params.pendingPdf,
            pendingLink: params.pendingLink,
            offeredAt: params.offeredAt,
            lastSentAt: params.lastSentAt,
        },
        update: {
            catalogItemId: params.catalogItemId,
            pendingImages: params.pendingImages,
            pendingPdf: params.pendingPdf,
            pendingLink: params.pendingLink,
            offeredAt: params.offeredAt,
            lastSentAt: params.lastSentAt,
        },
    });
}

async function sendAutomatedBotText(params: {
    conversationId: string;
    phone: string;
    content: string;
}) {
    const content = stripInternalDisclosureLines(params.content).trim();
    if (!content) return;

    const source = await getAutomatedConversationSource(params.conversationId);

    try {
        const transportResult = source.sourceType === "meta"
            ? await sendMetaTextMessage(params.phone, content)
            : await sendWuzapiTextMessage(params.phone, content);

        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content,
                direction: "outbound",
                status: "sent",
                type: "text",
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                senderType: "bot",
                providerMessageId: transportResult?.Id || null,
            },
        });
        queueAvatarRefreshForConversation(params.conversationId);
    } catch (error) {
        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content,
                direction: "outbound",
                status: "failed",
                type: "text",
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                senderType: "bot",
            },
        });
        throw error;
    }
}

async function sendAutomatedBotMedia(params: {
    conversationId: string;
    phone: string;
    mediaCategory: "image" | "document";
    mediaUrl: string;
    mediaLabel?: string | null;
    development: string;
}) {
    const placeholderContent = params.mediaCategory === "image" ? "[image]" : "[document]";
    let storedMediaUrl = params.mediaUrl;
    const source = await getAutomatedConversationSource(params.conversationId);

    try {
        const resolvedMedia = await resolveMediaToDataUrl(params.mediaUrl);
        try {
            const persisted = await persistAutomatedMediaToUploads({
                sourceUrl: params.mediaUrl,
                dataUrl: resolvedMedia.dataUrl,
                fileName: resolvedMedia.fileName,
                mimeType: resolvedMedia.mimeType,
            });
            storedMediaUrl = persisted.mediaUrl;
        } catch (persistError) {
            console.warn("[Catalog] Failed to persist automated media locally:", persistError);
        }

        const result = source.sourceType === "meta"
            ? await sendMetaMediaMessage({
                to: params.phone,
                mediaType: params.mediaCategory,
                link: buildPublicMediaUrl(storedMediaUrl),
                caption: params.mediaCategory === "document" ? `Catalogo PDF de ${params.development}` : undefined,
                fileName: resolvedMedia.fileName,
            })
            : await sendWuzapiMediaMessage({
                phone: params.phone,
                mediaCategory: params.mediaCategory,
                dataUrl: resolvedMedia.dataUrl,
                fileName: resolvedMedia.fileName,
                mimeType: resolvedMedia.mimeType,
                caption: params.mediaCategory === "document" ? `Catalogo PDF de ${params.development}` : undefined,
            });

        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content: placeholderContent,
                direction: "outbound",
                status: "sent",
                type: params.mediaCategory,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                senderType: "bot",
                mediaUrl: storedMediaUrl,
                mediaType: resolvedMedia.mimeType,
                mediaFileName: resolvedMedia.fileName,
                providerMessageId: result?.Id || null,
            },
        });
        queueAvatarRefreshForConversation(params.conversationId);

        return true;
    } catch (error) {
        console.error("[Catalog] Failed to send automated media asset:", error);
        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content: placeholderContent,
                direction: "outbound",
                status: "failed",
                type: params.mediaCategory,
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                senderType: "bot",
                mediaUrl: storedMediaUrl,
                mediaFileName: params.mediaLabel || null,
            },
        });
        return false;
    }
}

async function sendCatalogAssets(params: {
    conversationId: string;
    phone: string;
    development: string;
    imageAssets: Array<{ url: string; label: string | null }>;
    pdfAsset: { url: string; label: string | null } | null;
    linkAsset: { url: string } | null;
    sendImages: boolean;
    sendPdf: boolean;
    sendLink: boolean;
}) {
    let sentSomething = false;

    if (params.sendImages) {
        for (const asset of params.imageAssets) {
            const sent = await sendAutomatedBotMedia({
                conversationId: params.conversationId,
                phone: params.phone,
                mediaCategory: "image",
                mediaUrl: asset.url,
                mediaLabel: asset.label,
                development: params.development,
            });
            sentSomething = sentSomething || sent;
        }
    }

    if (params.sendPdf && params.pdfAsset) {
        const sent = await sendAutomatedBotMedia({
            conversationId: params.conversationId,
            phone: params.phone,
            mediaCategory: "document",
            mediaUrl: params.pdfAsset.url,
            mediaLabel: params.pdfAsset.label,
            development: params.development,
        });
        sentSomething = sentSomething || sent;
    }

    if (params.sendLink && params.linkAsset) {
        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: buildCatalogLinkMessage(params.development, params.linkAsset),
        });
        sentSomething = true;
    }

    return sentSomething;
}

async function maybeSendKnowledgeImageFromTextSources(params: {
    conversationId: string;
    phone: string;
    latestUserMessage: string;
    assistantReplyText?: string;
    preferredImageUrls?: string[];
}) {
    try {
        const sources = await prisma.knowledgeSource.findMany({
            where: {
                type: "text",
                rawContent: {
                    not: null,
                },
            },
            select: {
                rawContent: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
            take: 24,
        });

        if (sources.length === 0) {
            return false;
        }

        const entriesByUrl = new Map<string, KnowledgeImageEntry>();
        const entriesByNormalizedUrl = new Map<string, KnowledgeImageEntry>();

        for (const source of sources) {
            for (const entry of extractKnowledgeImageEntries(source.rawContent)) {
                if (!entriesByUrl.has(entry.imageUrl)) {
                    entriesByUrl.set(entry.imageUrl, entry);
                }

                const normalizedEntryUrl = normalizeKnowledgeImageUrl(entry.imageUrl);
                if (normalizedEntryUrl && !entriesByNormalizedUrl.has(normalizedEntryUrl)) {
                    entriesByNormalizedUrl.set(normalizedEntryUrl, entry);
                }
            }
        }

        const entries = [...entriesByUrl.values()];
        if (entries.length === 0) {
            return false;
        }

        const preferredEntries = [...new Set(
            (params.preferredImageUrls || [])
                .map((rawUrl) => normalizeKnowledgeImageUrl(rawUrl))
                .filter(Boolean),
        )]
            .map((normalizedUrl) => entriesByNormalizedUrl.get(normalizedUrl))
            .filter((entry): entry is KnowledgeImageEntry => Boolean(entry));

        for (const entry of preferredEntries) {
            const alreadySent = await hasBotImageAlreadySentInConversation(params.conversationId, entry.imageUrl);
            if (alreadySent) {
                continue;
            }

            const sent = await sendAutomatedBotMedia({
                conversationId: params.conversationId,
                phone: params.phone,
                mediaCategory: "image",
                mediaUrl: entry.imageUrl,
                mediaLabel: entry.label,
                development: entry.label,
            });

            if (sent) {
                return true;
            }
        }

        const matchContext = [params.latestUserMessage, params.assistantReplyText]
            .filter((value): value is string => Boolean(value && value.trim()))
            .join(" ");
        const normalizedNeedle = normalizeCatalogComparableText(matchContext);
        const tokens = buildKnowledgeImageMatchTokens(matchContext);

        if (!normalizedNeedle || tokens.length === 0) {
            return false;
        }

        let bestEntry: KnowledgeImageEntry | null = null;
        let bestScore = 0;

        for (const entry of entries) {
            const score = scoreKnowledgeImageEntry(entry, normalizedNeedle, tokens);
            if (score > bestScore) {
                bestScore = score;
                bestEntry = entry;
            }
        }

        if (!bestEntry || bestScore < KNOWLEDGE_IMAGE_MIN_SCORE) {
            return false;
        }

        const alreadySent = await hasBotImageAlreadySentInConversation(params.conversationId, bestEntry.imageUrl);
        if (alreadySent) {
            return false;
        }

        return sendAutomatedBotMedia({
            conversationId: params.conversationId,
            phone: params.phone,
            mediaCategory: "image",
            mediaUrl: bestEntry.imageUrl,
            mediaLabel: bestEntry.label,
            development: bestEntry.label,
        });
    } catch (error) {
        console.error("[KnowledgeImage] Failed to evaluate/send image from knowledge text sources:", error);
        return false;
    }
}

async function maybeHandleCatalogAssetReply(params: {
    conversationId: string;
    inboundMessageId: string;
    phone: string;
    latestUserMessage: string;
    settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>;
    catalogState:
        | {
              catalogItemId: string | null;
              pendingImages: boolean;
              pendingPdf: boolean;
              pendingLink: boolean;
              offeredAt: Date | null;
              lastSentAt: Date | null;
              catalogItem: CatalogItemMatch | null;
          }
        | null
        | undefined;
}) {
    if (!isCatalogAssistantEnabled(params.settings)) {
        return false;
    }

    const state = params.catalogState;
    if (!state?.catalogItem) {
        return false;
    }

    const intent = parseCatalogAssetIntent(params.latestUserMessage);
    const isOfferActive =
        hasRecentCatalogOffer(state.offeredAt) &&
        ((state.pendingImages && state.catalogItem.assets.some((asset) => asset.type === "image")) ||
            (state.pendingPdf && state.catalogItem.assets.some((asset) => asset.type === "pdf")));
    const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
        state.catalogItem.assets,
        params.settings.catalogMaxImagesToSend,
    );
    const waitBeforeCatalogSend = () =>
        waitForBotReplyPacing({
            settings: params.settings,
            conversationId: params.conversationId,
            inboundMessageId: params.inboundMessageId,
            cancelIfNewerInbound: false,
        });

    if (intent.negative && isOfferActive) {
        if (!(await waitBeforeCatalogSend())) return true;

        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: "Sin problema, seguimos por aqui.",
        });

        await persistCatalogState({
            conversationId: params.conversationId,
            catalogItemId: state.catalogItem.id,
            pendingImages: false,
            pendingPdf: false,
            pendingLink: false,
            offeredAt: null,
            lastSentAt: state.lastSentAt,
        });
        await touchAutomatedConversation(params.conversationId);
        return true;
    }

    const specificRequest = intent.wantsImages || intent.wantsPdf;
    const genericAcceptance = intent.affirmative && !specificRequest && isOfferActive;

    if (!specificRequest && !genericAcceptance) {
        return false;
    }

    const sendImages = intent.wantsImages ? imageAssets.length > 0 : Boolean(genericAcceptance && state.pendingImages);
    const sendPdf = intent.wantsPdf ? Boolean(pdfAsset) : Boolean(genericAcceptance && state.pendingPdf);

    if (!sendImages && !sendPdf) {
        const unavailableReply = intent.wantsImages
            ? "En esta ficha no tengo imagenes cargadas por ahora."
                : intent.wantsPdf
                ? "En esta ficha no tengo un catalogo en PDF cargado por ahora."
                : "Por ahora no tengo archivos adicionales de esta ficha.";

        if (!(await waitBeforeCatalogSend())) return true;

        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: unavailableReply,
        });
        await touchAutomatedConversation(params.conversationId);
        return true;
    }

    if (!(await waitBeforeCatalogSend())) return true;

    await sendAutomatedBotText({
        conversationId: params.conversationId,
        phone: params.phone,
        content: buildCatalogAssetIntro({
            development: state.catalogItem.development,
            sendImages,
            sendPdf,
        }),
    });

    await sendCatalogAssets({
        conversationId: params.conversationId,
        phone: params.phone,
        development: state.catalogItem.development,
        imageAssets,
        pdfAsset,
        linkAsset,
        sendImages,
        sendPdf,
        sendLink: params.settings.catalogIncludeLink && Boolean(linkAsset) && (sendImages || sendPdf || state.pendingLink),
    });

    await persistCatalogState({
        conversationId: params.conversationId,
        catalogItemId: state.catalogItem.id,
        pendingImages: Boolean(state.pendingImages && !sendImages),
        pendingPdf: Boolean(state.pendingPdf && !sendPdf),
        pendingLink: false,
        offeredAt:
            state.pendingImages && !sendImages
                ? state.offeredAt
                : state.pendingPdf && !sendPdf
                    ? state.offeredAt
                    : null,
        lastSentAt: new Date(),
    });
    await touchAutomatedConversation(params.conversationId);
    return true;
}

async function maybeSendAutomatedReply(
    conversationId: string,
    inboundMessageId: string,
    latestUserMessage: string,
    inboundAttribution?: InboundAttribution,
) {
    try {
        const settings = await getSystemSettingsOrDefaults();
        const catalogAssistantEnabled = isCatalogAssistantEnabled(settings);
        if (!settings.isBotEnabled) return;
        if (shouldSkipAutoReplyText(latestUserMessage)) return;

        const initialConversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!initialConversation?.botActive || !initialConversation.contact?.phone) {
            return;
        }

        if (settings.autoReplyDelayMs > 0) {
            await sleep(settings.autoReplyDelayMs);
        }

        const [latestConversation, latestMessage, previousInboundMessage] = await Promise.all([
            prisma.conversation.findUnique({
                where: { id: conversationId },
                include: {
                    contact: true,
                    catalogState: {
                        include: {
                            catalogItem: {
                                include: {
                                    assets: {
                                        orderBy: [
                                            { type: "asc" },
                                            { sortOrder: "asc" },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                    messages: {
                        where: {
                            type: { not: "system" },
                        },
                        orderBy: [
                            { createdAt: "desc" },
                            { id: "desc" },
                        ],
                        take: 8,
                        select: {
                            content: true,
                            direction: true,
                            senderType: true,
                        },
                    },
                },
            }),
            prisma.message.findFirst({
                where: { conversationId },
                orderBy: [
                    { createdAt: "desc" },
                    { id: "desc" },
                ],
            }),
            prisma.message.findFirst({
                where: {
                    conversationId,
                    direction: "inbound",
                    id: { not: inboundMessageId },
                },
                orderBy: [
                    { createdAt: "desc" },
                    { id: "desc" },
                ],
                select: { createdAt: true },
            }),
        ]);

        if (!latestConversation?.botActive || !latestConversation.contact?.phone) return;
        if (!latestMessage || latestMessage.id !== inboundMessageId || latestMessage.direction !== "inbound") {
            return;
        }

        const modelUserMessage = latestUserMessage;

        if (
            shouldSendAutomatedWelcome(
                latestMessage.createdAt,
                previousInboundMessage?.createdAt,
                settings.welcomeRepeatHours || 24,
            ) &&
            shouldSendWelcomeForLatestMessage(latestUserMessage, {
                forceSkipWelcome: hasFacebookAdsAttribution(inboundAttribution),
            })
        ) {
            const welcomeMessage = await getAutomatedWelcomeMessage({
                welcomeMessage: settings.welcomeMessage,
            });

            if (welcomeMessage) {
                const canSendAfterPacing = await waitForBotReplyPacing({
                    settings,
                    conversationId,
                    inboundMessageId,
                    cancelIfNewerInbound: false,
                });
                if (!canSendAfterPacing) return;

                await sendAutomatedBotText({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    content: welcomeMessage,
                });
                await touchAutomatedConversation(conversationId);
                return;
            }
        }

        const handledCatalogReply = catalogAssistantEnabled
            ? await maybeHandleCatalogAssetReply({
                conversationId,
                inboundMessageId,
                phone: latestConversation.contact.phone,
                latestUserMessage,
                settings,
                catalogState: latestConversation.catalogState,
            })
            : false;

        if (handledCatalogReply) {
            return;
        }

        const leadAutomation = await processLeadAutomationTurn({
            conversationId,
            latestUserMessage: modelUserMessage,
            settings,
        });
        const appointmentResult = await maybeHandleAppointmentBooking(
            conversationId,
            modelUserMessage,
            {
                mode: leadAutomation.pendingCaptureField ? "validate" : "create",
            },
        );

        let reply: string | null = null;
        let catalogItem: CatalogItemMatch | null = null;
        let pendingCatalogImages = false;
        let pendingCatalogPdf = false;
        let pendingCatalogLink = false;
        let sendCatalogImagesNow = false;
        let sendCatalogPdfNow = false;
        let sendCatalogLinkNow = false;
        let sendOnlyFirstCatalogImageNow = false;
        let usedCatalogAvailabilitySummary = false;
        let catalogDevelopmentContext: Awaited<ReturnType<typeof getCatalogDevelopmentContext>> | null = null;
        let replyFromModel = false;

        if (
            appointmentResult.kind === "missing" ||
            appointmentResult.kind === "unavailable" ||
            appointmentResult.kind === "created"
        ) {
            reply = appointmentResult.reply;
        } else {
            const appointmentInstruction =
                appointmentResult.kind === "validated" && leadAutomation.pendingCaptureField
                    ? [
                        `Ya verificaste operativamente que el horario ${appointmentResult.availableSlot.label} sigue disponible.`,
                        "Todavia no confirmes que la cita quedo agendada.",
                        `Antes de reservarla, pide unicamente el dato pendiente del cliente (${leadAutomation.pendingCaptureField === "name" ? "nombre completo" : "correo electronico"}).`,
                        "Manten el mismo horario como referencia y no inventes asesoras, ejecutivos ni datos de contacto humanos.",
                    ].join(" ")
                    : null;

            if (catalogAssistantEnabled) {
                const activeCatalogItem = latestConversation.catalogState?.catalogItem || null;
                const shouldStickToCurrentDevelopment = activeCatalogItem
                    ? (
                        latestMessageMentionsDevelopment(latestUserMessage, activeCatalogItem.development) ||
                        isCatalogDetailFollowUp(latestUserMessage)
                    )
                    : false;
                const catalogLookupQuery = shouldStickToCurrentDevelopment
                    ? modelUserMessage
                    : buildCatalogLookupQuery(
                        latestConversation.messages.map((message) => ({
                            content: message.content,
                            direction: message.direction,
                        })),
                        modelUserMessage,
                    );
                const developmentScopedCatalogItem =
                    shouldStickToCurrentDevelopment && activeCatalogItem
                        ? await findBestCatalogItemInDevelopment(
                            activeCatalogItem.development,
                            modelUserMessage,
                        )
                        : null;
                const latestCatalogAvailabilitySummary = shouldStickToCurrentDevelopment
                    ? null
                    : await findCatalogAvailabilitySummary(modelUserMessage);
                const latestRequestedLocation = latestCatalogAvailabilitySummary?.requestedLocation || null;
                const catalogAvailabilitySummary = latestCatalogAvailabilitySummary ||
                    (
                        !shouldStickToCurrentDevelopment &&
                        catalogLookupQuery !== latestUserMessage &&
                        !latestRequestedLocation
                            ? await findCatalogAvailabilitySummary(catalogLookupQuery)
                            : null
                    );
                const shouldSuppressCatalogItemLookup = Boolean(catalogAvailabilitySummary?.noDirectMatches);
                catalogItem =
                    shouldSuppressCatalogItemLookup
                        ? null
                        : developmentScopedCatalogItem ||
                    await findBestCatalogItem(modelUserMessage) ||
                    (
                        !shouldStickToCurrentDevelopment &&
                        !shouldSuppressCatalogItemLookup &&
                        catalogLookupQuery !== modelUserMessage
                            ? await findBestCatalogItem(catalogLookupQuery)
                            : null
                    ) ||
                    (
                        shouldStickToCurrentDevelopment
                            ? activeCatalogItem
                            : null
                    );
                const catalogIntent = parseCatalogAssetIntent(latestUserMessage);
                const shouldPreferCatalogSummary =
                    Boolean(catalogAvailabilitySummary) &&
                    !shouldStickToCurrentDevelopment &&
                    (!catalogItem || !latestMessageMentionsDevelopment(latestUserMessage, catalogItem.development));

                if (shouldPreferCatalogSummary) {
                    reply = buildCatalogAvailabilityReply(catalogAvailabilitySummary);
                    catalogItem = null;
                    usedCatalogAvailabilitySummary = true;
                } else if (catalogItem) {
                    catalogDevelopmentContext = await getCatalogDevelopmentContext(
                        catalogItem.id,
                        6,
                        latestUserMessage,
                    );
                    const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
                        catalogItem.assets,
                        settings.catalogMaxImagesToSend,
                    );

                    const requestedImages = Boolean(catalogIntent.wantsImages && imageAssets.length > 0);
                    const requestedPdf = Boolean(catalogIntent.wantsPdf && pdfAsset);
                    const alreadySentCurrentItemAssets = Boolean(
                        latestConversation.catalogState?.catalogItemId === catalogItem.id &&
                        latestConversation.catalogState?.lastSentAt,
                    );
                    const shouldAutoSendFirstImage =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferImages &&
                        imageAssets.length > 0 &&
                        !requestedImages &&
                        !alreadySentCurrentItemAssets;
                    const remainingImagesAfterAutoSend = Math.max(
                        0,
                        imageAssets.length - (shouldAutoSendFirstImage ? 1 : 0),
                    );

                    sendOnlyFirstCatalogImageNow = shouldAutoSendFirstImage;
                    sendCatalogImagesNow =
                        requestedImages ||
                        shouldAutoSendFirstImage ||
                        (!settings.catalogAskBeforeSending &&
                            settings.catalogOfferImages &&
                            imageAssets.length > 0);
                    sendCatalogPdfNow =
                        requestedPdf ||
                        (!settings.catalogAskBeforeSending &&
                            settings.catalogOfferPdf &&
                            Boolean(pdfAsset));

                    pendingCatalogImages =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferImages &&
                        remainingImagesAfterAutoSend > 0 &&
                        !requestedImages;
                    pendingCatalogPdf =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferPdf &&
                        Boolean(pdfAsset) &&
                        !requestedPdf;

                    sendCatalogLinkNow =
                        settings.catalogIncludeLink &&
                        Boolean(linkAsset) &&
                        (
                            sendCatalogImagesNow ||
                            sendCatalogPdfNow ||
                            (!pendingCatalogImages && !pendingCatalogPdf)
                        );
                    pendingCatalogLink =
                        settings.catalogIncludeLink &&
                        Boolean(linkAsset) &&
                        !sendCatalogLinkNow &&
                        (pendingCatalogImages || pendingCatalogPdf);
                }
            }

            if (!reply) {
                const catalogInstruction = catalogItem
                    ? buildCatalogInstruction(catalogItem, catalogDevelopmentContext)
                    : null;
                const attributionInstruction = buildInboundAttributionInstruction(inboundAttribution);
                const automationInstruction = [leadAutomation.instruction, appointmentInstruction, attributionInstruction]
                    .concat(catalogInstruction ? [catalogInstruction] : [])
                    .filter(Boolean)
                    .join(" ")
                    .trim() || null;

                reply = await generateConversationReply(
                    conversationId,
                    modelUserMessage,
                    automationInstruction,
                );
                replyFromModel = true;
            }
        }

        if (!reply) return;

        if (
            replyFromModel &&
            appointmentResult.kind === "none" &&
            claimsUnverifiedAppointmentAvailability(reply)
        ) {
            reply = buildVerifiedAvailabilityFallbackReply();
        }

        const shouldEscalate =
            replyFromModel &&
            settings.escalationEnabled &&
            Boolean(settings.escalationPhone?.trim()) &&
            shouldEscalateUnknownReply(reply);

        if (shouldEscalate) {
            reply = buildEscalationCustomerReply();
            catalogItem = null;
            pendingCatalogImages = false;
            pendingCatalogPdf = false;
            pendingCatalogLink = false;
            sendCatalogImagesNow = false;
            sendCatalogPdfNow = false;
            sendCatalogLinkNow = false;
            sendOnlyFirstCatalogImageNow = false;
        }

        if (catalogItem && settings.catalogAskBeforeSending) {
            const imageCountForOffer = Math.max(
                0,
                splitCatalogAssets(
                    catalogItem.assets,
                    settings.catalogMaxImagesToSend,
                ).imageAssets.length - (sendOnlyFirstCatalogImageNow ? 1 : 0),
            );
            const offerText = buildCatalogOfferText({
                offerImages: pendingCatalogImages,
                imageCount: imageCountForOffer,
                offerPdf: pendingCatalogPdf,
            });
            if (shouldAppendCatalogOffer(reply, {
                offerImages: pendingCatalogImages,
                offerPdf: pendingCatalogPdf,
            })) {
                reply = appendSection(reply, offerText);
            }
        }

        const canSendAfterPacing = await waitForBotReplyPacing({
            settings,
            conversationId,
            inboundMessageId,
            cancelIfNewerInbound: false,
        });
        if (!canSendAfterPacing) return;

        let replyToSend = reply;
        let preferredReplyImageSent = false;
        let knowledgeImageSent = false;
        const preferredKnowledgeImageUrls =
            !shouldEscalate && !catalogItem
                ? extractKnowledgeImageUrlsFromReply(reply)
                : [];

        if (!shouldEscalate && !catalogItem) {
            if (preferredKnowledgeImageUrls.length > 0) {
                preferredReplyImageSent = await sendPreferredImageUrlsFromReply({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    imageUrls: preferredKnowledgeImageUrls,
                });
            }

            if (preferredKnowledgeImageUrls.length > 0 && !preferredReplyImageSent) {
                knowledgeImageSent = await maybeSendKnowledgeImageFromTextSources({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    latestUserMessage,
                    assistantReplyText: reply,
                    preferredImageUrls: preferredKnowledgeImageUrls,
                });
            }

            if ((preferredReplyImageSent || knowledgeImageSent) && preferredKnowledgeImageUrls.length > 0) {
                const strippedReply = stripKnowledgeImageUrlsFromReply(reply, preferredKnowledgeImageUrls);
                replyToSend = strippedReply || "Te comparto la imagen por aqui.";
            } else if (preferredKnowledgeImageUrls.length > 0) {
                const strippedReply = stripKnowledgeImageUrlsFromReply(reply, preferredKnowledgeImageUrls);
                replyToSend = strippedReply || "Perfecto, seguimos por aqui con los detalles.";
            }
        }

        await sendAutomatedBotText({
            conversationId,
            phone: latestConversation.contact.phone,
            content: replyToSend,
        });

        if (shouldEscalate) {
            await triggerHumanEscalation({
                conversationId,
                escalationPhone: settings.escalationPhone || "",
                contactPhone: latestConversation.contact.phone,
                brandName: settings.agentName,
                contact: latestConversation.contact,
                latestUserMessage,
            });
        }

        if (catalogItem) {
            const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
                catalogItem.assets,
                settings.catalogMaxImagesToSend,
            );
            const imageAssetsToSend = sendOnlyFirstCatalogImageNow
                ? imageAssets.slice(0, 1)
                : imageAssets;

            if (sendCatalogImagesNow || sendCatalogPdfNow || sendCatalogLinkNow) {
                await sendCatalogAssets({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    development: catalogItem.development,
                    imageAssets: imageAssetsToSend,
                    pdfAsset,
                    linkAsset,
                    sendImages: sendCatalogImagesNow,
                    sendPdf: sendCatalogPdfNow,
                    sendLink: sendCatalogLinkNow,
                });
            }

            await persistCatalogState({
                conversationId,
                catalogItemId: catalogItem.id,
                pendingImages: pendingCatalogImages,
                pendingPdf: pendingCatalogPdf,
                pendingLink: pendingCatalogLink,
                offeredAt:
                    pendingCatalogImages || pendingCatalogPdf
                        ? new Date()
                        : null,
                lastSentAt:
                    sendCatalogImagesNow || sendCatalogPdfNow || sendCatalogLinkNow
                        ? new Date()
                        : latestConversation.catalogState?.lastSentAt || null,
            });
        } else if (usedCatalogAvailabilitySummary) {
            await persistCatalogState({
                conversationId,
                catalogItemId: null,
                pendingImages: false,
                pendingPdf: false,
                pendingLink: false,
                offeredAt: null,
                lastSentAt: latestConversation.catalogState?.lastSentAt || null,
            });
        }

        await touchAutomatedConversation(conversationId);
    } catch (error) {
        console.error("[Bot] Failed to send automated reply:", error);
    }
}

async function waitForBotReplyPacing(params: {
    settings: AppSystemSettings;
    conversationId: string;
    inboundMessageId: string;
    cancelIfNewerInbound?: boolean;
}) {
    const delayMs = resolveRandomBotReplyDelayMs(params.settings);
    if (delayMs > 0) {
        await sleep(delayMs);
    }

    if (params.cancelIfNewerInbound === false) {
        return true;
    }

    const latestInbound = await prisma.message.findFirst({
        where: {
            conversationId: params.conversationId,
            direction: "inbound",
            type: { not: "system" },
        },
        orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
        ],
        select: { id: true },
    });

    return latestInbound?.id === params.inboundMessageId;
}

export async function getConversations() {
    await requirePermission("chats.manage");
    try {
        const conversations = await prisma.conversation.findMany({
            include: {
                contact: true,
                messages: {
                    orderBy: [
                        { createdAt: "desc" },
                        { id: "desc" },
                    ],
                    take: 1,
                },
            },
            orderBy: [
                { updatedAt: "desc" },
                { id: "desc" },
            ],
        });
        return conversations;
    } catch (error) {
        console.error("Failed to fetch conversations:", error);
        return [];
    }
}

export async function getMessages(conversationId: string) {
    await requirePermission("chats.manage");
    try {
        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: [
                { createdAt: "asc" },
                { id: "asc" },
            ],
        });
        return messages;
    } catch (error) {
        console.error("Failed to fetch messages:", error);
        return [];
    }
}

export async function sendMessage(conversationId: string, content: string, direction: "inbound" | "outbound" = "outbound") {
    await requirePermission("chats.manage");
    console.log("!!! [SendMessage] FUNCTION CALLED !!!", { conversationId, content, direction });
    try {
        // Get conversation with contact to get phone number
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!conversation) {
            throw new Error("Conversation not found");
        }

        const isHumanOutbound = direction === "outbound";
        const sourceType = normalizeMessageSourceType(conversation.sourceType);
        const sourceSettings = await getSystemSettingsOrDefaults();
        const sourceId = conversation.sourceId || resolveMessageSourceId(sourceType, sourceSettings);

        // Create message in database first
        const message = await prisma.message.create({
            data: {
                conversationId,
                content,
                direction,
                status: "sending",
                type: "text",
                senderType: isHumanOutbound ? "human" : null,
                sourceType,
                sourceId,
            },
        });

        console.log("[SendMessage] Created message:", message.id);
        console.log("[SendMessage] Direction:", direction);
        console.log("[SendMessage] Contact phone:", conversation.contact?.phone);

        // If outbound, send via WhatsApp QR gateway
        if (direction === "outbound" && conversation.contact?.phone) {
            console.log("[SendMessage] Attempting to send via WhatsApp...", sourceType);
            try {
                const result = sourceType === "meta"
                    ? await sendMetaTextMessage(conversation.contact.phone, content)
                    : await sendWuzapiTextMessage(conversation.contact.phone, content);

                // Update message status to sent
                await prisma.message.update({
                    where: { id: message.id },
                    data: {
                        status: result?.Id ? "sent" : "failed",
                        providerMessageId: result?.Id || null,
                    },
                });
            } catch (whatsappError) {
                console.error("[SendMessage] WhatsApp send error:", whatsappError);
                // Update message status to failed
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: "failed" },
                });
            }
        } else {
            console.log("[SendMessage] Skipping WhatsApp transport - direction:", direction, "phone:", conversation.contact?.phone);
            // For inbound or no phone, just mark as sent
            await prisma.message.update({
                where: { id: message.id },
                data: { status: "sent" },
            });
        }

        if (direction === "outbound" && conversation.contact?.id) {
            void refreshWhatsAppAvatarForContact(conversation.contact.id).catch((avatarError) => {
                console.warn("[SendMessage] Failed to refresh WhatsApp avatar", avatarError);
            });
        }

        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                updatedAt: new Date(),
                botActive: isHumanOutbound ? false : conversation.botActive,
            },
        });

        revalidatePath(`/dashboard/inbox`);
        return message;
    } catch (error) {
        console.error("Failed to send message:", error);
        throw new Error("Failed to send message");
    }
}

export async function createConversation(contactId: string) {
    await requirePermission("chats.manage");
    try {
        const settings = await getSystemSettingsOrDefaults();
        const conversation = await findOrCreateActiveConversationForContactSource({
            contactId,
            sourceType: "wuzapi",
            sourceId: resolveMessageSourceId("wuzapi", settings),
        });

        revalidatePath('/dashboard/inbox');
        return conversation;
    } catch (error) {
        console.error("Error creating conversation:", error);
        throw new Error("Failed to create conversation");
    }
}

// Process incoming webhook message and store in database
export async function processInboundMessage(
    from: string,
    text: string,
    customerName?: string,
    media?: InboundMediaPayload,
    providerMessageId?: string,
    attribution?: InboundAttribution,
    source?: InboundMessageSource,
) {
    try {
        const normalizedFrom = normalizePhoneDigits(from);
        if (!normalizedFrom) {
            return;
        }

        const normalizedSourceType = normalizeMessageSourceType(source?.sourceType);
        const sourceSettings = await getSystemSettingsOrDefaults();
        const inboundSourceId =
            source?.sourceId?.trim() ||
            resolveMessageSourceId(normalizedSourceType, sourceSettings);

        if (providerMessageId) {
            const duplicatedMessage = await prisma.message.findFirst({
                where: {
                    providerMessageId,
                    sourceType: normalizedSourceType,
                },
                include: {
                    conversation: {
                        include: {
                            contact: true,
                        },
                    },
                },
            });

            if (duplicatedMessage) {
                return {
                    contact: duplicatedMessage.conversation.contact,
                    conversation: duplicatedMessage.conversation,
                    message: duplicatedMessage,
                    duplicate: true,
                };
            }
        }

        const normalizedCustomerName = normalizeContactName(customerName);
        const phoneClauses = buildPhoneMatchClauses([normalizedFrom]);

        // Find or create contact by phone number
        let contact = phoneClauses.length > 0 ? await prisma.contact.findFirst({
            where: { OR: phoneClauses },
        }) : null;

        if (!contact) {
            contact = await prisma.contact.create({
                data: {
                    phone: normalizedFrom,
                    name: normalizedCustomerName,
                    status: "lead",
                },
            });
        } else if (normalizedCustomerName && !normalizeContactName(contact.name)) {
            // Update contact name if we got it from webhook and it's not set
            contact = await prisma.contact.update({
                where: { id: contact.id },
                data: { name: normalizedCustomerName },
            });
        }

        const attributionTags = buildInboundAttributionTags(attribution);
        if (attributionTags.length > 0) {
            const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
            const mergedTags = Array.from(new Set([...currentTags, ...attributionTags]));
            if (mergedTags.length !== currentTags.length) {
                contact = await prisma.contact.update({
                    where: { id: contact.id },
                    data: { tags: mergedTags },
                });
            }
        }

        const inboundDealSource = resolveInboundDealSource(attribution);

        const shouldAwaitInitialAvatarRefresh = !contact.whatsappAvatarCheckedAt;
        if (shouldAwaitInitialAvatarRefresh) {
            try {
                await refreshWhatsAppAvatarForContact(contact.id, { force: true });
            } catch (avatarError) {
                console.warn("[Inbound] Failed to refresh WhatsApp avatar on first contact", avatarError);
            }
        } else {
            void refreshWhatsAppAvatarForContact(contact.id).catch((avatarError) => {
                console.warn("[Inbound] Failed to refresh WhatsApp avatar", avatarError);
            });
        }

        // Find or create conversation
        let conversation = await findOrCreateActiveConversationForContactSource({
            contactId: contact.id,
            sourceType: normalizedSourceType,
            sourceId: inboundSourceId,
        });

        let conversationBotActive = conversation.botActive ?? true;
        if (!conversationBotActive) {
            const [humanOutboundCount, latestOutboundMessage] = await Promise.all([
                prisma.message.count({
                    where: {
                        conversationId: conversation.id,
                        direction: "outbound",
                        senderType: "human",
                    },
                }),
                prisma.message.findFirst({
                    where: {
                        conversationId: conversation.id,
                        direction: "outbound",
                    },
                    orderBy: [
                        { createdAt: "desc" },
                        { id: "desc" },
                    ],
                    select: {
                        senderType: true,
                    },
                }),
            ]);

            const shouldRecoverBotMode = humanOutboundCount === 0 && (
                !latestOutboundMessage || latestOutboundMessage.senderType === "bot"
            );

            if (shouldRecoverBotMode) {
                conversation = await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        botActive: true,
                        updatedAt: new Date(),
                    },
                });
                conversationBotActive = true;
                console.warn("[Inbound] Auto-recovered bot mode for paused conversation without human outbound", {
                    conversationId: conversation.id,
                    contactId: contact.id,
                });
            }
        }

        const inboundAdPreviewPayload = buildInboundAdPreviewPayloadFromAttribution(attribution);
        if (inboundAdPreviewPayload) {
            await maybeCreateInboundAdPreviewSystemMessage(conversation.id, inboundAdPreviewPayload);
        }

        // Create inbound message with optional media
        const messageOccurredAt = source?.occurredAt && !Number.isNaN(source.occurredAt.getTime())
            ? source.occurredAt
            : undefined;

        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: text,
                direction: "inbound",
                status: "delivered",
                type: media?.type || "text",
                mediaUrl: media?.mediaUrl || null,
                mediaType: media?.mediaType || null,
                mediaFileName: media?.mediaFileName || null,
                providerMessageId: providerMessageId || null,
                sourceType: normalizedSourceType,
                sourceId: inboundSourceId,
                ...(messageOccurredAt ? { createdAt: messageOccurredAt } : {}),
            },
        });

        // Update conversation activity timestamp
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: messageOccurredAt && messageOccurredAt > conversation.updatedAt ? messageOccurredAt : new Date(),
                ...(normalizedSourceType === "meta"
                    ? { sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                    : {}),
            },
        });

        // â”€â”€ Ensure the contact already exists in the pipeline before evaluating stop rules â”€â”€
        try {
            const existingDeal = await prisma.deal.findFirst({
                where: { contactId: contact.id },
            });

            if (existingDeal) {
                if (inboundDealSource !== "whatsapp" && existingDeal.source !== inboundDealSource) {
                    await prisma.deal.update({
                        where: { id: existingDeal.id },
                        data: { source: inboundDealSource },
                    });
                }
            } else {
                const incomingStage = await prisma.pipelineStage.findFirst({
                    where: { isIncoming: true },
                });

                if (incomingStage) {
                    const displayName = normalizeContactName(contact.name) || normalizedCustomerName;
                    const dealTitle = displayName
                        ? `Lead - ${displayName}`
                        : `Lead WhatsApp - ${from}`;

                    await prisma.deal.create({
                        data: {
                            title: dealTitle,
                            value: 0,
                            stageId: incomingStage.id,
                            contactId: contact.id,
                            source: inboundDealSource,
                            priority: "medium",
                        },
                    });
                    revalidatePath("/dashboard/pipeline");
                }
            }
        } catch (dealError) {
            console.error("[Pipeline] Failed to auto-create deal:", dealError);
        }

        const botInputText = await buildInboundMediaContext({
            text,
            type: media?.type,
            mediaUrl: media?.mediaUrl,
            mediaType: media?.mediaType,
            mediaFileName: media?.mediaFileName,
        });

        const bulkReplyResult = await markBulkCampaignReplyForContact(
            contact.id,
            conversation.id,
            botInputText || text,
            message.createdAt,
        );
        const conversationWasBotActive = conversationBotActive;
        let shouldScheduleAutomatedReply = conversationWasBotActive;

        if (bulkReplyResult.intent === "stop") {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    botActive: false,
                    updatedAt: new Date(),
                },
            });
            shouldScheduleAutomatedReply = false;
            revalidatePath("/dashboard/pipeline");
        } else if (bulkReplyResult.activatedBot && conversationWasBotActive) {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    botActive: true,
                    updatedAt: new Date(),
                },
            });
            shouldScheduleAutomatedReply = true;
        } else if (bulkReplyResult.activatedBot && !conversationWasBotActive) {
            console.log("[Chatbot] Interest detected but the conversation stays in human mode:", conversation.id);
        }

        // ── CHATBOT / N8N FORWARDING ──
        try {
            if (bulkReplyResult.intent !== "stop" && shouldScheduleAutomatedReply) {
                void maybeSendAutomatedReply(conversation.id, message.id, botInputText, attribution);
            }
        } catch (botError) {
            console.error("[Chatbot] Error scheduling automated reply:", botError);
        }

        // ── AI Contact Enrichment (fire-and-forget) ──
        enrichContactFromMessage(contact.id, botInputText || text).catch((err) => {
            console.error("[AI Enrichment] Background enrichment failed:", err);
        });

        revalidatePath("/dashboard/inbox");
        return { contact, conversation, message };
    } catch (error) {
        console.error("Failed to process inbound message:", error);
        throw error;
    }
}
