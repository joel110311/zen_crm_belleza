import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { QueuedWebhookPayload } from "@/lib/tenant-work-queue";
import { downloadTenantChannelMedia } from "@/lib/tenant-channels";
import { MEDIA_MIME_BY_EXTENSION, tenantMediaNamespace } from "@/lib/chat-media-policy";

export async function resolveTenantInboundMedia(tenantId: string, eventId: string, payload: QueuedWebhookPayload) {
    const media = { type: payload.messageType || "text", mediaType: payload.mediaMimeType, mediaFileName: payload.mediaFileName };
    if (media.type === "text") return media;
    // Gateway S3 objects are already decrypted and publicly downloadable; no tenant token is sent to them.
    if (payload.mediaRemoteUrl && /^https:\/\//i.test(payload.mediaRemoteUrl) && !payload.mediaDownload && !payload.providerMediaId && !payload.mediaBase64) return { ...media, mediaUrl: payload.mediaRemoteUrl };
    const downloaded = payload.mediaBase64
        ? { buffer: Buffer.from(payload.mediaBase64.includes(",") ? payload.mediaBase64.split(",", 2)[1] : payload.mediaBase64, "base64"), mimeType: payload.mediaMimeType || "application/octet-stream" }
        : await downloadTenantChannelMedia(tenantId, payload);
    if (!downloaded.buffer.length || downloaded.buffer.length > 100 * 1024 * 1024) throw new Error("El archivo recibido está vacío o supera 100MB.");
    const mimeType = downloaded.mimeType.split(";")[0].trim().toLowerCase();
    const extension = Object.entries(MEDIA_MIME_BY_EXTENSION).find(([, mime]) => mime === mimeType)?.[0] || "bin";
    const filename = `private-t-${tenantMediaNamespace(tenantId)}-${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 24)}.${extension}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), downloaded.buffer);
    return { ...media, mediaUrl: `/api/media/${filename}`, mediaType: mimeType };
}
