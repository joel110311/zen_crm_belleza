export const INBOUND_AD_PREVIEW_PREFIX = "CTWA_AD_PREVIEW::";

export type InboundAdPreviewPayload = {
    source: "facebook_ads";
    title?: string;
    body?: string;
    context?: string;
    sourceUrl?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    productHint?: string;
    entryPointConversionSource?: string;
    conversionSource?: string;
};

function normalizeValue(value: unknown, maxLength = 320) {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;
    return normalized.slice(0, maxLength);
}

function normalizeUrl(value: unknown) {
    const normalized = normalizeValue(value, 1024);
    if (!normalized) return undefined;
    if (!/^https?:\/\//i.test(normalized)) return undefined;
    return normalized;
}

export function normalizeInboundAdPreviewPayload(
    payload: Partial<InboundAdPreviewPayload> | null | undefined,
): InboundAdPreviewPayload | null {
    if (!payload) return null;

    const normalized: InboundAdPreviewPayload = {
        source: "facebook_ads",
        title: normalizeValue(payload.title, 180),
        body: normalizeValue(payload.body, 260),
        context: normalizeValue(payload.context, 320),
        sourceUrl: normalizeUrl(payload.sourceUrl),
        mediaUrl: normalizeUrl(payload.mediaUrl),
        thumbnailUrl: normalizeUrl(payload.thumbnailUrl),
        productHint: normalizeValue(payload.productHint, 120),
        entryPointConversionSource: normalizeValue(payload.entryPointConversionSource, 64),
        conversionSource: normalizeValue(payload.conversionSource, 64),
    };

    const hasVisualData = Boolean(
        normalized.title ||
            normalized.body ||
            normalized.context ||
            normalized.sourceUrl ||
            normalized.mediaUrl ||
            normalized.thumbnailUrl ||
            normalized.productHint,
    );

    return hasVisualData ? normalized : null;
}

export function buildInboundAdPreviewMessageContent(payload: InboundAdPreviewPayload) {
    const normalized = normalizeInboundAdPreviewPayload(payload);
    if (!normalized) return null;
    return `${INBOUND_AD_PREVIEW_PREFIX}${JSON.stringify(normalized)}`;
}

export function parseInboundAdPreviewMessageContent(content: string | null | undefined) {
    if (!content || !content.startsWith(INBOUND_AD_PREVIEW_PREFIX)) return null;

    const raw = content.slice(INBOUND_AD_PREVIEW_PREFIX.length).trim();
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<InboundAdPreviewPayload>;
        return normalizeInboundAdPreviewPayload(parsed);
    } catch {
        return null;
    }
}

function normalizeFingerprintPart(value: string | undefined) {
    return (
        value
            ?.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim() || ""
    );
}

export function buildInboundAdPreviewFingerprint(payload: InboundAdPreviewPayload) {
    return [
        payload.title,
        payload.body,
        payload.context,
        payload.sourceUrl,
        payload.mediaUrl,
        payload.thumbnailUrl,
        payload.productHint,
        payload.entryPointConversionSource,
        payload.conversionSource,
    ]
        .map((value) => normalizeFingerprintPart(value))
        .filter(Boolean)
        .join("|");
}
