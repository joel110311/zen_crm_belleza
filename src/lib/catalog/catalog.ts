import { prisma } from "@/lib/db";
import { generateEmbeddings, generateEmbedding } from "@/lib/ai/openai";

type CatalogImportRow = {
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
    isActive: boolean;
    assets: Array<{
        type: "image" | "pdf" | "link";
        url: string;
        label?: string | null;
        sortOrder: number;
    }>;
};

export type CatalogManualEntryInput = {
    externalId?: string;
    development: string;
    location?: string | null;
    question: string;
    answer: string;
    imageUrls?: string[];
    pdfUrl?: string | null;
    linkUrl?: string | null;
    isActive?: boolean;
};

export type CatalogUrlPreview = {
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    answer: string;
    imageUrls: string[];
    pdfUrl: string | null;
    linkUrl: string;
};

export type CatalogFetchOptions = {
    requestMode?: "standard" | "browser";
    authorizationHeader?: string | null;
    cookieHeader?: string | null;
    refererUrl?: string | null;
};

export type CatalogBulkImportInput = CatalogFetchOptions & {
    indexUrl: string;
    urlFilterText?: string | null;
    maxItems?: number;
};

export type CatalogBulkImportResult = {
    importedCount: number;
    assetCount: number;
    discoveredCount: number;
    processedCount: number;
    failedCount: number;
    duplicateCount: number;
    failedUrls: string[];
};

type CatalogSearchResult = {
    id: string;
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
    similarity: number;
};

export type CatalogAvailabilitySummary = {
    locationHint: string | null;
    requestedLocation: string | null;
    noDirectMatches: boolean;
    developments: Array<{
        development: string;
        location: string | null;
    }>;
};

export type CatalogDevelopmentContext = {
    development: string;
    location: string | null;
    entries: Array<{
        question: string;
        answer: string;
    }>;
};

const MAX_IMPORT_IMAGES = 10;
const MAX_CATALOG_MATCHES = 3;
const MIN_VECTOR_SIMILARITY = 0.62;
const MAX_AVAILABILITY_SUMMARY_ITEMS = 8;
const DEFAULT_CATALOG_BULK_IMPORT_ITEMS = 12;
const MAX_CATALOG_BULK_IMPORT_ITEMS = 30;
const CATALOG_BOT_USER_AGENT = "ZenCRMCatalog/1.0 (+https://zen-crm.local)";
const CATALOG_BROWSER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const TRACKING_QUERY_PARAM_PREFIXES = ["utm_"];
const TRACKING_QUERY_PARAM_KEYS = new Set([
    "fbclid",
    "gclid",
    "gclsrc",
    "mc_cid",
    "mc_eid",
    "n_src",
    "n_pg",
    "n_pos",
    "from",
    "source",
    "search",
    "searchorder",
]);
const CLEAN_PATH_PORTALS = new Set(["zonaprop.com.ar", "argenprop.com"]);
const CATALOG_QUERY_STOPWORDS = new Set([
    "a", "ahi", "alli", "algun", "alguna", "algunas", "algunos", "ando", "asi", "ayuda",
    "busca", "buscar", "como", "con", "cual", "cuales", "de", "del", "dime", "donde",
    "en", "esa", "esas", "ese", "eso", "esos", "estas", "este", "esto", "estos",
    "favor", "hay", "hola", "la", "las", "lo", "los", "manejas", "me", "muestrame",
    "ofreces", "oye", "para", "podrias", "por", "propiedad", "propiedades", "proyecto",
    "proyectos", "que", "quiero", "tendra", "tendras", "tendrás", "tener", "tienes",
    "un", "una", "unas", "unos", "ver",
]);
const CATALOG_GENERIC_AVAILABILITY_TERMS = [
    "propiedad", "propiedades", "desarrollo", "desarrollos", "proyecto", "proyectos",
    "casa", "casas", "departamento", "departamentos", "depa", "depas", "terreno",
    "terrenos", "lote", "lotes", "vivienda", "viviendas",
];
const LOCATION_QUERY_PREFIXES = [
    "cerca de ",
    "por la zona de ",
    "por el rumbo de ",
    "por la colonia ",
    "en la colonia ",
    "zona de ",
    "rumbo a ",
    "por ",
    "en ",
];
const LOCATION_NOISE_TOKENS = new Set([
    "cerca", "colonia", "fraccionamiento", "zona", "rumbo", "ubicacion", "ubicado",
    "ubicada", "opcion", "opciones", "algo", "casa", "casas", "propiedad", "propiedades",
    "desarrollo", "desarrollos", "proyecto", "proyectos", "departamento", "departamentos",
    "depa", "depas", "lote", "lotes", "vivienda", "viviendas", "de", "del", "la", "las",
    "el", "los", "y",
]);

type DeduplicatedCatalogRowsResult = {
    rows: CatalogImportRow[];
    duplicateExternalIds: string[];
};

function normalizeHeader(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normalizeCell(value: string | undefined) {
    return (value || "").trim();
}

function sanitizeOptionalCatalogString(value: string | null | undefined) {
    const normalized = normalizeCell(value || "");
    return normalized || undefined;
}

function clampCatalogInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
    const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
    return Math.min(maximum, Math.max(minimum, normalized));
}

function normalizeCatalogFetchOptions(options?: CatalogFetchOptions): Required<CatalogFetchOptions> {
    return {
        requestMode: options?.requestMode === "browser" ? "browser" : "standard",
        authorizationHeader: sanitizeOptionalCatalogString(options?.authorizationHeader) || "",
        cookieHeader: sanitizeOptionalCatalogString(options?.cookieHeader) || "",
        refererUrl: sanitizeOptionalCatalogString(options?.refererUrl) || "",
    };
}

