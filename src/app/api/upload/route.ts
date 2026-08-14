// API route for uploading media files
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, stat, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { spawn } from "child_process";
import ffmpegStaticPath from "ffmpeg-static";

export const runtime = "nodejs";

const MAX_WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function isMp4Video(fileName: string, mimeType: string) {
    return mimeType === "video/mp4" || path.extname(fileName).toLowerCase() === ".mp4";
}

async function removeIfExists(filePath: string) {
    try {
        await unlink(filePath);
    } catch {
        // Best-effort cleanup only.
    }
}

async function transcodeVideoToMp4(inputPath: string, outputPath: string) {
    const ffmpegExecutable = ffmpegStaticPath || "ffmpeg";

    await new Promise<void>((resolve, reject) => {
        const process = spawn(ffmpegExecutable, [
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

        let stderr = "";
        process.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        process.on("error", reject);
        process.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr || `FFmpeg termino con codigo ${code}`));
        });
    });
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: "El archivo supera el limite de 100MB para subirlo al CRM." },
                { status: 413 },
            );
        }

        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadsDir)) {
            await mkdir(uploadsDir, { recursive: true });
        }

        const originalExt = path.extname(file.name);
        const isVideo = file.type.startsWith("video/");
        const originalBuffer = Buffer.from(await file.arrayBuffer());

        // Generate unique filename
        const ext = isVideo ? ".mp4" : originalExt;
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
        const filePath = path.join(uploadsDir, uniqueName);

        let returnedFileName = file.name;
        let returnedMimeType = file.type;

        if (isVideo) {
            const shouldTranscode = !isMp4Video(file.name, file.type) || originalBuffer.length > MAX_WHATSAPP_VIDEO_BYTES;
            const inputPath = path.join(
                uploadsDir,
                `${Date.now()}-${Math.random().toString(36).substring(7)}-input${originalExt || ".video"}`,
            );

            if (shouldTranscode) {
                await writeFile(inputPath, originalBuffer);

                try {
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
            } else {
                await writeFile(filePath, originalBuffer);
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
        } else {
            // Write file to disk
            await writeFile(filePath, originalBuffer);
        }

        // Return the media API URL so external providers can download it reliably.
        const publicUrl = `/api/media/${uniqueName}`;

        // Determine media type category
        let mediaCategory = "document";
        if (file.type.startsWith("image/")) mediaCategory = "image";
        else if (file.type.startsWith("audio/")) mediaCategory = "audio";
        else if (file.type.startsWith("video/")) mediaCategory = "video";

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
            { error: "Failed to upload file" },
            { status: 500 }
        );
    }
}
