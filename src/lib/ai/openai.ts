import OpenAI, { toFile } from "openai";
import { prisma } from "@/lib/db";
import { SYSTEM_SETTINGS_DEFAULTS } from "@/lib/system-settings";
import { resolveChatModelSelection, resolveGeminiRestModelPath } from "@/lib/ai/models";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";

const DEFAULT_IMAGE_OCR_PROMPT =
    "Extrae en espanol todo el texto legible de esta imagen. Conserva titulos, precios, ubicaciones, bullets y datos comerciales. Si una seccion no se alcanza a leer completa, transcribe lo visible y no inventes nada.";

const GEMINI_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_FALLBACK_MODEL_PATHS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
];
const GEMINI_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

type GeminiModelCacheEntry = {
    expiresAt: number;
    models: Set<string>;
};

const geminiModelCache = new Map<string, GeminiModelCacheEntry>();

type GeminiGenerateContentPayload = {
    contents: Array<{
        role?: string;
        parts: Array<{
            text?: string;
            inline_data?: {
                mime_type: string;
                data: string;
            };
        }>;
    }>;
    generationConfig?: Record<string, unknown>;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGeminiModelCandidates(preferredModel?: string | null) {
    const normalizedPreferred = resolveGeminiRestModelPath(preferredModel);
    return [normalizedPreferred, ...GEMINI_FALLBACK_MODEL_PATHS].filter(
        (modelPath, index, all) => all.indexOf(modelPath) === index,
    );
}

function getCachedGeminiModels(apiKey: string) {
    const cached = geminiModelCache.get(apiKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        geminiModelCache.delete(apiKey);
        return null;
    }
    return cached.models;
}

async function fetchAvailableGeminiModels(apiKey: string) {
    const cached = getCachedGeminiModels(apiKey);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`,
            { cache: "no-store" },
        );

        if (!response.ok) {
            return null;
        }

        const data = (await response.json()) as {
            models?: Array<{ name?: string }>;
        };
        const models = new Set(
            (data.models || [])
                .map((model) => model.name?.trim())
                .filter((name): name is string => Boolean(name && name.startsWith("models/"))),
        );

        if (models.size > 0) {
            geminiModelCache.set(apiKey, {
                expiresAt: Date.now() + GEMINI_MODEL_CACHE_TTL_MS,
                models,
            });
        }

        return models.size > 0 ? models : null;
    } catch {
        return null;
    }
}

function rememberUnavailableGeminiModel(apiKey: string, modelPath: string) {
    const cached = getCachedGeminiModels(apiKey);
    if (!cached) return;
    cached.delete(modelPath);
}

function pickAvailableFallbackModel(availableModels: Set<string>) {
    const preferredOrder = [
        "models/gemini-2.5-flash",
        "models/gemini-2.0-flash",
        "models/gemini-1.5-flash",
        "models/gemini-1.5-pro",
    ];

    for (const preferred of preferredOrder) {
        if (availableModels.has(preferred)) {
            return preferred;
        }
    }

    return null;
}

function extractGeminiText(data: unknown) {
    const responseData = data as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string }>;
            };
        }>;
    };

    return (
        responseData?.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text || "")
            .join("")
            .trim() || ""
    );
}

function isGeminiModelNotFound(status: number, errorBody: string) {
    const normalized = errorBody.toLowerCase();
    if (status === 404) {
        return true;
    }

    return normalized.includes("model") && normalized.includes("not found");
}

export async function callGeminiGenerateContent(options: {
    apiKey: string;
    preferredModel?: string | null;
    payload: GeminiGenerateContentPayload;
    maxRetriesPerModel?: number;
}) {
    const { apiKey, preferredModel, payload, maxRetriesPerModel = 1 } = options;
    const discoveredModels = await fetchAvailableGeminiModels(apiKey);
    const baseCandidates = buildGeminiModelCandidates(preferredModel);
    const availableCandidates = discoveredModels
        ? baseCandidates.filter((modelPath) => discoveredModels.has(modelPath))
        : baseCandidates;
    const modelCandidates =
        availableCandidates.length > 0
            ? availableCandidates
            : discoveredModels
                ? [pickAvailableFallbackModel(discoveredModels)].filter(
                    (modelPath): modelPath is string => Boolean(modelPath),
                )
                : baseCandidates;
    let lastError: Error | null = null;

    for (const modelPath of modelCandidates) {
        for (let attempt = 0; attempt <= maxRetriesPerModel; attempt += 1) {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            );

            if (response.ok) {
                const data = await response.json();
                return extractGeminiText(data);
            }

            const errorBody = await response.text();
            const status = response.status;
            const modelNotFound = isGeminiModelNotFound(status, errorBody);
            const retryable = GEMINI_RETRYABLE_STATUSES.has(status);

            const error = new Error(
                `Gemini API error (${status}) on ${modelPath}: ${errorBody}`,
            );
            lastError = error;

            if (modelNotFound) {
                rememberUnavailableGeminiModel(apiKey, modelPath);
                console.warn(`[Gemini] Model unavailable (${modelPath}), trying fallback model.`);
                break;
            }

            if (retryable && attempt < maxRetriesPerModel) {
                const backoffMs = 450 * (attempt + 1);
                await sleep(backoffMs);
                continue;
            }

            throw error;
        }
    }

    throw (
        lastError ||
        new Error("Gemini API error: no se pudo completar la solicitud con ningun modelo disponible.")
    );
}

export async function getOpenAIClient() {
    const apiKey = await resolveAiProviderKey("openai");

    if (!apiKey) {
        throw new Error(
            "OpenAI API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
    }

    return new OpenAI({ apiKey });
}

export async function generateEmbedding(text: string) {
    try {
        const openai = await getOpenAIClient();
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.replace(/\n/g, " "),
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

export async function generateEmbeddings(texts: string[]) {
    if (texts.length === 0) return [];

    try {
        const openai = await getOpenAIClient();
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: texts.map((text) => text.replace(/\n/g, " ")),
        });

        return response.data.map((item) => item.embedding);
    } catch (error) {
        console.error("Error generating embeddings:", error);
        throw error;
    }
}

export async function transcribeAudioBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    try {
        const openai = await getOpenAIClient();
        const file = await toFile(buffer, fileName, { type: mimeType });
        const response = await openai.audio.transcriptions.create({
            file,
            model: "gpt-4o-mini-transcribe",
        });

        return response.text;
    } catch (error) {
        console.error("Error transcribing audio:", error);
        throw error;
    }
}

async function runGeminiInlineMediaPrompt(
    prompt: string,
    buffer: Buffer,
    mimeType: string,
) {
    const apiKey = await resolveAiProviderKey("gemini");

    if (!apiKey) {
        throw new Error(
            "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
    }

    let settings: { openaiModel: string | null } | null = null;
    try {
        settings = await prisma.systemSettings.findFirst({
            select: {
                openaiModel: true,
            },
        });
    } catch (error) {
        console.warn("[AI OCR] Could not read stored model selection, using Gemini fallback model:", error);
    }

    const selectedModel = resolveChatModelSelection(settings?.openaiModel);
    const model =
        selectedModel.provider === "gemini"
            ? selectedModel.model
            : "gemini-2.5-flash";
    return callGeminiGenerateContent({
        apiKey,
        preferredModel: model,
        payload: {
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: buffer.toString("base64"),
                            },
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.1,
            },
        },
    });
}

export async function extractTextFromImageBuffer(
    buffer: Buffer,
    mimeType: string,
    prompt: string = DEFAULT_IMAGE_OCR_PROMPT,
) {
    const openai = await getOpenAIClient();
    const dataUrl = `data:${mimeType || "image/png"};base64,${buffer.toString("base64")}`;
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt,
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: dataUrl,
                        },
                    },
                ],
            },
        ],
    });

    return response.choices[0]?.message?.content?.trim() || "";
}

export async function extractTextFromImageBufferWithFallback(
    buffer: Buffer,
    mimeType: string,
    prompt: string = DEFAULT_IMAGE_OCR_PROMPT,
) {
    try {
        return await extractTextFromImageBuffer(buffer, mimeType, prompt);
    } catch (error) {
        console.warn("[AI OCR] OpenAI image OCR failed, trying Gemini fallback:", error);
        return runGeminiInlineMediaPrompt(prompt, buffer, mimeType || "image/png");
    }
}

export async function generateCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: number = SYSTEM_SETTINGS_DEFAULTS.agentTemperature,
) {
    try {
        const settings = await prisma.systemSettings.findFirst();
        const selectedModel = resolveChatModelSelection(
            settings?.openaiModel || SYSTEM_SETTINGS_DEFAULTS.openaiModel,
        );

        if (selectedModel.provider === "gemini") {
            const apiKey = await resolveAiProviderKey("gemini");
            if (!apiKey) {
                throw new Error(
                    "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
                );
            }

            const systemMessage = messages.find((message) => message.role === "system");
            const conversationMessages = messages.filter((message) => message.role !== "system");
            const prompt = [
                systemMessage?.content ? `INSTRUCCIONES DEL SISTEMA:\n${extractMessageText(systemMessage.content)}` : "",
                "CONVERSACION:",
                ...conversationMessages.map((message) => {
                    const role = message.role === "assistant" ? "Asistente" : "Usuario";
                    return `${role}: ${extractMessageText(message.content)}`;
                }),
            ]
                .filter(Boolean)
                .join("\n\n");
            return callGeminiGenerateContent({
                apiKey,
                preferredModel: selectedModel.model,
                payload: {
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }],
                        },
                    ],
                    generationConfig: {
                        temperature,
                    },
                },
            });
        }

        const openai = await getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: selectedModel.model,
            messages,
            temperature,
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error("Error generating completion:", error);
        throw error;
    }
}

function extractMessageText(
    content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"],
) {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => ("text" in item && typeof item.text === "string" ? item.text : ""))
            .filter(Boolean)
            .join("\n");
    }

    return "";
}