function normalizeMultilineCatalogText(value: string) {
    return (value || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function sanitizeUrlList(urls: string[] | undefined) {
    return (urls || [])
        .map((url) => normalizeCell(url))
        .filter(Boolean);
}

function normalizeSearchText(value: string | null | undefined) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeCatalogQuery(query: string) {
    return normalizeSearchText(query)
        .split(" ")
        .filter((token) => token.length >= 3 && !CATALOG_QUERY_STOPWORDS.has(token));
}

function buildCatalogHaystack(item: {
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
}) {
    return {
        development: normalizeSearchText(item.development),
        location: normalizeSearchText(item.location),
        question: normalizeSearchText(item.question),
        answer: normalizeSearchText(item.answer),
        searchableText: normalizeSearchText(item.searchableText),
    };
}

function scoreCatalogTextMatch(
    item: {
        development: string;
        location: string | null;
        question: string;
        answer: string;
        searchableText: string;
    },
    query: string,
) {
    const normalizedQuery = normalizeSearchText(query);
    const tokens = tokenizeCatalogQuery(query);

    if (tokens.length === 0) {
        return 0;
    }

    const haystack = buildCatalogHaystack(item);
    let score = 0;
    let matchedTokens = 0;

    for (const token of tokens) {
        let tokenMatched = false;

        if (haystack.development.includes(token)) {
            score += 24;
            tokenMatched = true;
        }
        if (haystack.location.includes(token)) {
            score += 30;
            tokenMatched = true;
        }
        if (haystack.question.includes(token)) {
            score += 16;
            tokenMatched = true;
        }
        if (haystack.answer.includes(token)) {
            score += 8;
            tokenMatched = true;
        }
        if (haystack.searchableText.includes(token)) {
            score += 3;
            tokenMatched = true;
        }

        if (tokenMatched) {
            matchedTokens += 1;
        }
    }

    if (haystack.location && normalizedQuery.includes(haystack.location)) {
        score += 90;
    }

    if (haystack.development && normalizedQuery.includes(haystack.development)) {
        score += 80;
    }

    if (haystack.question && normalizedQuery.includes(haystack.question)) {
        score += 55;
    }

    score += matchedTokens * 10;

    return matchedTokens === 0 ? 0 : score;
}

function isGenericAvailabilityQuery(query: string) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return false;

    const hasCatalogNoun = CATALOG_GENERIC_AVAILABILITY_TERMS.some((term) =>
        normalized.includes(term),
    );
    const hasSpecificLocation = Boolean(extractSpecificLocationHint(query));
    const hasAvailabilityIntent =
        /\b(donde|hay|tienes|manejas|ofreces|ubicad|zona|areas|lugares|disponibles|algo|opciones)\b/.test(normalized);

    return (hasCatalogNoun || hasSpecificLocation) && hasAvailabilityIntent;
}

function extractAvailabilityHintTokens(query: string) {
    const specificLocationHint = extractSpecificLocationHint(query);
    if (specificLocationHint) {
        return specificLocationHint.tokens;
    }

    return tokenizeCatalogQuery(query).filter(
        (token) =>
            !CATALOG_GENERIC_AVAILABILITY_TERMS.includes(token) &&
            !LOCATION_NOISE_TOKENS.has(token),
    );
}

function formatLocationLabel(value: string) {
    return value
        .split(" ")
        .filter(Boolean)
        .map((word) => (
            ["de", "del", "la", "las", "el", "los", "y"].includes(word)
                ? word
                : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
        ))
        .join(" ");
}

function extractSpecificLocationHint(query: string) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return null;

    let bestCandidate: string | null = null;
    let bestIndex = -1;

    for (const prefix of LOCATION_QUERY_PREFIXES) {
        const index = normalized.lastIndexOf(prefix);
        if (index === -1) continue;

        const candidate = normalized.slice(index + prefix.length).trim();
        if (!candidate || candidate.length < 3) continue;

        if (index > bestIndex) {
            bestIndex = index;
            bestCandidate = candidate;
        }
    }

    if (!bestCandidate) {
        return null;
    }

    const tokens = bestCandidate
        .split(" ")
        .filter((token) => token.length >= 3 && !LOCATION_NOISE_TOKENS.has(token));

    if (tokens.length === 0) {
        return null;
    }

    return {
        raw: formatLocationLabel(bestCandidate),
        normalized: bestCandidate,
        tokens,
    };
}

function resolveAvailabilityLocationHint(
    hintTokens: string[],
    developments: Array<{ development: string; location: string | null }>,
) {
    const locationScores = new Map<string, { label: string; score: number }>();

    for (const development of developments) {
        if (!development.location) continue;

        const normalizedLocation = normalizeSearchText(development.location);
        let score = 0;

        for (const token of hintTokens) {
            if (normalizedLocation.includes(token)) {
                score += Math.max(1, token.length);
            }
        }

        if (score <= 0) continue;

        const current = locationScores.get(normalizedLocation);
        if (!current || score > current.score) {
            locationScores.set(normalizedLocation, {
                label: development.location,
                score,
            });
        }
    }

    const bestLocation = [...locationScores.values()]
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.label.localeCompare(right.label, "es", { sensitivity: "base" });
        })[0];

    if (bestLocation) {
        return bestLocation.label;
    }

    const uniqueLocations = [...new Set(
        developments
            .map((development) => development.location?.trim())
            .filter((location): location is string => Boolean(location)),
    )];

    return uniqueLocations.length === 1 ? uniqueLocations[0] : null;
}

function countMatches(source: string, pattern: RegExp) {
    return (source.match(pattern) || []).length;
}

function scoreDecodedCatalogText(source: string) {
    const replacementChars = countMatches(source, /\uFFFD/g);
    const mojibakeHints = countMatches(source, /Ã.|Â.|â€¦|â€œ|â€|â€"|â€™|â€“|â€”/g);
    const controlChars = countMatches(source, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
    const spanishChars = countMatches(source, /[áéíóúÁÉÍÓÚñÑ¿¡]/g);
    const printableChars = countMatches(source, /[A-Za-z0-9áéíóúÁÉÍÓÚñÑ¿¡.,;:()_\-\/"'@\s]/g);

    return (
        printableChars +
        spanishChars * 6 -
        replacementChars * 120 -
        mojibakeHints * 50 -
        controlChars * 120
    );
}

function decodeCatalogCsvBuffer(buffer: Buffer) {
    if (buffer.length === 0) {
        return "";
    }

    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buffer);
    }

    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buffer);
    }

    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(buffer);
    }

    const looksLikeUtf16 =
        buffer.subarray(0, Math.min(buffer.length, 512)).some((byte, index) =>
            index % 2 === 1 ? byte === 0 : false,
        );

    if (looksLikeUtf16) {
        const utf16le = new TextDecoder("utf-16le").decode(buffer);
        const utf16be = new TextDecoder("utf-16be").decode(buffer);
        return scoreDecodedCatalogText(utf16le) >= scoreDecodedCatalogText(utf16be)
            ? utf16le
            : utf16be;
    }

    const utf8 = new TextDecoder("utf-8").decode(buffer);
    const windows1252 = new TextDecoder("windows-1252").decode(buffer);

    return scoreDecodedCatalogText(utf8) >= scoreDecodedCatalogText(windows1252)
        ? utf8
        : windows1252;
}

function parseBooleanCell(value: string | undefined, fallback = true) {
    const normalized = normalizeCell(value).toLowerCase();
    if (!normalized) return fallback;

    if (["1", "true", "si", "sí", "yes", "activo", "activa"].includes(normalized)) {
        return true;
    }

    if (["0", "false", "no", "inactivo", "inactiva"].includes(normalized)) {
        return false;
    }

    return fallback;
}

function parseCsvLine(source: string) {
    const rows: string[][] = [];
    let currentCell = "";
    let currentRow: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (char === "\"") {
            if (inQuotes && nextChar === "\"") {
                currentCell += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && nextChar === "\n") {
                index += 1;
            }
            currentRow.push(currentCell);
            if (currentRow.some((cell) => cell.trim().length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = "";
            continue;
        }

        currentCell += char;
    }

    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
    }

    return rows;
}

