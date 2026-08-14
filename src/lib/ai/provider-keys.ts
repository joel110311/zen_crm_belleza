import { prisma } from "@/lib/db";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthy(value?: string | null) {
    return value ? TRUE_VALUES.has(value.trim().toLowerCase()) : false;
}

export function allowEnvironmentAiFallback() {
    return isTruthy(process.env.ALLOW_ENV_AI_FALLBACK);
}

export async function resolveAiProviderKey(provider: "openai" | "gemini") {
    let settings:
        | {
            openaiApiKey: string | null;
            geminiApiKey: string | null;
        }
        | null
        = null;

    try {
        settings = await prisma.systemSettings.findFirst({
            select: {
                openaiApiKey: true,
                geminiApiKey: true,
            },
        });
    } catch (error) {
        console.warn("[AI] Could not read stored provider keys, trying env fallback:", error);
    }

    const storedKey =
        provider === "openai"
            ? settings?.openaiApiKey?.trim()
            : settings?.geminiApiKey?.trim();

    if (storedKey) {
        return storedKey;
    }

    if (!allowEnvironmentAiFallback()) {
        return null;
    }

    const envKey =
        provider === "openai"
            ? process.env.OPENAI_API_KEY?.trim()
            : process.env.GEMINI_API_KEY?.trim();

    return envKey || null;
}
