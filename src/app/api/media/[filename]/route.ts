// API route to serve media files with correct Content-Type headers
// This avoids ngrok free-tier interstitial page issues that affect static files
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { MEDIA_MIME_BY_EXTENSION, mediaOwnedByTenant, parseMediaRange, safeMediaFilename, verifyMediaDownload } from "@/lib/chat-media-policy";

const MIME_TYPES: Record<string, string> = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg; codecs=opus",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".amr": "audio/amr",
    ".webm": "audio/webm",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
    ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".ico", ".gif", ".webp"]);
const INLINE_EXTENSIONS = new Set([
    ...IMAGE_EXTENSIONS,
    ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".aac", ".amr", ".webm",
    ".mp4", ".m4v", ".mov", ".3gp", ".3gpp", ".avi", ".mpeg", ".mpg",
]);

function buildMissingMediaPlaceholderSvg(label: string) {
    const safeLabel = label.replace(/[<>&"']/g, "");

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Archivo no disponible">
  <rect width="640" height="360" fill="#f3f4f6" />
  <rect x="56" y="56" width="528" height="248" rx="22" fill="#ffffff" stroke="#d1d5db" stroke-width="2" />
  <circle cx="176" cy="138" r="26" fill="#dbeafe" />
  <rect x="224" y="120" width="240" height="16" rx="8" fill="#111827" opacity="0.78" />
  <rect x="224" y="150" width="176" height="12" rx="6" fill="#6b7280" opacity="0.75" />
  <rect x="96" y="210" width="448" height="54" rx="12" fill="#f9fafb" stroke="#e5e7eb" />
  <text x="320" y="242" text-anchor="middle" fill="#374151" font-size="18" font-family="Inter, Segoe UI, Arial, sans-serif">${safeLabel}</text>
</svg>
`.trim();
}

async function buildMediaResponse(request: NextRequest, filename: string, includeBody: boolean) {

    // Security: only allow alphanumeric, dash, underscore, dot
    if (!safeMediaFilename(filename)) {
        return new NextResponse(null, { status: 404 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    const ext = path.extname(filename).toLowerCase();

    // Public brand/service images retain their historical public contract. Chat uploads
    // and incoming media use private-* names and require tenant ownership or a signed URL.
    const publicImage = IMAGE_EXTENSIONS.has(ext) && !filename.startsWith("private-");
    if (!publicImage && !verifyMediaDownload(filename, request.nextUrl.searchParams)) {
        const session = await auth();
        if (!session?.user) return new NextResponse(null, { status: 401 });
        try {
            const tenant = await getActiveTenantRuntimeContext("read");
            if (!tenant && (session.user as { authScope?: string }).authScope === "control") return new NextResponse(null, { status: 404 });
            if (!mediaOwnedByTenant(filename, tenant?.tenantId || null)) return new NextResponse(null, { status: 404 });
            if (filename.startsWith("private-legacy-") && (tenant || (session.user as { authScope?: string }).authScope === "control")) return new NextResponse(null, { status: 404 });
        } catch { return new NextResponse(null, { status: 404 }); }
    }

    if (!fs.existsSync(filePath)) {
        if (publicImage && !request.nextUrl.searchParams.has("signature")) {
            const svg = buildMissingMediaPlaceholderSvg("Archivo no disponible");

            return new NextResponse(includeBody ? svg : null, {
                status: 200,
                headers: {
                    "Content-Type": "image/svg+xml; charset=utf-8",
                    "Cache-Control": "public, max-age=300",
                },
            });
        }

        return new NextResponse(null, { status: 404 });
    }

    const size = fs.statSync(filePath).size;
    const range = parseMediaRange(request.headers.get("range"), size);
    if (range === false) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    let contentType = MIME_TYPES[ext] || MEDIA_MIME_BY_EXTENSION[ext.slice(1)] || "application/octet-stream";
    if (ext === ".ogg") {
        const descriptor = fs.openSync(filePath, "r");
        try {
            const header = Buffer.alloc(256);
            fs.readSync(descriptor, header, 0, header.length, 0);
            if (header.includes(Buffer.from("OpusHead"))) contentType = "audio/ogg; codecs=opus";
        } finally { fs.closeSync(descriptor); }
    }
    const disposition = INLINE_EXTENSIONS.has(ext) ? "inline" : "attachment";
    const body = includeBody ? Readable.toWeb(fs.createReadStream(filePath, range || undefined)) as ReadableStream<Uint8Array> : null;
    return new NextResponse(body, {
        status: range ? 206 : 200,
        headers: {
            "Content-Type": contentType,
            "Content-Length": String(range ? range.end - range.start + 1 : size),
            "Accept-Ranges": "bytes",
            ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
            "Content-Disposition": `${disposition}; filename="${filename}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    return buildMediaResponse(request, filename, true);
}

export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    return buildMediaResponse(request, filename, false);
}