function getFirstValue(
    row: Record<string, string>,
    aliases: string[],
) {
    for (const alias of aliases) {
        const value = normalizeCell(row[alias]);
        if (value) return value;
    }
    return "";
}

function isImageColumn(header: string) {
    return /^(imagen|image)(?:_(?:url|\d+|img|\d+_url))?$/.test(header);
}

function isPdfColumn(header: string) {
    return /^(pdf|pdf_url|catalogo_pdf|catalogo_pdf_url|brochure_pdf|brochure_pdf_url)$/.test(header);
}

function isLinkColumn(header: string) {
    return /^(url|landing_url|link|enlace|pagina_url|sitio_url)$/.test(header);
}

function isAffirmative(text: string) {
    return /\b(si|sí|claro|va|ok|sale|manda|mandame|mandamelo|mandalas|mandamelas|envia|envialo|envialas|quiero|compartelo)\b/i.test(text);
}

function wantsOnlyImages(text: string) {
    return /\b(fotos|foto|imagenes|imágenes|imagen)\b/i.test(text);
}

function wantsOnlyPdf(text: string) {
    return /\b(pdf|catalogo|catalogo en pdf|brochure|ficha)\b/i.test(text);
}

function isNegative(text: string) {
    return /\b(no|ahorita no|luego no|despues no|después no|asi esta|así está|con eso)\b/i.test(text);
}

function buildSearchableText(row: {
    development: string;
    location: string | null;
    question: string;
    answer: string;
}) {
    return [
        row.development,
        row.location || "",
        row.question,
        row.answer,
    ]
        .filter(Boolean)
        .join("\n");
}

function buildCatalogExternalId(parts: Array<string | null | undefined>) {
    const normalized = parts
        .filter(Boolean)
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return normalized || `catalog_${Date.now()}`;
}

function dedupeCatalogStrings(values: string[]) {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const value of values) {
        const trimmed = normalizeCell(value);
        if (!trimmed) continue;
        const key = normalizeSearchText(trimmed);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(trimmed);
    }

    return unique;
}

function toAbsoluteCatalogUrl(baseUrl: string, maybeRelativeUrl: string) {
    try {
        return normalizeCatalogPageUrl(new URL(maybeRelativeUrl, baseUrl).toString());
    } catch {
        return null;
    }
}

function isLikelyDecorativeAsset(url: string, hint = "") {
    const normalized = `${url} ${hint}`.toLowerCase();
    return /logo|icon|avatar|favicon|sprite|placeholder|googlemaps|whatsapp|instagram|facebook/.test(normalized);
}

function collectJsonLdNodes(source: unknown, bucket: Array<Record<string, unknown>> = []) {
    if (!source) {
        return bucket;
    }

    if (Array.isArray(source)) {
        for (const item of source) {
            collectJsonLdNodes(item, bucket);
        }
        return bucket;
    }

    if (typeof source === "object") {
        const record = source as Record<string, unknown>;
        bucket.push(record);

        if (record["@graph"]) {
            collectJsonLdNodes(record["@graph"], bucket);
        }
    }

    return bucket;
}

function extractJsonLdImageUrls(
    nodes: Array<Record<string, unknown>>,
    baseUrl: string,
) {
    const urls: string[] = [];
    const pushUrl = (value: unknown) => {
        if (typeof value === "string") {
            const absolute = toAbsoluteCatalogUrl(baseUrl, value);
            if (absolute && !isLikelyDecorativeAsset(absolute)) {
                urls.push(absolute);
            }
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                pushUrl(item);
            }
            return;
        }

        if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;
            pushUrl(record.url);
            pushUrl(record.contentUrl);
            pushUrl(record.embedUrl);
        }
    };

    for (const node of nodes) {
        pushUrl(node.image);
        pushUrl(node.images);
        pushUrl(node.photo);
        pushUrl(node.photos);
        pushUrl(node.associatedMedia);
    }

    return dedupeCatalogStrings(urls).slice(0, MAX_IMPORT_IMAGES);
}

function extractJsonLdLocation(nodes: Array<Record<string, unknown>>) {
    const collectAddress = (value: unknown): string | null => {
        if (typeof value === "string") {
            return normalizeCell(value) || null;
        }

        if (!value || typeof value !== "object") {
            return null;
        }

        const record = value as Record<string, unknown>;
        const parts = [
            record.streetAddress,
            record.addressLocality,
            record.addressRegion,
            record.addressCountry,
        ]
            .map((part) => (typeof part === "string" ? normalizeCell(part) : ""))
            .filter(Boolean);

        if (parts.length > 0) {
            return parts.join(", ");
        }

        return typeof record.name === "string" ? normalizeCell(record.name) || null : null;
    };

    for (const node of nodes) {
        const directAddress = collectAddress(node.address);
        if (directAddress) return directAddress;

        const directLocation = collectAddress(node.location);
        if (directLocation) return directLocation;
    }

    return null;
}

function cleanCatalogPageTitle(title: string) {
    const segments = title
        .split(/\s+[|\-–]\s+/)
        .map((segment) => normalizeCell(segment))
        .filter(Boolean);

    return segments[0] || normalizeCell(title);
}

function extractBodyLocationCandidate(text: string) {
    const lines = normalizeMultilineCatalogText(text)
        .split("\n")
        .map((line) => normalizeCell(line))
        .filter(Boolean);

    return (
        lines.find((line) => /\b\d{3,5}\b/.test(line) && line.includes(",") && line.length <= 180) ||
        null
    );
}

function buildCatalogAssets(params: {
    imageUrls: string[];
    pdfUrl?: string | null;
    linkUrl?: string | null;
}) {
    const assets: CatalogImportRow["assets"] = [];
    const seenUrls = new Set<string>();
    let imageSort = 0;

    for (const url of params.imageUrls) {
        if (!url || seenUrls.has(url) || imageSort >= MAX_IMPORT_IMAGES) continue;
        assets.push({
            type: "image",
            url,
            label: `Imagen ${imageSort + 1}`,
            sortOrder: imageSort,
        });
        seenUrls.add(url);
        imageSort += 1;
    }

    const pdfUrl = normalizeCell(params.pdfUrl || "");
    if (pdfUrl && !seenUrls.has(pdfUrl)) {
        assets.push({
            type: "pdf",
            url: pdfUrl,
            label: "Catalogo PDF",
            sortOrder: 0,
        });
        seenUrls.add(pdfUrl);
    }

    const linkUrl = normalizeCell(params.linkUrl || "");
    if (linkUrl && !seenUrls.has(linkUrl)) {
        assets.push({
            type: "link",
            url: linkUrl,
            label: "Liga del desarrollo",
            sortOrder: 0,
        });
    }

    return assets;
}

