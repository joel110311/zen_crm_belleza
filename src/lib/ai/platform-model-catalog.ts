import "server-only";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";
import { normalizeChatModelSelection, SUPPORTED_CHAT_MODELS, type SupportedChatModelOption } from "@/lib/ai/models";

export function geminiChatModelOptions(value: unknown): SupportedChatModelOption[] {
    const data = value && typeof value === "object" ? Reflect.get(value, "models") : undefined;
    if (!Array.isArray(data)) return [];
    return data.flatMap(row => {
        if (!row || typeof row !== "object" || typeof row.name !== "string" || !/^models\/gemini-[a-zA-Z0-9._-]+$/.test(row.name)
            || !Array.isArray(row.supportedGenerationMethods) || !row.supportedGenerationMethods.includes("generateContent")
            || /(?:^|-)(?:image|audio|tts|live|embedding|robotics|transcribe|omni)(?:-|$)/.test(row.name)) return [];
        const id = `gemini:${row.name}`;
        if (normalizeChatModelSelection(id) !== id) return [];
        return [{ id, provider: "gemini" as const, model: row.name, label: typeof row.displayName === "string" ? row.displayName.slice(0, 120) : row.name.replace("models/", ""), description: "Disponible según la API de esta cuenta." }];
    });
}

export async function getPlatformModelCatalog() {
    const apiKey = await resolveAiProviderKey("gemini");
    if (!apiKey) return { models: SUPPORTED_CHAT_MODELS, live: false, notice: "Configura la clave oficial de Gemini para consultar su catálogo. Se muestran las opciones incluidas." };
    try {
        const models: SupportedChatModelOption[] = [];
        let pageToken = "";
        const signal = AbortSignal.timeout(6000);
        for (let page = 0; page < 5; page++) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { headers: { "x-goog-api-key": apiKey }, cache: "no-store", redirect: "error", signal });
            if (!response.ok) throw new Error("Model catalog unavailable");
            const data = await response.json(); models.push(...geminiChatModelOptions(data));
            pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
            if (!pageToken) break;
        }
        return { models: [...SUPPORTED_CHAT_MODELS.filter(m => m.provider !== "gemini"), ...new Map(models.map(m => [m.id, m])).values()], live: true, notice: "Lista actualizada desde la API oficial de Gemini." };
    } catch { return { models: SUPPORTED_CHAT_MODELS, live: false, notice: "No se pudo actualizar el catálogo. Se conservan las opciones incluidas; revisa la clave o intenta más tarde." }; }
}
