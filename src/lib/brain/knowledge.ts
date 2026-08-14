import { createRequire } from "node:module";
import { prisma } from "@/lib/db";
import {
    extractTextFromImageBufferWithFallback,
    generateEmbedding,
    generateEmbeddings,
    transcribeAudioBuffer,
} from "@/lib/ai/openai";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

class SimpleDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    toString() {
        return "matrix(1, 0, 0, 1, 0, 0)";
    }
}

function ensurePdfPolyfills() {
    if (!Reflect.get(globalThis, "DOMMatrix")) {
        Reflect.set(globalThis, "DOMMatrix", SimpleDOMMatrix);
    }
}

const TEXT_FILE_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".rb",
    ".go",
    ".java",
    ".php",
    ".html",
    ".css",
    ".scss",
    ".xml",
    ".yml",
    ".yaml",
    ".sh",
    ".env",
]);

const DEFAULT_CRAWL_DEPTH = 2;
const DEFAULT_CRAWL_PAGES = 24;
const DEFAULT_SITEMAP_PAGES = 60;
const MAX_CRAWL_DEPTH = 5;
const MAX_CRAWL_PAGES = 80;
const MAX_SITEMAP_PAGES = 160;
const MAX_GITHUB_FILES = 60;
const MAX_SOURCE_CHARS = 180_000;
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;
const BOT_USER_AGENT = "ZenCRMBot/1.0 (+https://zen-crm.local)";
const BROWSER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const MAX_PDF_OCR_PAGES = 6;
const PDF_OCR_RENDER_WIDTH = 1200;
const nodeRequire = createRequire(`${process.cwd()}/package.json`);

type SourceDocument = {
    title: string;
    content: string;
    sourceUri?: string;
    metadata?: Record<string, unknown>;
};

type SourceInput = {
    type: string;
    title: string;
    sourceUri?: string | null;
    rawContent?: string | null;
    mimeType?: string | null;
    metadata?: Record<string, unknown>;
    fileName?: string | null;
    fileBuffer?: Buffer | null;
};

type SourceFetchMetadata = {
    requestMode?: "standard" | "browser";
    authorizationHeader?: string;
    cookieHeader?: string;
    refererUrl?: string;
    crawlMaxDepth?: number;
    crawlMaxPages?: number;
    sitemapMaxPages?: number;
};

type SitemapEntry = {
    loc?: string;
};

type GithubRepoResponse = {
    default_branch?: string;
};

type GithubTreeEntry = {
    type?: string;
    path?: string;
};

type GithubTreeResponse = {
    tree?: GithubTreeEntry[];
};

type RetrievedChunk = {
    id: string;
    content: string;
    title: string | null;
    similarity: number;
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
    sourceUri: string | null;
};

type PdfParseConstructor = new (options: { data: Buffer }) => {
    getText: () => Promise<{ text?: string }>;
    getInfo: (params?: { parsePageInfo?: boolean }) => Promise<{ total: number }>;
    getScreenshot: (params?: {
        first?: number;
        imageBuffer?: boolean;
        imageDataUrl?: boolean;
        desiredWidth?: number;
    }) => Promise<{ pages: Array<{ pageNumber: number; data: Uint8Array }> }>;
    destroy: () => Promise<void>;
};

function normalizeWhitespace(text: string) {
    return text
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\u0000/g, "")
        .trim();
}

function trimContent(text: string) {
    const normalized = normalizeWhitespace(text);
    return normalized.length > MAX_SOURCE_CHARS
        ? normalized.slice(0, MAX_SOURCE_CHARS)
        : normalized;
}

function stripPdfPageArtifacts(text: string) {
    return text
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function hasMeaningfulPdfText(text: string) {
    const normalized = stripPdfPageArtifacts(text);
    if (normalized.length < 40) {
        return false;
    }

    const wordMatches = normalized.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]{3,}/g) || [];
    return wordMatches.length >= 6;
}

function describePdfOcrFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    const normalized = message.toLowerCase();

    if (
        normalized.includes("api key not configured") ||
        normalized.includes("systemsettings.findfirst") ||
        normalized.includes("econnrefused") ||
        normalized.includes("resolveaiproviderkey") ||
        normalized.includes("gemini api error") ||
        normalized.includes("openai")
    ) {
        return "El PDF parece estar escaneado y para leerlo necesito OCR activo. Revisa las claves de OpenAI o Gemini en Configuracion > IA y vuelve a intentarlo.";
    }

    return "El PDF no trae texto seleccionable y no pude completar el OCR de forma segura.";
}

