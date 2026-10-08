// API route for uploading media files
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, stat, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { runMediaFfmpeg } from "@/lib/ffmpeg-runtime";
import { MEDIA_MIME_BY_EXTENSION, mediaCategory as getMediaCategory, tenantMediaNamespace } from "@/lib/chat-media-policy";
import crypto from "crypto";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { getSessionAccessSubject, getSessionUserId } from "@/lib/authz";
import { hasAnyPermission } from "@/lib/permissions";

export const runtime = "nodejs";

const MAX_WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_NON_VIDEO_BYTES = 25 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".3gp"]);
const ALLOWED_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp3", ".ogg", ".opus", ".wav", ".m4a", ".aac", ".amr",
    ...VIDEO_EXTENSIONS,
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt",
    ".ppt", ".pptx", ".zip", ".rar",
]);
const BLOCKED_MIME_TYPES = new Set([
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "text/javascript",
    "application/xhtml+xml",
]);

async function removeIfExists(filePath: string) {
    try {
        await unlink(filePath);
    } catch {
        // Best-effort cleanup only.
    }
}

async function transcodeVideoToMp4(inputPath: string, outputPath: string) {
    await runMediaFfmpeg([
            "-y",
            "-i",
            inputPath,
            "-map_metadata",
            "-1",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            outputPath,
    ]);
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!getSessionUserId(session)) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }
        if (!hasAnyPermission(getSessionAccessSubject(session), [
            "chats.manage",
            "services.manage",
            "settings.manage",
            "ai.manage",
            "patients.manage",
            "clinical.manage",
            "campaigns.manage",
            "specialists.manage",
        ])) {
            return NextResponse.json({ error: "Sin permiso para subir archivos" }, { status: 403 });
        }
        const tenantRuntime = await getActiveTenantRuntimeContext("write");

        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }
        if (!file.size) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
        const isPrivateChat = formData.get("purpose") === "chat";

        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: "El archivo supera el limite de 100MB para subirlo al CRM." },
                { status: 413 },
            );
        }

        const originalExt = path.extname(file.name).toLowerCase();
        const claimedMimeType = file.type.toLowerCase().split(";")[0].trim();
        const normalizedMimeType = (!claimedMimeType || claimedMimeType === "application/octet-stream")
            ? MEDIA_MIME_BY_EXTENSION[originalExt.slice(1)] || "application/octet-stream" : claimedMimeType;
        // A WebM voice recording is audio, not video: preserve the actual container until conversion.
        const isAudio = normalizedMimeType.startsWith("audio/");
        const isVideo = !isAudio && (VIDEO_EXTENSIONS.has(originalExt) || normalizedMimeType.startsWith("video/") || (isPrivateChat && normalizedMimeType === "image/gif"));
        const isImage = !isVideo && normalizedMimeType.startsWith("image/");

        if (!ALLOWED_EXTENSIONS.has(originalExt) || BLOCKED_MIME_TYPES.has(normalizedMimeType)) {
            return NextResponse.json(
                { error: "Tipo de archivo no permitido." },
                { status: 415 },
            );
        }

        if (!isVideo && file.size > MAX_NON_VIDEO_BYTES) {
            return NextResponse.json(
                { error: "El archivo supera el limite de 25MB." },
                { status: 413 },
            );
        }

        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadsDir)) {
            await mkdir(uploadsDir, { recursive: true });
        }

        const originalBuffer = Buffer.from(await file.arrayBuffer());

        // Generate unique filename
        const ext = isVideo ? ".mp4" : isAudio ? ".ogg" : isImage && normalizedMimeType === "image/webp" ? ".png" : originalExt;
        // Keep legacy installations compatible while making every new multitenant object
        // unambiguously owned by one business, even on the temporary shared volume fallback.
        const tenantNamespace = tenantRuntime
            ? tenantMediaNamespace(tenantRuntime.tenantId)
            : null;
        const uniqueName = `${isPrivateChat ? "private-" : ""}${tenantNamespace ? `t-${tenantNamespace}-` : isPrivateChat ? "legacy-" : ""}${crypto.randomUUID()}${ext}`;
        const filePath = path.join(uploadsDir, uniqueName);

        let returnedFileName = file.name;
        let returnedMimeType = normalizedMimeType;

        if (isVideo) {
            // MP4 is a container, not a codec guarantee. Normalize even small HEVC/AV1 MP4s.
            const inputPath = path.join(
                uploadsDir,
                `${crypto.randomUUID()}-input${originalExt || ".video"}`,
            );

            try {
                await writeFile(inputPath, originalBuffer);
                await transcodeVideoToMp4(inputPath, filePath);
            } catch (conversionError) {
                console.error("[Upload] Video conversion error:", conversionError);
                await removeIfExists(filePath);
                return NextResponse.json(
                    { error: "No pude convertir el video a MP4 compatible con WhatsApp." },
                    { status: 400 },
                );
            } finally {
                await removeIfExists(inputPath);
            }

            const videoStats = await stat(filePath);
            if (videoStats.size > MAX_WHATSAPP_VIDEO_BYTES) {
                await removeIfExists(filePath);

                return NextResponse.json(
                    { error: "El video final supera 16MB. WhatsApp solo acepta videos MP4 de hasta 16MB." },
                    { status: 413 },
                );
            }

            returnedFileName = `${path.parse(file.name).name || "video"}.mp4`;
            returnedMimeType = "video/mp4";
        } else if (isAudio) {
            const inputPath = path.join(uploadsDir, `${crypto.randomUUID()}-input${originalExt}`);
            try {
                await writeFile(inputPath, originalBuffer);
                await runMediaFfmpeg(["-y", "-i", inputPath, "-vn", "-c:a", "libopus", "-b:a", "32k", "-ac", "1", filePath]);
                returnedMimeType = "audio/ogg";
                returnedFileName = `${path.parse(file.name).name || "audio"}.ogg`;
                if ((await stat(filePath)).size > 16 * 1024 * 1024) throw new Error("audio_too_large");
            } catch (error) {
                await removeIfExists(filePath);
                if (error instanceof Error && error.message === "audio_too_large") return NextResponse.json({ error: "El audio final supera el límite de 16MB de WhatsApp." }, { status: 413 });
                return NextResponse.json({ error: "No se pudo convertir el audio a una nota de voz compatible con WhatsApp." }, { status: 422 });
            } finally { await removeIfExists(inputPath); }
        } else if (isImage && normalizedMimeType === "image/webp") {
            await writeFile(filePath, await sharp(originalBuffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer());
            returnedMimeType = "image/png";
            returnedFileName = `${path.parse(file.name).name || "imagen"}.png`;
        } else {
            // Write file to disk
            await writeFile(filePath, originalBuffer);
        }

        if (isPrivateChat && isImage && (await stat(filePath)).size > 5 * 1024 * 1024) {
            await removeIfExists(filePath);
            return NextResponse.json({ error: "WhatsApp acepta imágenes de hasta 5MB. Reduce el tamaño o envíala como documento." }, { status: 413 });
        }

        // Return the media API URL so external providers can download it reliably.
        const publicUrl = `/api/media/${uniqueName}`;

        // Determine media type category
        const mediaCategory = isVideo ? "video" : getMediaCategory(returnedMimeType);

        console.log("[Upload] File saved:", uniqueName, "type:", mediaCategory);

        return NextResponse.json({
            success: true,
            url: publicUrl,
            fileName: returnedFileName,
            mimeType: returnedMimeType,
            mediaCategory,
        });
    } catch (error) {
        console.error("[Upload] Error:", error);
        return NextResponse.json(
            { error: "No se pudo subir el archivo. Revisa su tamaño y vuelve a intentarlo." },
            { status: 500 }
        );
    }
}
