import { isPlausiblePhoneDigits } from "@/lib/phone";
import { normalizePhoneForOperation } from "@/lib/operation-context";

export const MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT = 5000;
export const BULK_CAMPAIGN_AUDIENCE_MODES = ["filters", "selected", "mixed"] as const;
export const BULK_CAMPAIGN_AUDIENCE_SOURCES = ["any", "wuzapi", "meta"] as const;

export type BulkCampaignAudienceMode = (typeof BULK_CAMPAIGN_AUDIENCE_MODES)[number];
export type BulkCampaignAudienceSource = (typeof BULK_CAMPAIGN_AUDIENCE_SOURCES)[number];

export type BulkCampaignManualEntry = {
    phone: string;
    name: string;
    company: string;
};

export type BulkCampaignAudienceFilters = {
    mode: BulkCampaignAudienceMode;
    statuses: string[];
    tags: string[];
    query: string;
    limit: number | null;
    sourceType: BulkCampaignAudienceSource;
    sourceId: string;
    onlyOpenYCloudWindow: boolean;
    lastInboundFrom: string;
    lastInboundTo: string;
    selectedContactIds: string[];
    manualEntries: BulkCampaignManualEntry[];
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value
        .map((entry) => normalizeString(entry))
        .filter(Boolean)
        .filter((entry, index, array) => array.indexOf(entry) === index);
}

export function normalizeBulkCampaignAudienceMode(value: unknown): BulkCampaignAudienceMode {
    const normalized = normalizeString(value).toLowerCase();
    if (BULK_CAMPAIGN_AUDIENCE_MODES.includes(normalized as BulkCampaignAudienceMode)) {
        return normalized as BulkCampaignAudienceMode;
    }
    return "filters";
}

export function normalizeBulkCampaignAudienceSource(value: unknown): BulkCampaignAudienceSource {
    const normalized = normalizeString(value).toLowerCase();
    if (BULK_CAMPAIGN_AUDIENCE_SOURCES.includes(normalized as BulkCampaignAudienceSource)) {
        return normalized as BulkCampaignAudienceSource;
    }
    return "any";
}

function parseManualLine(line: string, defaultCountryCode?: string | null): BulkCampaignManualEntry | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const separators = ["|", ";", ","];
    let phoneCandidate = trimmed;
    let labelCandidate = "";

    for (const separator of separators) {
        if (!trimmed.includes(separator)) continue;
        const segments = trimmed
            .split(separator)
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (segments.length >= 2) {
            phoneCandidate = segments[segments.length - 1] || "";
            labelCandidate = segments.slice(0, -1).join(" ").trim();
            break;
        }
    }

    const phoneLikeMatches = Array.from(trimmed.matchAll(/(?:\+?\d[\d\s().-]{6,}\d)/g));
    if (phoneLikeMatches.length > 0) {
        const lastPhoneLike = phoneLikeMatches[phoneLikeMatches.length - 1]?.[0] || "";
        phoneCandidate = lastPhoneLike;
        if (!labelCandidate) {
            labelCandidate = trimmed.replace(lastPhoneLike, "").replace(/[|;,]+$/, "").trim();
        }
    }

    const phone = normalizePhoneForOperation(phoneCandidate, defaultCountryCode);
    if (!isPlausiblePhoneDigits(phone)) {
        return null;
    }

    return {
        phone,
        name: labelCandidate,
        company: "",
    };
}

export function parseBulkCampaignManualEntries(rawValue: string, defaultCountryCode?: string | null) {
    const seen = new Set<string>();

    return rawValue
        .split(/\r?\n/g)
        .map((line) => parseManualLine(line, defaultCountryCode))
        .filter((entry): entry is BulkCampaignManualEntry => Boolean(entry))
        .filter((entry) => {
            if (seen.has(entry.phone)) return false;
            seen.add(entry.phone);
            return true;
        });
}

export function formatBulkCampaignManualEntries(entries: BulkCampaignManualEntry[]) {
    return entries
        .map((entry) => {
            const label = normalizeString(entry.name);
            return label ? `${label} | ${entry.phone}` : entry.phone;
        })
        .join("\n");
}

export function normalizeBulkCampaignManualEntries(value: unknown, defaultCountryCode?: string | null) {
    const entries = Array.isArray(value) ? value : [];
    const seen = new Set<string>();

    return entries
        .map((entry) => {
            const record = typeof entry === "object" && entry !== null
                ? (entry as Record<string, unknown>)
                : {};
            const phone = normalizePhoneForOperation(normalizeString(record.phone), defaultCountryCode);
            if (!isPlausiblePhoneDigits(phone)) {
                return null;
            }

            return {
                phone,
                name: normalizeString(record.name),
                company: normalizeString(record.company),
            } satisfies BulkCampaignManualEntry;
        })
        .filter((entry): entry is BulkCampaignManualEntry => Boolean(entry))
        .filter((entry) => {
            if (seen.has(entry.phone)) return false;
            seen.add(entry.phone);
            return true;
        });
}

export function normalizeBulkCampaignAudienceFilters(
    value: unknown,
    maxLimit = MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    defaultCountryCode?: string | null,
): BulkCampaignAudienceFilters {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const statuses = normalizeStringList(record.statuses).map((entry) => entry.toLowerCase());
    const tags = normalizeStringList(record.tags);
    const query = normalizeString(record.query);
    const limitRaw = clampInteger(record.limit, 0, 0, maxLimit);

    return {
        mode: normalizeBulkCampaignAudienceMode(record.mode),
        statuses,
        tags,
        query,
        limit: limitRaw > 0 ? limitRaw : null,
        sourceType: normalizeBulkCampaignAudienceSource(record.sourceType),
        sourceId: normalizeString(record.sourceId),
        onlyOpenYCloudWindow: record.onlyOpenYCloudWindow === true,
        lastInboundFrom: normalizeString(record.lastInboundFrom),
        lastInboundTo: normalizeString(record.lastInboundTo),
        selectedContactIds: normalizeStringList(record.selectedContactIds),
        manualEntries: normalizeBulkCampaignManualEntries(record.manualEntries, defaultCountryCode),
    };
}
