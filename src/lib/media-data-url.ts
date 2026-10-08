import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { runMediaFfmpeg } from "@/lib/ffmpeg-runtime";
import { localMediaFilename } from "@/lib/chat-media-policy";
import { assertLocalMediaOwnership } from "@/lib/local-media-access";

const MIME_BY_EXTENSION: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
    ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
};

const EXTENSION_BY_MIME: Record<string, string> = {
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
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "video/x-msvideo": ".avi",
    "video/mpeg": ".mpeg",
};

function inferMimeType(fileName: string, explicitMimeType?: string | null) {
    if (explicitMimeType) return explicitMimeType;
    const extension = path.extname(fileName).toLowerCase();
    return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

function parseUrl(value: string) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function extractGoogleDriveFileId(mediaUrl: string) {
    const parsed = parseUrl(mediaUrl);
    if (!parsed || !/(^|\.)drive\.google\.com$/i.test(parsed.hostname)) {
        return null;
    }

    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }

    const queryId = parsed.searchParams.get("id");
    if (queryId) {
        return queryId;
    }

    return null;
}

function toFetchableExternalMediaUrl(mediaUrl: string) {
    const driveFileId = extractGoogleDriveFileId(mediaUrl);
    if (driveFileId) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`;
    }

    return mediaUrl;
}

function isGoogleDriveHost(hostname: string) {
    return /(^|\.)drive\.google\.com$/i.test(hostname) || /(^|\.)googleusercontent\.com$/i.test(hostname);
}

function decodeEscapedJsonUrl(value: string) {
    return value
        .replace(/\\u003d/g, "=")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
}

function extractGoogleDriveHtmlDownloadUrl(html: string) {
    const patterns = [
        /href="(\/uc\?export=download[^"]+)"/i,
        /"downloadUrl":"([^"]+)"/i,
        /action="(https:\/\/drive\.google\.com\/uc\?export=download[^"]+)"/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        const candidate = match?.[1];
        if (!candidate) continue;

        const decodedCandidate = decodeEscapedJsonUrl(candidate).trim();
        if (!decodedCandidate) continue;

        if (decodedCandidate.startsWith("/")) {
            return `https://drive.google.com${decodedCandidate}`;
        }

        if (/^https?:\/\//i.test(decodedCandidate)) {
            return decodedCandidate;
        }
    }

    return null;
}

function inferFileNameFromContentDisposition(contentDisposition: string | null) {
    if (!contentDisposition) return null;

    const utf8FileNameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8FileNameMatch?.[1]) {
        try {
            return decodeURIComponent(utf8FileNameMatch[1]).replace(/[\\/]/g, "_");
        } catch {
            return utf8FileNameMatch[1].replace(/[\\/]/g, "_");
        }
    }

    const quotedFileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (quotedFileNameMatch?.[1]) {
        return quotedFileNameMatch[1].replace(/[\\/]/g, "_");
    }

    return null;
}

function fileNameFromUrl(mediaUrl: string) {
    const parsed = parseUrl(mediaUrl);
    if (parsed) {
        const directName = path.basename(parsed.pathname);
        if (directName && directName !== "/" && directName !== "uc") {
            return directName;
        }

        const driveFileId = extractGoogleDriveFileId(mediaUrl);
        if (driveFileId) {
            return `drive_${driveFileId}`;
        }

        return "archivo";
    }

    const clean = mediaUrl.split("?")[0];
    const fallback = path.basename(clean);
    return fallback || "archivo";
}

function isHttpUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

