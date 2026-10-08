/** Uploaded MP3s are audio files; microphone recordings are Opus voice notes. */
export function whatsappAudioOptions(dataUrl: string, explicitMimeType?: string) {
    const mime = (explicitMimeType || dataUrl.slice(5, dataUrl.indexOf(";"))).split(";")[0].trim().toLowerCase();
    const ptt = mime === "audio/ogg" || mime === "audio/opus";
    return { PTT: ptt, MimeType: ptt ? "audio/ogg; codecs=opus" : mime };
}

/** HTTP 200 is not sufficient: the gateway must acknowledge a real message. */
export function requireProviderMessageId(result: { Id?: string | null } | null | undefined): string {
    const id = typeof result?.Id === "string" ? result.Id.trim() : "";
    if (!id) throw new Error("WhatsApp no confirmó el envío del mensaje. No se marcó como enviado.");
    return id;
}
