import path from "path";
import { readFile } from "fs/promises";
import { extractTextFromFileBuffer } from "@/lib/brain/knowledge";
import { callGeminiGenerateContent, getOpenAIClient, transcribeAudioBuffer } from "@/lib/ai/openai";
import { prisma } from "@/lib/db";
import { resolveChatModelSelection } from "@/lib/ai/models";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";

type InboundMediaContextInput = {
    text: string;
    type?: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
};

function isPlaceholderText(text: string) {
    const trimmed = text.trim();
    return /^\[[^\]]+\]$/u.test(trimmed);
}

async function readMediaBuffer(mediaUrl?: string | null) {
    if (!mediaUrl) return null;

    if (mediaUrl.startsWith("/uploads/")) {
        const filePath = path.join(process.cwd(), "public", mediaUrl.replace(/^\//, ""));
        return readFile(filePath);
    }

    if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
        const response = await fetch(mediaUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`No pude leer el archivo multimedia (${response.status})`);
        }

        return Buffer.from(await response.arrayBuffer());
    }

    return null;
}

async function describeImageBuffer(buffer: Buffer, mimeType: string) {
    const openai = await getOpenAIClient();
    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${buffer.toString("base64")}`;
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Describe esta imagen de WhatsApp en espanol de forma breve y util para que un bot comercial pueda entender lo que envio el usuario. Si hay texto visible, leelo. Si es un comprobante, producto, captura o documento visual, dilo claramente.",
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

async function runGeminiInlinePrompt(
    prompt: string,
    buffer: Buffer,
    mimeType: string,
) {
    const settings = await prisma.systemSettings.findFirst();
    const apiKey = await resolveAiProviderKey("gemini");

    if (!apiKey) {
        throw new Error(
            "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
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
                temperature: 0.2,
            },
        },
    });
}

async function transcribeAudioWithFallback(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    try {
        return await transcribeAudioBuffer(buffer, fileName, mimeType);
    } catch (error) {
        console.warn("[Media Understanding] OpenAI audio transcription failed, trying Gemini fallback:", error);
        return runGeminiInlinePrompt(
            "Transcribe este audio de WhatsApp en espanol. Devuelve solo la transcripcion clara y util. Si no hay voz inteligible, dilo brevemente.",
            buffer,
            mimeType || "audio/ogg",
        );
    }
}

async function describeImageWithFallback(buffer: Buffer, mimeType: string) {
    try {
        return await describeImageBuffer(buffer, mimeType);
    } catch (error) {
        console.warn("[Media Understanding] OpenAI image analysis failed, trying Gemini fallback:", error);
        return runGeminiInlinePrompt(
            "Describe esta imagen de WhatsApp en espanol de forma breve y util para un bot comercial. Si hay texto visible, leelo. Si es un comprobante, producto, captura o documento visual, dilo claramente.",
            buffer,
            mimeType || "image/jpeg",
        );
    }
}

export async function buildInboundMediaContext(input: InboundMediaContextInput) {
    const pieces: string[] = [];
    const rawText = input.text?.trim() || "";
    const hasUsefulText = rawText.length > 0 && !isPlaceholderText(rawText);

    if (hasUsefulText) {
        pieces.push(rawText);
    }

    if (!input.type || input.type === "text" || !input.mediaUrl) {
        return pieces.join("\n\n").trim() || rawText;
    }

    try {
        const buffer = await readMediaBuffer(input.mediaUrl);
        if (!buffer) {
            return pieces.join("\n\n").trim() || rawText;
        }

        if (input.type === "audio") {
            const transcript = await transcribeAudioWithFallback(
                buffer,
                input.mediaFileName || "whatsapp-audio.ogg",
                input.mediaType || "audio/ogg",
            );

            if (transcript.trim()) {
                pieces.push(`Audio transcrito del usuario:\n${transcript.trim()}`);
            }
        } else if (input.type === "image") {
            const description = await describeImageWithFallback(
                buffer,
                input.mediaType || "image/jpeg",
            );

            if (description.trim()) {
                pieces.push(`Descripcion de la imagen enviada por el usuario:\n${description.trim()}`);
            }
        } else if (input.type === "document") {
            const extractedText = await extractTextFromFileBuffer(
                buffer,
                input.mediaFileName || "documento",
                input.mediaType || "application/octet-stream",
            );

            if (extractedText.trim()) {
                pieces.push(`Contenido del documento enviado por el usuario:\n${extractedText.trim()}`);
            }
        }
    } catch (error) {
        console.error("[Media Understanding] Failed to interpret inbound media:", error);
    }

    return pieces.join("\n\n").trim() || rawText;
}

export function shouldSkipAutoReplyText(text: string) {
    return !text.trim() || isPlaceholderText(text);
}