async function convertAudioBufferToOgg(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    if (!mimeType.startsWith("audio/") || mimeType.split(";")[0].trim() === "audio/mpeg") {
        return null;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zencrm-audio-"));
    const inputExtension = path.extname(fileName) || ".bin";
    const inputPath = path.join(tempDir, `input${inputExtension}`);
    const outputPath = path.join(tempDir, "output.ogg");

    try {
        await writeFile(inputPath, buffer);

        await runMediaFfmpeg([
                "-y",
                "-i",
                inputPath,
                "-vn",
                "-c:a",
                "libopus",
                "-b:a",
                "32k",
                "-ac",
                "1",
                "-vbr",
                "on",
                outputPath,
        ]);

        const convertedBuffer = await readFile(outputPath);
        return {
            buffer: convertedBuffer,
            fileName: `${path.parse(fileName).name || "audio"}.ogg`,
            mimeType: "audio/ogg",
        };
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

async function finalizeMedia(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    // A failed conversion must not silently send a mislabeled/unplayable voice note.
    const convertedAudio = await convertAudioBufferToOgg(buffer, fileName, mimeType);
    const finalBuffer = convertedAudio?.buffer || buffer;
    const finalFileName = convertedAudio?.fileName || fileName;
    const finalMimeType = convertedAudio?.mimeType || mimeType;

    return {
        dataUrl: `data:${finalMimeType};base64,${finalBuffer.toString("base64")}`,
        fileName: finalFileName,
        mimeType: finalMimeType,
    };
}

export async function resolveMediaToDataUrl(
    mediaUrl: string,
    explicitMimeType?: string | null,
) {
    if (mediaUrl.startsWith("data:")) {
        const mimeType = mediaUrl.slice(5, mediaUrl.indexOf(";")) || "application/octet-stream";
        return {
            dataUrl: mediaUrl,
            fileName: "archivo",
            mimeType,
        };
    }

    const fileName = fileNameFromUrl(mediaUrl);
    const mimeType = inferMimeType(fileName, explicitMimeType);

    const localFileName = localMediaFilename(mediaUrl, process.env.APP_BASE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL);
    if (localFileName) {
        await assertLocalMediaOwnership(localFileName);
        const buffer = await readFile(path.join(process.cwd(), "public", "uploads", localFileName));
        return finalizeMedia(buffer, localFileName, mimeType);
    }

    if (isHttpUrl(mediaUrl)) {
        const initialFetchUrl = toFetchableExternalMediaUrl(mediaUrl);
        let response = await fetch(initialFetchUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No pude descargar el archivo desde ${mediaUrl}`);
        }

        const responseUrl = parseUrl(response.url);
        const responseMimeType = response.headers.get("content-type") || mimeType;
        const normalizedResponseMimeType = responseMimeType.split(";")[0]?.trim().toLowerCase() || mimeType;

        if (
            normalizedResponseMimeType.startsWith("text/html") &&
            responseUrl &&
            isGoogleDriveHost(responseUrl.hostname)
        ) {
            const html = await response.text();
            const extractedUrl = extractGoogleDriveHtmlDownloadUrl(html);
            if (extractedUrl) {
                response = await fetch(extractedUrl, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(`No pude descargar el archivo desde ${mediaUrl}`);
                }
            } else {
                throw new Error(
                    "Google Drive no devolvio el archivo directamente. Verifica que el enlace sea publico y de descarga directa.",
                );
            }
        }

        const finalResponseMimeType = response.headers.get("content-type") || responseMimeType;
        const finalNormalizedMimeType = finalResponseMimeType.split(";")[0]?.trim().toLowerCase() || mimeType;
        if (finalNormalizedMimeType === "text/html") throw new Error("El enlace devolvió una página web, no el archivo multimedia.");
        const contentDispositionFileName = inferFileNameFromContentDisposition(
            response.headers.get("content-disposition"),
        );
        let resolvedFileName = contentDispositionFileName || fileName;

        if (!path.extname(resolvedFileName)) {
            const inferredExtension = EXTENSION_BY_MIME[finalNormalizedMimeType];
            if (inferredExtension) {
                resolvedFileName = `${resolvedFileName}${inferredExtension}`;
            }
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        return finalizeMedia(buffer, resolvedFileName, finalResponseMimeType);
    }

    throw new Error("No pude resolver el archivo multimedia.");
}
