import crypto from "node:crypto";

export const MAX_MEDIA_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;
export const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", amr: "audio/amr",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
    pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain", csv: "text/csv", zip: "application/zip", rar: "application/vnd.rar",
};
export function mediaCategory(mimeType: string) {
    return mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "document";
}
export function tenantMediaNamespace(tenantId: string) {
    return crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}
export function mediaOwnedByTenant(filename: string, tenantId: string | null) {
    const owner = filename.match(/^(?:private-)?t-([a-f0-9]{16})-/)?.[1];
    if (owner) return Boolean(tenantId && owner === tenantMediaNamespace(tenantId));
    return !filename.startsWith("private-") || !tenantId;
}
export function safeMediaFilename(filename: string) {
    return /^[\w.-]+$/.test(filename) && filename !== "." && filename !== "..";
}
export function localMediaFilename(value: string, appBaseUrl?: string | null) {
    try {
        const url = new URL(value, appBaseUrl || "https://crm.local");
        if (/^https?:/i.test(value) && (!appBaseUrl || url.origin !== new URL(appBaseUrl).origin)) return null;
        const match = url.pathname.match(/^\/(?:uploads|api\/media)\/([^/]+)$/);
        const filename = match ? decodeURIComponent(match[1]) : "";
        return safeMediaFilename(filename) ? filename : null;
    } catch { return null; }
}
function mediaSecret() {
    const secret = process.env.SECURITY_HASH_SALT || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("Falta un secreto seguro para publicar el archivo multimedia.");
    return secret;
}
function signature(filename: string, expires: number) {
    return crypto.createHmac("sha256", mediaSecret()).update(`chat-media:v1:${filename}:${expires}`).digest("hex");
}
export function signMediaDownload(filename: string, now = Date.now()) {
    if (!safeMediaFilename(filename)) throw new Error("Nombre de archivo no válido.");
    const expires = Math.floor(now / 1000) + 60 * 60;
    return `expires=${expires}&signature=${signature(filename, expires)}`;
}
export function verifyMediaDownload(filename: string, parameters: URLSearchParams, now = Date.now()) {
    const expires = Number(parameters.get("expires"));
    const supplied = parameters.get("signature") || "";
    if (!safeMediaFilename(filename) || !Number.isSafeInteger(expires) || expires < now / 1000 || expires > now / 1000 + 3601 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
    try { return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(filename, expires), "hex")); }
    catch { return false; }
}
export function parseMediaRange(header: string | null, size: number) {
    if (!header) return null;
    const match = header.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return false;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : false;
}
