import { MEDIA_MIME_BY_EXTENSION } from "./chat-media-policy.ts";

const ALLOWED: Record<string, Set<string>> = {
    image: new Set(["image/jpeg", "image/png"]),
    audio: new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"]),
    video: new Set(["video/mp4", "video/3gpp"]),
    document: new Set(["text/plain", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
};

export function validateMetaMedia(category: string, filename: string, bytes: number, header?: Buffer, explicitMime?: string) {
    const extension = filename.split(".").at(-1)?.toLowerCase() || "";
    const mime = MEDIA_MIME_BY_EXTENSION[extension] || explicitMime?.split(";")[0]?.trim().toLowerCase() || "";
    if (!ALLOWED[category]?.has(mime)) throw new Error("WhatsApp API no admite este formato. Usa JPG/PNG, MP3/M4A/OGG Opus, MP4, PDF o un documento de Office.");
    const limit = (category === "image" ? 5 : category === "document" ? 100 : 16) * 1024 * 1024;
    if (bytes > limit || bytes <= 0) throw new Error(`El archivo para WhatsApp API debe ocupar entre 1 byte y ${limit / 1024 / 1024} MB.`);
    if (mime === "audio/ogg") {
        const opus = header?.indexOf(Buffer.from("OpusHead")) ?? -1;
        if (opus < 0 || header?.[opus + 9] !== 1) throw new Error("WhatsApp API requiere audio OGG con Opus y un solo canal. Vuelve a cargar el audio para convertirlo.");
        return "audio/ogg; codecs=opus";
    }
    return mime;
}