function asMetadataRecord(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }

    return metadata as Record<string, unknown>;
}

function sanitizeOptionalString(value: unknown) {
    return typeof value === "string" ? value.trim() || undefined : undefined;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string"
                ? Number.parseInt(value, 10)
                : Number.NaN;

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseSourceFetchMetadata(metadata: unknown): SourceFetchMetadata {
    const record = asMetadataRecord(metadata);
    return {
        requestMode: record.requestMode === "browser" ? "browser" : "standard",
        authorizationHeader: sanitizeOptionalString(record.authorizationHeader),
        cookieHeader: sanitizeOptionalString(record.cookieHeader),
        refererUrl: sanitizeOptionalString(record.refererUrl),
        crawlMaxDepth: clampInteger(record.crawlMaxDepth, DEFAULT_CRAWL_DEPTH, 0, MAX_CRAWL_DEPTH),
        crawlMaxPages: clampInteger(record.crawlMaxPages, DEFAULT_CRAWL_PAGES, 1, MAX_CRAWL_PAGES),
        sitemapMaxPages: clampInteger(record.sitemapMaxPages, DEFAULT_SITEMAP_PAGES, 1, MAX_SITEMAP_PAGES),
    };
}

function estimateTokenCount(text: string) {
    return Math.max(1, Math.ceil(text.length / 4));
}

function splitIntoChunks(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
    const normalized = trimContent(text);
    if (!normalized) return [];

    const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        const next = current ? `${current}\n\n${paragraph}` : paragraph;

        if (next.length <= chunkSize) {
            current = next;
            continue;
        }

        if (current) {
            chunks.push(current.trim());
        }

        if (paragraph.length <= chunkSize) {
            current = paragraph;
            continue;
        }

        let start = 0;
        while (start < paragraph.length) {
            const slice = paragraph.slice(start, start + chunkSize).trim();
            if (slice) chunks.push(slice);
            start += Math.max(1, chunkSize - overlap);
        }

        current = "";
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

function getExtension(name: string) {
    const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
    return match?.[0] || "";
}

function toAbsoluteUrl(baseUrl: string, maybeRelativeUrl: string) {
    try {
        return new URL(maybeRelativeUrl, baseUrl).toString();
    } catch {
        return null;
    }
}

function buildSourceRequestHeaders(metadata?: SourceFetchMetadata) {
    const headers = new Headers();
    const requestMode = metadata?.requestMode === "browser" ? "browser" : "standard";

    headers.set("User-Agent", requestMode === "browser" ? BROWSER_USER_AGENT : BOT_USER_AGENT);
    headers.set(
        "Accept",
        requestMode === "browser"
            ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            : "*/*",
    );
    headers.set("Accept-Language", "es-MX,es;q=0.9,en;q=0.8");
    headers.set("Cache-Control", "no-cache");

    if (requestMode === "browser") {
        headers.set("Pragma", "no-cache");
        headers.set("Upgrade-Insecure-Requests", "1");
    }

    if (metadata?.refererUrl) {
        headers.set("Referer", metadata.refererUrl);
    }

    if (metadata?.authorizationHeader) {
        headers.set("Authorization", metadata.authorizationHeader);
    }

    if (metadata?.cookieHeader) {
        headers.set("Cookie", metadata.cookieHeader);
    }

    return headers;
}

async function fetchSourceResponse(url: string, metadata?: SourceFetchMetadata) {
    return fetch(url, {
        headers: buildSourceRequestHeaders(metadata),
        cache: "no-store",
    });
}

async function loadPdfParseConstructor(): Promise<PdfParseConstructor> {
    const pdfParseModule = nodeRequire("pdf-parse");
    const PDFParse =
        pdfParseModule.PDFParse ||
        pdfParseModule.default?.PDFParse ||
        pdfParseModule.default;

    if (typeof PDFParse !== "function") {
        throw new Error("No pude inicializar el lector de PDF.");
    }

    return PDFParse as PdfParseConstructor;
}

async function extractPdfViaOcr(
    parser: InstanceType<PdfParseConstructor>,
    totalPagesHint?: number,
) {
    const totalPages = Math.max(1, Math.min(totalPagesHint || 1, MAX_PDF_OCR_PAGES));
    const screenshots = await parser.getScreenshot({
        first: totalPages,
        imageBuffer: true,
        imageDataUrl: false,
        desiredWidth: PDF_OCR_RENDER_WIDTH,
    });

    const pageTexts: string[] = [];
    const ocrErrors: string[] = [];

    for (const page of screenshots.pages) {
        try {
            const ocrText = await extractTextFromImageBufferWithFallback(
                Buffer.from(page.data),
                "image/png",
                [
                    `Esta es la pagina ${page.pageNumber} de un documento PDF.`,
                    "Extrae en espanol todo el texto visible y util.",
                    "Conserva encabezados, precio, ubicacion, caracteristicas, descripcion, datos de contacto y listas.",
                    "No inventes texto faltante. Si algo no se lee bien, deja fuera lo ilegible.",
                    "Devuelve solo el contenido extraido, limpio y listo para indexarse.",
                ].join(" "),
            );

            const cleanedText = trimContent(ocrText);
            if (cleanedText) {
                pageTexts.push(`[PAGINA ${page.pageNumber}]\n${cleanedText}`);
            }
        } catch (error) {
            ocrErrors.push(describePdfOcrFailure(error));
        }
    }

    if (pageTexts.length === 0 && ocrErrors.length > 0) {
        throw new Error(ocrErrors[0]);
    }

    return trimContent(pageTexts.join("\n\n"));
}

async function extractPdf(buffer: Buffer) {
    ensurePdfPolyfills();
    const PDFParse = await loadPdfParseConstructor();
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        const extractedText = trimContent(result.text || "");

        if (hasMeaningfulPdfText(extractedText)) {
            return extractedText;
        }

        let totalPagesHint = 1;
        try {
            const info = await parser.getInfo({ parsePageInfo: false });
            totalPagesHint = info.total || 1;
        } catch {
            // Best effort only.
        }

        let ocrText = "";
        try {
            ocrText = await extractPdfViaOcr(parser, totalPagesHint);
        } catch (error) {
            throw new Error(describePdfOcrFailure(error));
        }

        if (hasMeaningfulPdfText(ocrText)) {
            return ocrText;
        }

        throw new Error(
            "El PDF no trae texto seleccionable y no pude extraer contenido legible por OCR.",
        );
    } finally {
        await parser.destroy();
    }
}

async function extractTextFromHtml(html: string) {
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    $("script, style, noscript, iframe, svg").remove();
    const title = $("title").first().text().trim();
    const description =
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        "";
    const headings = $("h1, h2, h3")
        .slice(0, 12)
        .map((_, element) => $(element).text().trim())
        .get()
        .filter(Boolean)
        .join("\n");
    const body = $("main").first().text().trim() || $("article").first().text().trim() || $("body").text().trim();
    return {
        title: title || "Website",
        content: trimContent([description, headings, body].filter(Boolean).join("\n\n")),
    };
}

async function fetchUrlDocument(
    url: string,
    metadata?: SourceFetchMetadata,
): Promise<SourceDocument> {
    const response = await fetchSourceResponse(url, metadata);

    if (!response.ok) {
        throw new Error(`No pude leer ${url} (${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const content = await extractPdf(buffer);
        return {
            title: url.split("/").pop() || "PDF",
            content,
            sourceUri: url,
            metadata: { contentType },
        };
    }

    const html = await response.text();
    const { title, content } = await extractTextFromHtml(html);
    return {
        title,
        content,
        sourceUri: url,
        metadata: { contentType },
    };
}

async function crawlWebsite(startUrl: string, metadata?: SourceFetchMetadata) {
    const maxDepth = metadata?.crawlMaxDepth ?? DEFAULT_CRAWL_DEPTH;
    const maxPages = metadata?.crawlMaxPages ?? DEFAULT_CRAWL_PAGES;
    const seed = new URL(startUrl);
    const queue: Array<{ url: string; depth: number }> = [{ url: seed.toString(), depth: 0 }];
    const visited = new Set<string>();
    const documents: SourceDocument[] = [];

    while (queue.length > 0 && documents.length < maxPages) {
        const current = queue.shift();
        if (!current || visited.has(current.url)) continue;
        visited.add(current.url);

        try {
            const response = await fetchSourceResponse(current.url, metadata);

            if (!response.ok) continue;

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) {
                const document = await fetchUrlDocument(current.url, metadata);
                if (document.content) documents.push(document);
                continue;
            }

            const html = await response.text();
            const { title, content } = await extractTextFromHtml(html);

            if (content) {
                documents.push({
                    title,
                    content,
                    sourceUri: current.url,
                    metadata: { depth: current.depth },
                });
            }

            if (current.depth >= maxDepth) continue;

            const cheerio = await import("cheerio");
            const $ = cheerio.load(html);
            $("a[href]").each((_, anchor) => {
                const href = $(anchor).attr("href");
                if (!href) return;
                const absolute = toAbsoluteUrl(current.url, href);
                if (!absolute) return;

                try {
                    const nextUrl = new URL(absolute);
                    nextUrl.hash = "";
                    if (nextUrl.origin !== seed.origin) return;
                    if (visited.has(nextUrl.toString())) return;
                    queue.push({ url: nextUrl.toString(), depth: current.depth + 1 });
                } catch {
                    // Ignore malformed links.
                }
            });
        } catch {
            // Best-effort crawl.
        }
    }

    return documents;
}

function toArray<T>(value: T | T[] | undefined | null) {
    if (!value) return [] as T[];
    return Array.isArray(value) ? value : [value];
}

async function collectSitemapUrls(
    sitemapUrl: string,
    metadata: SourceFetchMetadata,
    state: {
        visitedSitemaps: Set<string>;
        seenUrls: Set<string>;
        urls: string[];
        limit: number;
    },
) {
    if (state.visitedSitemaps.has(sitemapUrl) || state.urls.length >= state.limit) {
        return;
    }

    state.visitedSitemaps.add(sitemapUrl);
    const response = await fetchSourceResponse(sitemapUrl, metadata);

    if (!response.ok) {
        throw new Error(`No pude leer el sitemap ${sitemapUrl} (${response.status})`);
    }

    const xml = await response.text();
    const { XMLParser } = await import("fast-xml-parser");
    const parser = new XMLParser();
    const parsed = parser.parse(xml);
    const sitemapEntries = toArray(parsed?.sitemapindex?.sitemap as SitemapEntry | SitemapEntry[] | undefined);
    const pageEntries = toArray(parsed?.urlset?.url as SitemapEntry | SitemapEntry[] | undefined);

    for (const entry of pageEntries) {
        const url = typeof entry?.loc === "string" ? entry.loc.trim() : "";
        if (!url || state.seenUrls.has(url)) continue;
        state.seenUrls.add(url);
        state.urls.push(url);
        if (state.urls.length >= state.limit) {
            break;
        }
    }

    if (state.urls.length >= state.limit) {
        return;
    }

    for (const entry of sitemapEntries) {
        const childSitemapUrl = typeof entry?.loc === "string" ? entry.loc.trim() : "";
        if (!childSitemapUrl) continue;
        await collectSitemapUrls(childSitemapUrl, metadata, state);
        if (state.urls.length >= state.limit) {
            break;
        }
    }
}

async function fetchSitemapDocuments(sitemapUrl: string, metadata?: SourceFetchMetadata) {
    const resolvedMetadata = metadata || parseSourceFetchMetadata(undefined);
    const limit = resolvedMetadata.sitemapMaxPages ?? DEFAULT_SITEMAP_PAGES;
    const state = {
        visitedSitemaps: new Set<string>(),
        seenUrls: new Set<string>(),
        urls: [] as string[],
        limit,
    };

    await collectSitemapUrls(sitemapUrl, resolvedMetadata, state);

    const documents: SourceDocument[] = [];
    for (const url of state.urls) {
        try {
            const doc = await fetchUrlDocument(url, resolvedMetadata);
            if (doc.content) documents.push(doc);
        } catch {
            // Continue with best-effort ingest.
        }
    }

    return documents;
}

function parseGithubUrl(repoUrl: string) {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git|\/|$)/i);
    if (!match) {
        throw new Error("La URL de GitHub no es valida.");
    }

    return {
        owner: match[1],
        repo: match[2],
    };
}

function isTextGithubPath(path: string) {
    const extension = getExtension(path);
    return TEXT_FILE_EXTENSIONS.has(extension) || !extension;
}

async function fetchGithubDocuments(repoUrl: string) {
    const { owner, repo } = parseGithubUrl(repoUrl);
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
            "User-Agent": "ZenCRMBot/1.0",
            "Accept": "application/vnd.github+json",
        },
        cache: "no-store",
    });

    if (!repoResponse.ok) {
        throw new Error(`No pude leer el repositorio ${owner}/${repo}`);
    }

    const repoData = (await repoResponse.json()) as GithubRepoResponse;
    const branch = repoData.default_branch || "main";
    const treeResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        {
            headers: {
                "User-Agent": "ZenCRMBot/1.0",
                "Accept": "application/vnd.github+json",
            },
            cache: "no-store",
        },
    );

    if (!treeResponse.ok) {
        throw new Error(`No pude listar los archivos de ${owner}/${repo}`);
    }

    const treeData = (await treeResponse.json()) as GithubTreeResponse;
    const files = (treeData.tree || [])
        .filter(
            (item): item is GithubTreeEntry & { path: string } =>
                item.type === "blob" &&
                typeof item.path === "string" &&
                isTextGithubPath(item.path),
        )
        .slice(0, MAX_GITHUB_FILES);

    const documents: SourceDocument[] = [];
    for (const file of files) {
        try {
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
            const response = await fetch(rawUrl, {
                headers: { "User-Agent": "ZenCRMBot/1.0" },
                cache: "no-store",
            });

            if (!response.ok) continue;
            const content = trimContent(await response.text());
            if (!content) continue;

            documents.push({
                title: file.path,
                content,
                sourceUri: rawUrl,
                metadata: {
                    owner,
                    repo,
                    branch,
                    path: file.path,
                },
            });
        } catch {
            // Best-effort download.
        }
    }

    return documents;
}

async function fetchYoutubeDocuments(url: string) {
    const { fetchTranscript } = await import("youtube-transcript");
    const transcript = await fetchTranscript(url);
    const content = trimContent(transcript.map((line) => line.text).join(" "));
    if (!content) {
        throw new Error("No pude obtener la transcripcion del video.");
    }

    return [
        {
            title: `YouTube: ${url}`,
            content,
            sourceUri: url,
        },
    ] satisfies SourceDocument[];
}

export async function extractTextFromFileBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    return extractUploadedFileText({
        type: "file",
        title: fileName,
        fileName,
        fileBuffer: buffer,
        mimeType,
    });
}

async function extractUploadedFileText(input: SourceInput) {
    const buffer = input.fileBuffer;
    if (!buffer && input.rawContent) {
        return trimContent(input.rawContent);
    }
    if (!buffer) {
        throw new Error("No se encontro el archivo a procesar.");
    }

    const extension = getExtension(input.fileName || input.title || "");
    const mimeType = (input.mimeType || "").toLowerCase();

    if (mimeType.includes("pdf") || extension === ".pdf") {
        return extractPdf(buffer);
    }

    if (mimeType.includes("word") || extension === ".docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        return trimContent(result.value);
    }

    if (
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("video/") ||
        extension === ".mp3" ||
        extension === ".mp4" ||
        extension === ".m4a" ||
        extension === ".wav" ||
        extension === ".ogg"
    ) {
        return trimContent(
            await transcribeAudioBuffer(
                buffer,
                input.fileName || input.title || "media-input",
                input.mimeType || "application/octet-stream",
            ),
        );
    }

    return trimContent(buffer.toString("utf-8"));
}

async function loadSourceDocuments(input: SourceInput): Promise<SourceDocument[]> {
    const metadata = parseSourceFetchMetadata(input.metadata);

    if (input.type === "text") {
        return [
            {
                title: input.title,
                content: trimContent(input.rawContent || ""),
                sourceUri: input.sourceUri || undefined,
            },
        ];
    }

    if (input.type === "website") {
        return [await fetchUrlDocument(input.sourceUri || "", metadata)];
    }

    if (input.type === "crawl") {
        return crawlWebsite(input.sourceUri || "", metadata);
    }

    if (input.type === "sitemap") {
        return fetchSitemapDocuments(input.sourceUri || "", metadata);
    }

    if (input.type === "github") {
        return fetchGithubDocuments(input.sourceUri || "");
    }

    if (input.type === "youtube") {
        return fetchYoutubeDocuments(input.sourceUri || "");
    }

    if (input.type === "file") {
        const content = await extractUploadedFileText(input);
        return [
            {
                title: input.fileName || input.title,
                content,
                sourceUri: input.sourceUri || undefined,
                metadata: {
                    mimeType: input.mimeType,
                },
            },
        ];
    }

    throw new Error(`Tipo de fuente no soportado: ${input.type}`);
}

export async function processKnowledgeSource(sourceId: string) {
    const source = await prisma.knowledgeSource.findUnique({
        where: { id: sourceId },
    });

    if (!source) {
        throw new Error("Fuente de conocimiento no encontrada.");
    }

    await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: {
            status: "processing",
            error: null,
        },
    });

    try {
        const documents = await loadSourceDocuments({
            type: source.type,
            title: source.title,
            sourceUri: source.sourceUri,
            rawContent: source.rawContent,
            mimeType: source.mimeType,
            metadata: (source.metadata as Record<string, unknown> | null) || undefined,
        });

        const expandedDocs = documents.filter((doc) => doc.content);
        const chunkPayload = expandedDocs.flatMap((doc) =>
            splitIntoChunks(doc.content).map((chunk, index) => ({
                title: doc.title,
                content: chunk,
                chunkIndex: index,
                metadata: {
                    ...(doc.metadata || {}),
                    sourceUri: doc.sourceUri || source.sourceUri || null,
                },
            })),
        );

        await prisma.knowledgeChunk.deleteMany({
            where: { sourceId: source.id },
        });

        const embeddings = await generateEmbeddings(chunkPayload.map((chunk) => chunk.content));

        for (let index = 0; index < chunkPayload.length; index += 1) {
            const chunk = chunkPayload[index];
            const created = await prisma.knowledgeChunk.create({
                data: {
                    sourceId: source.id,
                    title: chunk.title,
                    content: chunk.content,
                    chunkIndex: index,
                    tokenCount: estimateTokenCount(chunk.content),
                    metadata: chunk.metadata,
                },
            });

            const vectorLiteral = `[${embeddings[index].join(",")}]`;
            await prisma.$executeRaw`
                UPDATE "KnowledgeChunk"
                SET embedding = ${vectorLiteral}::vector
                WHERE id = ${created.id}
            `;
        }

        await prisma.knowledgeSource.update({
            where: { id: source.id },
            data: {
                status: "ready",
                error: null,
                chunkCount: chunkPayload.length,
                syncedAt: new Date(),
            },
        });
    } catch (error) {
        await prisma.knowledgeSource.update({
            where: { id: source.id },
            data: {
                status: "failed",
                error: error instanceof Error ? error.message : "Fallo desconocido",
                chunkCount: 0,
            },
        });
        throw error;
    }
}

export async function queryKnowledge(query: string, requestedTopK?: number) {
    const settings = await getSystemSettingsOrDefaults();
    const topK = Math.max(1, Math.min(requestedTopK || settings.knowledgeTopK || 6, 12));

    try {
        const embedding = await generateEmbedding(query);
        const vectorQuery = `[${embedding.join(",")}]`;

        const rows = await prisma.$queryRaw<RetrievedChunk[]>`
            SELECT
                kc.id,
                kc.content,
                kc.title,
                1 - (kc.embedding <=> ${vectorQuery}::vector) AS similarity,
                ks.id AS "sourceId",
                ks.title AS "sourceTitle",
                ks.type AS "sourceType",
                ks."sourceUri" AS "sourceUri"
            FROM "KnowledgeChunk" kc
            JOIN "KnowledgeSource" ks ON ks.id = kc."sourceId"
            WHERE ks.status = 'ready'
            ORDER BY kc.embedding <=> ${vectorQuery}::vector
            LIMIT ${topK};
        `;

        return rows;
    } catch {
        const keywordRows = await prisma.knowledgeChunk.findMany({
            where: {
                source: { status: "ready" },
                content: { contains: query, mode: "insensitive" },
            },
            include: { source: true },
            take: topK,
        });

        return keywordRows.map((row) => ({
            id: row.id,
            content: row.content,
            title: row.title,
            similarity: 0,
            sourceId: row.sourceId,
            sourceTitle: row.source.title,
            sourceType: row.source.type,
            sourceUri: row.source.sourceUri,
        }));
    }
}

export async function buildKnowledgeContext(query: string, requestedTopK?: number) {
    const chunks = await queryKnowledge(query, requestedTopK);
    const context = chunks
        .map((chunk, index) => {
            const sourceLine = chunk.sourceUri
                ? `${chunk.sourceTitle} (${chunk.sourceUri})`
                : chunk.sourceTitle;
            return `[FUENTE ${index + 1}] ${sourceLine}\n${chunk.content}`;
        })
        .join("\n\n");

    return {
        context,
        chunks,
    };
}
