// API route to serve media files with correct Content-Type headers
// This avoids ngrok free-tier interstitial page issues that affect static files
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
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
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".svg", ".ico", ".gif", ".webp"]);

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

async function buildMediaResponse(filename: string, includeBody: boolean) {

    // Security: only allow alphanumeric, dash, underscore, dot
    if (!/^[\w\-\.]+$/.test(filename)) {
        return new NextResponse(null, { status: 204 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    const ext = path.extname(filename).toLowerCase();

    if (!fs.existsSync(filePath)) {
        if (IMAGE_EXTENSIONS.has(ext)) {
            const svg = buildMissingMediaPlaceholderSvg("Archivo no disponible");

            return new NextResponse(svg, {
                status: 200,
                headers: {
                    "Content-Type": "image/svg+xml; charset=utf-8",
                    "Cache-Control": "public, max-age=300",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

        return new NextResponse(null, { status: 204 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    console.log(`[MEDIA] Serving ${filename} as ${contentType} (${fileBuffer.length} bytes)`);

    return new NextResponse(includeBody ? fileBuffer : null, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Content-Length": fileBuffer.length.toString(),
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
        },
    });
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    return buildMediaResponse(filename, true);
}

export async function HEAD(
    _request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;
    return buildMediaResponse(filename, false);
}