function buildCatalogRequestHeaders(options?: CatalogFetchOptions) {
    const normalizedOptions = normalizeCatalogFetchOptions(options);
    const headers = new Headers();
    const isBrowserMode = normalizedOptions.requestMode === "browser";

    headers.set("User-Agent", isBrowserMode ? CATALOG_BROWSER_USER_AGENT : CATALOG_BOT_USER_AGENT);
    headers.set(
        "Accept",
        isBrowserMode
            ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            : "*/*",
    );
    headers.set("Accept-Language", "es-AR,es;q=0.9,es-MX;q=0.8,en;q=0.7");
    headers.set("Cache-Control", "no-cache");

    if (isBrowserMode) {
        headers.set("Pragma", "no-cache");
        headers.set("Upgrade-Insecure-Requests", "1");
    }

    if (normalizedOptions.authorizationHeader) {
        headers.set("Authorization", normalizedOptions.authorizationHeader);
    }

    if (normalizedOptions.cookieHeader) {
        headers.set("Cookie", normalizedOptions.cookieHeader);
    }

    if (normalizedOptions.refererUrl) {
        headers.set("Referer", normalizedOptions.refererUrl);
    }

    return headers;
}

async function fetchCatalogResponse(url: string, options?: CatalogFetchOptions) {
    return fetch(url, {
        headers: buildCatalogRequestHeaders(options),
        cache: "no-store",
    });
}

function buildCatalogFetchErrorMessage(status: number, options?: CatalogFetchOptions, targetUrl?: string) {
    const normalizedOptions = normalizeCatalogFetchOptions(options);
    const normalizedHost = targetUrl ? normalizeCatalogHost(new URL(targetUrl).hostname) : "";

    if (status === 403) {
        if (CLEAN_PATH_PORTALS.has(normalizedHost)) {
            return normalizedOptions.cookieHeader || normalizedOptions.authorizationHeader
                ? "Ese portal devolvio 403 incluso con la sesion proporcionada. Revisa que la cookie siga vigente, copia una nueva desde el navegador o prueba otra URL de origen."
                : "Ese portal bloqueo el acceso directo del servidor. La URL es valida, pero para importarla necesitas una cookie de sesion activa o un header Authorization.";
        }

        return normalizedOptions.cookieHeader || normalizedOptions.authorizationHeader
            ? "La pagina devolvio 403 incluso con la sesion proporcionada. Revisa que la cookie siga vigente o usa otra URL de origen."
            : "La pagina devolvio 403 y no se pudo leer automaticamente. Ese sitio parece bloquear el acceso del servidor; para sitios privados prueba con cookie de sesion o sigue usando la ficha manual.";
    }

    if (status === 401) {
        return "La pagina pidio autenticacion. Prueba con una cookie de sesion valida o con un header Authorization.";
    }

    return `No pude leer la URL (${status}).`;
}

function looksLikeCatalogLoginPage(pageText: string) {
    const normalized = normalizeSearchText(pageText);
    if (!normalized) {
        return false;
    }

    const score = [
        "iniciar sesion",
        "inicia sesion",
        "ingresa tu e mail",
        "email",
        "contrasena",
        "continuar con google",
        "acceder con google",
        "continuar con facebook",
        "continuar con apple",
        "crear una cuenta",
        "ingresar",
        "olvidaste tu contrasena",
        "no estas registrado",
    ].reduce((sum, hint) => sum + (normalized.includes(hint) ? 1 : 0), 0);

    return score >= 2;
}

function normalizeCatalogHost(hostname: string) {
    return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function normalizeCatalogPageUrl(rawUrl: string) {
    try {
        const parsedUrl = new URL(rawUrl);
        const host = normalizeCatalogHost(parsedUrl.hostname);
        const nextParams = new URLSearchParams(parsedUrl.search);

        parsedUrl.hash = "";

        if (CLEAN_PATH_PORTALS.has(host)) {
            parsedUrl.search = "";
            return parsedUrl.toString();
        }

        for (const key of [...nextParams.keys()]) {
            const normalizedKey = key.trim().toLowerCase();
            if (
                TRACKING_QUERY_PARAM_KEYS.has(normalizedKey) ||
                TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
            ) {
                nextParams.delete(key);
            }
        }

        parsedUrl.search = nextParams.toString() ? `?${nextParams.toString()}` : "";
        return parsedUrl.toString();
    } catch {
        return rawUrl;
    }
}

function scoreCatalogCandidateUrl(url: string, label: string, filterText: string) {
    const normalizedUrl = url.toLowerCase();
    const normalizedLabel = normalizeSearchText(label);
    const normalizedFilter = normalizeSearchText(filterText);

    if (!/^https?:\/\//.test(normalizedUrl)) {
        return -1;
    }

    if (/\.(?:avif|css|gif|ico|jpeg|jpg|js|json|pdf|png|svg|txt|webp|xml)(?:[?#]|$)/i.test(normalizedUrl)) {
        return -1;
    }

    if (/\/(auth|ingresar|login|registro|signup|account|cuenta|favorito|favoritos|notificacion|contacto|servicio|nosotros|blog|noticia)(?:[/?#]|$)/i.test(normalizedUrl)) {
        return -1;
    }

    let score = 0;
    if (/\/(propiedades|property|producto|products|catalogo|listing|desarrollo|desarrollos|inmueble|clasificado)(?:[/?#]|$)/i.test(normalizedUrl)) {
        score += 8;
    }
    if (/\.html(?:[?#]|$)/i.test(normalizedUrl)) {
        score += 4;
    }
    if (/--\d{5,}(?:[?#]|$)/i.test(normalizedUrl)) {
        score += 6;
    }
    if (/\b(casa|departamento|depto|oficina|local|galpon|deposito|terreno|lote|ph)\b/i.test(normalizedUrl)) {
        score += 2;
    }
    if (normalizedLabel.length >= 8) {
        score += 1;
    }
    if (normalizedFilter) {
        if (normalizedUrl.includes(normalizedFilter) || normalizedLabel.includes(normalizedFilter)) {
            score += 10;
        } else {
            score -= 1;
        }
    }

    return score;
}

async function extractCatalogCandidateUrlsFromIndex(
    indexUrl: string,
    html: string,
    filterText: string,
) {
    const parsedIndexUrl = new URL(indexUrl);
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const baseHost = normalizeCatalogHost(parsedIndexUrl.hostname);
    const discovered = new Map<string, { url: string; score: number }>();

    $("a[href]").each((_, element) => {
        const elementRef = $(element);
        const href = elementRef.attr("href");
        if (!href) {
            return;
        }

        const absoluteUrl = toAbsoluteCatalogUrl(parsedIndexUrl.toString(), href);
        if (!absoluteUrl) {
            return;
        }

        let parsedCandidateUrl: URL;
        try {
            parsedCandidateUrl = new URL(absoluteUrl);
        } catch {
            return;
        }

        if (normalizeCatalogHost(parsedCandidateUrl.hostname) !== baseHost) {
            return;
        }

        const label = normalizeMultilineCatalogText(elementRef.text());
        const score = scoreCatalogCandidateUrl(absoluteUrl, label, filterText);
        if (score <= 0) {
            return;
        }

        const current = discovered.get(absoluteUrl);
        if (!current || score > current.score) {
            discovered.set(absoluteUrl, {
                url: absoluteUrl,
                score,
            });
        }
    });

    const directPageScore = Math.max(scoreCatalogCandidateUrl(indexUrl, "", filterText), 1);
    if (!discovered.has(indexUrl)) {
        discovered.set(indexUrl, {
            url: indexUrl,
            score: directPageScore,
        });
    }

    return [...discovered.values()]
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.url.localeCompare(right.url, "es", { sensitivity: "base" });
        })
        .map((item) => item.url);
}

function buildCatalogRowFromPreview(preview: CatalogUrlPreview): CatalogImportRow {
    return {
        externalId: normalizeCell(preview.externalId),
        development: normalizeCell(preview.development),
        location: normalizeCell(preview.location || "") || null,
        question: normalizeCell(preview.question),
        answer: normalizeCell(preview.answer),
        searchableText: buildSearchableText({
            development: preview.development,
            location: preview.location,
            question: preview.question,
            answer: preview.answer,
        }),
        isActive: true,
        assets: buildCatalogAssets({
            imageUrls: preview.imageUrls,
            pdfUrl: preview.pdfUrl,
            linkUrl: preview.linkUrl,
        }),
    };
}

export async function previewCatalogEntryFromUrl(
    url: string,
    options?: CatalogFetchOptions,
): Promise<CatalogUrlPreview> {
    const normalizedUrl = normalizeCatalogPageUrl(normalizeCell(url));
    if (!normalizedUrl) {
        throw new Error("Necesitas escribir una URL para autocompletar la ficha.");
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(normalizedUrl);
    } catch {
        throw new Error("La URL de la ficha no es valida.");
    }

    const response = await fetchCatalogResponse(parsedUrl.toString(), options);

    if (!response.ok) {
        throw new Error(buildCatalogFetchErrorMessage(response.status, options, parsedUrl.toString()));
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
        throw new Error("La URL no devolvio una pagina HTML compatible para autocompletar la ficha.");
    }

    const html = await response.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    $("script:not([type='application/ld+json']), style, noscript, iframe, svg").remove();

    if (looksLikeCatalogLoginPage($("body").text().trim())) {
        throw new Error(
            "La URL devolvio una pantalla de login en lugar de la ficha. Abre el sitio en tu navegador, copia una cookie de sesion activa y vuelve a intentarlo desde el importador protegido.",
        );
    }

    const jsonLdNodes = $("script[type='application/ld+json']")
        .map((_, element) => $(element).text())
        .get()
        .flatMap((raw) => {
            try {
                return collectJsonLdNodes(JSON.parse(raw));
            } catch {
                return [];
            }
        });

    const rawTitle =
        $('meta[property="og:title"]').attr("content")?.trim() ||
        $("h1").first().text().trim() ||
        $("title").first().text().trim() ||
        "";
    const jsonLdName =
        jsonLdNodes.find((node) => typeof node.name === "string")?.name as string | undefined;
    const development = cleanCatalogPageTitle(jsonLdName || rawTitle || parsedUrl.pathname.split("/").pop() || "Ficha web");

    const rawDescription =
        $('meta[property="og:description"]').attr("content")?.trim() ||
        $('meta[name="description"]').attr("content")?.trim() ||
        (jsonLdNodes.find((node) => typeof node.description === "string")?.description as string | undefined) ||
        "";

    const paragraphCandidates = dedupeCatalogStrings(
        $("main p, article p, section p, main li, article li, section li")
            .map((_, element) => $(element).text())
            .get()
            .map((value) => normalizeMultilineCatalogText(value))
            .filter((value) => value.length >= 25 && value.length <= 260)
            .filter((value) => !/\bleer mas\b|\bagotado\b/i.test(normalizeSearchText(value))),
    );

    const description = rawDescription || paragraphCandidates[0] || "";
    const highlights = paragraphCandidates
        .filter((item) => normalizeSearchText(item) !== normalizeSearchText(description))
        .slice(0, 10);

    const htmlImages = dedupeCatalogStrings(
        $("main img[src], article img[src], img[src]")
            .map((_, element) => {
                const elementRef = $(element);
                const src = elementRef.attr("src") || elementRef.attr("data-src") || "";
                const alt = elementRef.attr("alt") || "";
                const className = elementRef.attr("class") || "";
                const absolute = src ? toAbsoluteCatalogUrl(parsedUrl.toString(), src) : null;
                if (!absolute || isLikelyDecorativeAsset(absolute, `${alt} ${className}`)) {
                    return "";
                }
                return absolute;
            })
            .get()
            .filter(Boolean),
    );

    const imageUrls = dedupeCatalogStrings([
        ...extractJsonLdImageUrls(jsonLdNodes, parsedUrl.toString()),
        ...htmlImages,
    ]).slice(0, MAX_IMPORT_IMAGES);

    const pdfUrl = (() => {
        const href = $("a[href$='.pdf'], a[href*='.pdf?']").first().attr("href");
        if (!href) return null;
        return toAbsoluteCatalogUrl(parsedUrl.toString(), href);
    })();

    const location =
        extractJsonLdLocation(jsonLdNodes) ||
        extractBodyLocationCandidate(
            $("main").first().text().trim() || $("article").first().text().trim() || $("body").text().trim(),
        ) ||
        null;

    const answer = normalizeMultilineCatalogText(
        [
            description,
            highlights.length > 0
                ? ["Datos destacados:", ...highlights.map((item) => `- ${item}`)].join("\n")
                : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
    );

    if (!development || !answer) {
        throw new Error("No encontre suficiente informacion util para autocompletar la ficha desde esa URL.");
    }

    const subject = location || development;
    return {
        externalId: buildCatalogExternalId([
            parsedUrl.pathname.split("/").filter(Boolean).pop()?.replace(/\.[a-z0-9]+$/i, ""),
            development,
        ]),
        development,
        location,
        question: `Que informacion tienes de ${subject}?`,
        answer,
        imageUrls,
        pdfUrl,
        linkUrl: parsedUrl.toString(),
    };
}

function mapCsvRows(source: string) {
    const rawRows = parseCsvLine(source);
    if (rawRows.length < 2) {
        throw new Error("El CSV no trae suficientes filas para importar.");
    }

    const rawHeaders = rawRows[0].map((header) => normalizeHeader(header));
    const dataRows = rawRows.slice(1);

    return dataRows
        .map((cells, rowIndex) => {
            const row = rawHeaders.reduce<Record<string, string>>((accumulator, header, cellIndex) => {
                accumulator[header] = cells[cellIndex] || "";
                return accumulator;
            }, {});

            const externalId =
                getFirstValue(row, ["id", "external_id", "externalid"]) ||
                `catalog_${rowIndex + 1}`;
            const development = getFirstValue(row, ["desarrollo", "desarrollo_nombre", "development", "proyecto"]);
            const location = getFirstValue(row, ["ubicacion", "ubicacion_texto", "location"]) || null;
            const question = getFirstValue(row, ["pregunta", "question"]);
            const answer = getFirstValue(row, ["contenido", "respuesta", "answer", "content"]);
            const isActive = parseBooleanCell(
                row.activo || row.active || row.is_active || row.estado,
                true,
            );

            if (!development || !question || !answer) {
                return null;
            }

            const imageUrls = rawHeaders
                .filter((header) => isImageColumn(header))
                .map((header) => normalizeCell(row[header]))
                .filter(Boolean);
            const pdfUrl = rawHeaders
                .filter((header) => isPdfColumn(header))
                .map((header) => normalizeCell(row[header]))
                .find(Boolean);
            const linkUrl = rawHeaders
                .filter((header) => isLinkColumn(header))
                .map((header) => normalizeCell(row[header]))
                .find(Boolean);
            const assets = buildCatalogAssets({
                imageUrls,
                pdfUrl,
                linkUrl,
            });

            const record = {
                externalId,
                development,
                location,
                question,
                answer,
                searchableText: buildSearchableText({
                    development,
                    location,
                    question,
                    answer,
                }),
                isActive,
                assets,
            } satisfies CatalogImportRow;

            return record;
        })
        .filter((row): row is CatalogImportRow => Boolean(row));
}

function deduplicateImportRows(rows: CatalogImportRow[]): DeduplicatedCatalogRowsResult {
    const byExternalId = new Map<string, CatalogImportRow>();
    const duplicateExternalIds = new Set<string>();

    for (const row of rows) {
        if (byExternalId.has(row.externalId)) {
            duplicateExternalIds.add(row.externalId);
        }
        byExternalId.set(row.externalId, row);
    }

    return {
        rows: [...byExternalId.values()],
        duplicateExternalIds: [...duplicateExternalIds.values()],
    };
}

type UpsertCatalogRowsOptions = {
    replaceMissing: boolean;
};

async function upsertCatalogRows(
    rows: CatalogImportRow[],
    options: UpsertCatalogRowsOptions,
) {
    let embeddings: number[][] = [];
    try {
        embeddings = await generateEmbeddings(rows.map((row) => row.searchableText.slice(0, 8000)));
    } catch (error) {
        console.warn("[Catalog] Import continuing without embeddings", error);
    }

    await prisma.$transaction(async (tx) => {
        const existingItems = await tx.catalogItem.findMany({
            select: {
                id: true,
                externalId: true,
            },
        });

        const existingByExternalId = new Map(
            existingItems.map((item) => [item.externalId, item]),
        );
        const incomingExternalIds = new Set(rows.map((row) => row.externalId));
        const staleItemIds = options.replaceMissing
            ? existingItems
                .filter((item) => !incomingExternalIds.has(item.externalId))
                .map((item) => item.id)
            : [];
        const touchedExistingIds = rows
            .map((row) => existingByExternalId.get(row.externalId)?.id || null)
            .filter((itemId): itemId is string => Boolean(itemId));

        const stateResetItemIds = [...new Set([...staleItemIds, ...touchedExistingIds])];
        if (stateResetItemIds.length > 0) {
            await tx.catalogConversationState.deleteMany({
                where: {
                    catalogItemId: {
                        in: stateResetItemIds,
                    },
                },
            });
        }

        if (staleItemIds.length > 0) {
            await tx.catalogAsset.deleteMany({
                where: {
                    itemId: {
                        in: staleItemIds,
                    },
                },
            });

            await tx.catalogItem.deleteMany({
                where: {
                    id: {
                        in: staleItemIds,
                    },
                },
            });
        }

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const existingItem = existingByExternalId.get(row.externalId);

            if (existingItem) {
                await tx.catalogAsset.deleteMany({
                    where: {
                        itemId: existingItem.id,
                    },
                });
            }

            const item = existingItem
                ? await tx.catalogItem.update({
                    where: { id: existingItem.id },
                    data: {
                        development: row.development,
                        location: row.location,
                        question: row.question,
                        answer: row.answer,
                        searchableText: row.searchableText,
                        isActive: row.isActive,
                        assets: {
                            create: row.assets.map((asset) => ({
                                type: asset.type,
                                url: asset.url,
                                label: asset.label || null,
                                sortOrder: asset.sortOrder,
                            })),
                        },
                    },
                })
                : await tx.catalogItem.create({
                    data: {
                        externalId: row.externalId,
                        development: row.development,
                        location: row.location,
                        question: row.question,
                        answer: row.answer,
                        searchableText: row.searchableText,
                        isActive: row.isActive,
                        assets: {
                            create: row.assets.map((asset) => ({
                                type: asset.type,
                                url: asset.url,
                                label: asset.label || null,
                                sortOrder: asset.sortOrder,
                            })),
                        },
                    },
                });

            if (embeddings[index]?.length) {
                const vectorLiteral = `[${embeddings[index].join(",")}]`;
                await tx.$executeRaw`
                    UPDATE "CatalogItem"
                    SET embedding = ${vectorLiteral}::vector
                    WHERE id = ${item.id}
                `;
            } else {
                await tx.$executeRaw`
                    UPDATE "CatalogItem"
                    SET embedding = NULL
                    WHERE id = ${item.id}
                `;
            }
        }
    });

    return {
        importedCount: rows.length,
        assetCount: rows.reduce((sum, row) => sum + row.assets.length, 0),
    };
}

export async function importCatalogEntriesFromIndex(
    input: CatalogBulkImportInput,
): Promise<CatalogBulkImportResult> {
    const indexUrl = normalizeCatalogPageUrl(normalizeCell(input.indexUrl));
    if (!indexUrl) {
        throw new Error("Necesitas pegar una URL de listado o cuenta para importar varias fichas.");
    }

    let parsedIndexUrl: URL;
    try {
        parsedIndexUrl = new URL(indexUrl);
    } catch {
        throw new Error("La URL de origen no es valida.");
    }

    const fetchOptions = normalizeCatalogFetchOptions({
        requestMode: input.requestMode || "browser",
        authorizationHeader: input.authorizationHeader,
        cookieHeader: input.cookieHeader,
        refererUrl: input.refererUrl || parsedIndexUrl.origin,
    });
    const maxItems = clampCatalogInteger(
        input.maxItems,
        DEFAULT_CATALOG_BULK_IMPORT_ITEMS,
        1,
        MAX_CATALOG_BULK_IMPORT_ITEMS,
    );
    const response = await fetchCatalogResponse(parsedIndexUrl.toString(), fetchOptions);

    if (!response.ok) {
        throw new Error(buildCatalogFetchErrorMessage(response.status, fetchOptions, parsedIndexUrl.toString()));
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
        throw new Error("La URL de origen no devolvio HTML, asi que no pude descubrir fichas desde ahi.");
    }

    const html = await response.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const pageText = $("body").text().trim();

    if (looksLikeCatalogLoginPage(pageText)) {
        throw new Error(
            "La URL de origen devolvio una pantalla de login. Abre el sitio en tu navegador, copia una cookie de sesion activa y vuelve a importar desde aqui.",
        );
    }

    const discoveredUrls = (await extractCatalogCandidateUrlsFromIndex(
        parsedIndexUrl.toString(),
        html,
        normalizeCell(input.urlFilterText || ""),
    )).slice(0, maxItems);

    if (discoveredUrls.length === 0) {
        throw new Error(
            "No encontre ligas de fichas dentro de esa pagina. Revisa la URL de origen, el filtro opcional o la sesion usada para abrirla.",
        );
    }

    const previews: CatalogUrlPreview[] = [];
    const failedUrls: string[] = [];

    for (const discoveredUrl of discoveredUrls) {
        try {
            const preview = await previewCatalogEntryFromUrl(discoveredUrl, fetchOptions);
            previews.push(preview);
        } catch (error) {
            console.warn("[Catalog] Failed to import entry from discovered URL", {
                url: discoveredUrl,
                error,
            });
            failedUrls.push(discoveredUrl);
        }
    }

    if (previews.length === 0) {
        throw new Error(
            "No pude convertir ninguna ficha descubierta. Si el portal pide login o anti-bot, usa una cookie de sesion mas reciente o carga manual/CSV.",
        );
    }

    const { rows, duplicateExternalIds } = deduplicateImportRows(
        previews.map((preview) => buildCatalogRowFromPreview(preview)),
    );
    const result = await upsertCatalogRows(rows, { replaceMissing: false });

    return {
        ...result,
        discoveredCount: discoveredUrls.length,
        processedCount: rows.length,
        failedCount: failedUrls.length,
        duplicateCount: duplicateExternalIds.length,
        failedUrls,
    };
}

export async function importCatalogCsv(buffer: Buffer) {
    const source = decodeCatalogCsvBuffer(buffer);
    const mappedRows = mapCsvRows(source);
    const { rows, duplicateExternalIds } = deduplicateImportRows(mappedRows);

    if (rows.length === 0) {
        throw new Error("No encontre filas validas en el CSV del catalogo.");
    }

    const result = await upsertCatalogRows(rows, { replaceMissing: true });

    return {
        ...result,
        duplicateCount: duplicateExternalIds.length,
    };
}

export async function upsertCatalogEntry(input: CatalogManualEntryInput) {
    const development = normalizeCell(input.development);
    const question = normalizeCell(input.question);
    const answer = normalizeCell(input.answer);
    const location = normalizeCell(input.location || "") || null;

    if (!development || !question || !answer) {
        throw new Error("La ficha manual necesita desarrollo, pregunta y contenido.");
    }

    const row: CatalogImportRow = {
        externalId:
            normalizeCell(input.externalId || "") ||
            buildCatalogExternalId([development, location, question]),
        development,
        location,
        question,
        answer,
        searchableText: buildSearchableText({
            development,
            location,
            question,
            answer,
        }),
        isActive: input.isActive ?? true,
        assets: buildCatalogAssets({
            imageUrls: sanitizeUrlList(input.imageUrls),
            pdfUrl: input.pdfUrl,
            linkUrl: input.linkUrl,
        }),
    };

    return upsertCatalogRows([row], { replaceMissing: false });
}

export async function getCatalogItems() {
    return prisma.catalogItem.findMany({
        orderBy: [
            { development: "asc" },
            { question: "asc" },
        ],
        include: {
            assets: {
                orderBy: [
                    { type: "asc" },
                    { sortOrder: "asc" },
                ],
            },
        },
        take: 250,
    });
}

export async function clearCatalogItems() {
    await prisma.$transaction(async (tx) => {
        await tx.catalogConversationState.deleteMany();
        await tx.catalogAsset.deleteMany();
        await tx.catalogItem.deleteMany();
    });
}

async function vectorSearchCatalog(query: string) {
    const embedding = await generateEmbedding(query);
    const vectorQuery = `[${embedding.join(",")}]`;

    return prisma.$queryRaw<CatalogSearchResult[]>`
        SELECT
            ci.id,
            ci."externalId",
            ci.development,
            ci.location,
            ci.question,
            ci.answer,
            ci."searchableText",
            1 - (ci.embedding <=> ${vectorQuery}::vector) AS similarity
        FROM "CatalogItem" ci
        WHERE ci."isActive" = true
          AND ci.embedding IS NOT NULL
        ORDER BY ci.embedding <=> ${vectorQuery}::vector
        LIMIT ${MAX_CATALOG_MATCHES}
    `;
}

async function lexicalCatalogSearch(query: string) {
    const rows = await prisma.catalogItem.findMany({
        where: { isActive: true },
        select: {
            id: true,
            development: true,
            location: true,
            question: true,
            answer: true,
            searchableText: true,
        },
        take: 400,
    });

    const ranked = rows
        .map((row) => ({
            id: row.id,
            score: scoreCatalogTextMatch(row, query),
        }))
        .filter((row) => row.score >= 28)
        .sort((left, right) => right.score - left.score);

    return ranked[0] || null;
}

async function getCatalogItemWithAssets(id: string) {
    return prisma.catalogItem.findUnique({
        where: { id },
        include: {
            assets: {
                orderBy: [
                    { type: "asc" },
                    { sortOrder: "asc" },
                ],
            },
        },
    });
}

export async function getCatalogDevelopmentContext(
    itemId: string,
    maxEntries = 6,
    query?: string,
): Promise<CatalogDevelopmentContext | null> {
    const baseItem = await prisma.catalogItem.findUnique({
        where: { id: itemId },
        select: {
            id: true,
            development: true,
            location: true,
        },
    });

    if (!baseItem) {
        return null;
    }

    const relatedItems = await prisma.catalogItem.findMany({
        where: {
            isActive: true,
            development: {
                equals: baseItem.development,
                mode: "insensitive",
            },
        },
        select: {
            id: true,
            question: true,
            answer: true,
            location: true,
        },
        take: 24,
    });

    const orderedItems = relatedItems.sort((left, right) => {
        const leftScore = (left.id === itemId ? 40 : 0) + (query ? scoreCatalogTextMatch({
            development: baseItem.development,
            location: left.location,
            question: left.question,
            answer: left.answer,
            searchableText: [baseItem.development, left.location || "", left.question, left.answer]
                .filter(Boolean)
                .join("\n"),
        }, query) : 0);
        const rightScore = (right.id === itemId ? 40 : 0) + (query ? scoreCatalogTextMatch({
            development: baseItem.development,
            location: right.location,
            question: right.question,
            answer: right.answer,
            searchableText: [baseItem.development, right.location || "", right.question, right.answer]
                .filter(Boolean)
                .join("\n"),
        }, query) : 0);

        if (rightScore !== leftScore) {
            return rightScore - leftScore;
        }

        if (left.id === itemId) return -1;
        if (right.id === itemId) return 1;
        return left.question.localeCompare(right.question, "es", { sensitivity: "base" });
    });

    const seenQuestions = new Set<string>();
    const entries = orderedItems
        .filter((item) => item.question.trim() && item.answer.trim())
        .filter((item) => {
            const normalizedQuestion = normalizeSearchText(item.question);
            if (!normalizedQuestion || seenQuestions.has(normalizedQuestion)) {
                return false;
            }

            seenQuestions.add(normalizedQuestion);
            return true;
        })
        .slice(0, Math.max(1, maxEntries))
        .map((item) => ({
            question: item.question,
            answer: item.answer,
        }));

    const preferredLocation =
        resolveAvailabilityLocationHint(
            tokenizeCatalogQuery(baseItem.location || ""),
            relatedItems.map((item) => ({
                development: baseItem.development,
                location: item.location,
            })),
        ) || baseItem.location || relatedItems.find((item) => item.location)?.location || null;

    return {
        development: baseItem.development,
        location: preferredLocation,
        entries,
    };
}

export async function findBestCatalogItem(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return null;

    let candidates: CatalogSearchResult[] = [];

    try {
        candidates = await vectorSearchCatalog(normalizedQuery);
    } catch (error) {
        console.warn("[Catalog] Falling back to keyword search", error);
    }

    const lexicalMatch = await lexicalCatalogSearch(normalizedQuery);

    if (candidates.length === 0) {
        if (!lexicalMatch) {
            return null;
        }

        return getCatalogItemWithAssets(lexicalMatch.id);
    }

    const bestCandidate = candidates[0];
    const loweredQuery = normalizeSearchText(normalizedQuery);
    const developmentMentioned = loweredQuery.includes(
        normalizeSearchText(bestCandidate.development),
    );

    if (developmentMentioned || bestCandidate.similarity >= MIN_VECTOR_SIMILARITY) {
        return getCatalogItemWithAssets(bestCandidate.id);
    }

    if (lexicalMatch) {
        return getCatalogItemWithAssets(lexicalMatch.id);
    }

    return null;
}

export async function findBestCatalogItemInDevelopment(
    development: string,
    query: string,
) {
    const normalizedDevelopment = development.trim();
    const normalizedQuery = query.trim();
    if (!normalizedDevelopment || !normalizedQuery) {
        return null;
    }

    const rows = await prisma.catalogItem.findMany({
        where: {
            isActive: true,
            development: {
                equals: normalizedDevelopment,
                mode: "insensitive",
            },
        },
        select: {
            id: true,
            development: true,
            location: true,
            question: true,
            answer: true,
            searchableText: true,
        },
        take: 80,
    });

    const ranked = rows
        .map((row) => ({
            id: row.id,
            score: scoreCatalogTextMatch(row, normalizedQuery),
        }))
        .filter((row) => row.score >= 18)
        .sort((left, right) => right.score - left.score);

    if (ranked.length === 0) {
        return null;
    }

    return getCatalogItemWithAssets(ranked[0].id);
}

export async function findCatalogAvailabilitySummary(query: string): Promise<CatalogAvailabilitySummary | null> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !isGenericAvailabilityQuery(normalizedQuery)) {
        return null;
    }

    const specificLocationHint = extractSpecificLocationHint(normalizedQuery);
    const hintTokens = extractAvailabilityHintTokens(normalizedQuery);
    const items = await prisma.catalogItem.findMany({
        where: { isActive: true },
        select: {
            development: true,
            location: true,
            searchableText: true,
        },
        take: 500,
    });

    const grouped = new Map<string, { development: string; location: string | null; score: number }>();

    for (const item of items) {
        const key = `${normalizeSearchText(item.development)}::${normalizeSearchText(item.location)}`;
        const haystack = normalizeSearchText(
            [item.development, item.location || "", item.searchableText].filter(Boolean).join(" "),
        );
        const normalizedLocation = normalizeSearchText(item.location);
        const normalizedDevelopment = normalizeSearchText(item.development);

        let score = 0;
        let matchedLocationOrDevelopmentTokens = 0;
        if (hintTokens.length > 0) {
            if (specificLocationHint) {
                for (const token of hintTokens) {
                    let matchedToken = false;

                    if (normalizedLocation.includes(token)) {
                        score += 36;
                        matchedToken = true;
                    }
                    if (normalizedDevelopment.includes(token)) {
                        score += 16;
                        matchedToken = true;
                    }

                    if (matchedToken) {
                        matchedLocationOrDevelopmentTokens += 1;
                    }
                }

                if (normalizedLocation.includes(specificLocationHint.normalized)) {
                    score += 140;
                }
                if (normalizedDevelopment.includes(specificLocationHint.normalized)) {
                    score += 80;
                }

                const minimumStrictMatches = specificLocationHint.tokens.length >= 2 ? 2 : 1;
                if (matchedLocationOrDevelopmentTokens < minimumStrictMatches) {
                    continue;
                }
            } else {
                for (const token of hintTokens) {
                    let matchedToken = false;

                    if (normalizedLocation.includes(token)) {
                        score += 28;
                        matchedToken = true;
                    }
                    if (normalizedDevelopment.includes(token)) {
                        score += 20;
                        matchedToken = true;
                    }
                    if (matchedToken) {
                        matchedLocationOrDevelopmentTokens += 1;
                    }
                    if (haystack.includes(token)) {
                        score += 6;
                    }
                }
            }
        } else {
            score = 10;
        }

        if (hintTokens.length > 0 && (score === 0 || matchedLocationOrDevelopmentTokens === 0)) {
            continue;
        }

        const current = grouped.get(key);
        if (!current || score > current.score) {
            grouped.set(key, {
                development: item.development,
                location: item.location,
                score,
            });
        }
    }

    const developments = [...grouped.values()]
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.development.localeCompare(right.development, "es", { sensitivity: "base" });
        })
        .slice(0, MAX_AVAILABILITY_SUMMARY_ITEMS)
        .map((item) => ({
            development: item.development,
            location: item.location,
        }));

    if (developments.length === 0) {
        if (specificLocationHint) {
            return {
                locationHint: specificLocationHint.raw,
                requestedLocation: specificLocationHint.raw,
                noDirectMatches: true,
                developments: [],
            };
        }

        return null;
    }

    return {
        locationHint: resolveAvailabilityLocationHint(hintTokens, developments),
        requestedLocation: specificLocationHint?.raw || null,
        noDirectMatches: false,
        developments,
    };
}

export function splitCatalogAssets(
    assets: Array<{ type: string; url: string; label: string | null; sortOrder: number }>,
    maxImagesToSend: number,
) {
    const imageAssets = assets
        .filter((asset) => asset.type === "image")
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .slice(0, Math.max(0, Math.min(maxImagesToSend, 10)));
    const pdfAsset = assets.find((asset) => asset.type === "pdf") || null;
    const linkAsset = assets.find((asset) => asset.type === "link") || null;

    return { imageAssets, pdfAsset, linkAsset };
}

export function parseCatalogAssetIntent(text: string) {
    const normalized = text.trim();

    return {
        affirmative: isAffirmative(normalized),
        negative: isNegative(normalized),
        wantsImages: wantsOnlyImages(normalized),
        wantsPdf: wantsOnlyPdf(normalized),
    };
}
