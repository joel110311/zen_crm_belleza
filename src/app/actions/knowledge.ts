"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
    extractTextFromFileBuffer,
    processKnowledgeSource,
} from "@/lib/brain/knowledge";

type CreateKnowledgeSourceInput = {
    title?: string;
    type: "text" | "website" | "crawl" | "sitemap" | "github" | "youtube";
    sourceUri?: string;
    rawContent?: string;
    metadata?: Record<string, unknown>;
};

function defaultTitle(type: string, sourceUri?: string, rawContent?: string) {
    if (sourceUri) return sourceUri;
    if (type === "text" && rawContent) return rawContent.slice(0, 48);
    return "Nueva fuente";
}

function sanitizeSourceMetadata(metadata?: Record<string, unknown>) {
    if (!metadata) {
        return undefined;
    }

    const cleanedEntries = Object.entries(metadata).filter(([, value]) => {
        if (value === null || value === undefined) {
            return false;
        }

        if (typeof value === "string") {
            return value.trim().length > 0;
        }

        return true;
    });

    if (cleanedEntries.length === 0) {
        return undefined;
    }

    return Object.fromEntries(cleanedEntries) as Prisma.InputJsonValue;
}

function toKnowledgeActionErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la fuente.";

    if (
        message.includes("systemSettings.findFirst") ||
        message.includes("ECONNREFUSED") ||
        message.includes("API Key not configured")
    ) {
        return "El archivo parece requerir OCR para poder leerse. Revisa en Configuracion > IA que haya una clave valida de OpenAI o Gemini y vuelve a intentarlo.";
    }

    return message;
}

export async function getKnowledgeSources() {
    try {
        return await prisma.knowledgeSource.findMany({
            select: {
                id: true,
                title: true,
                type: true,
                status: true,
                sourceUri: true,
                mimeType: true,
                error: true,
                chunkCount: true,
                syncedAt: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
        });
    } catch (error) {
        console.error("Failed to get knowledge sources:", error);
        return [];
    }
}

export async function createKnowledgeSource(input: CreateKnowledgeSourceInput) {
    try {
        if (!input.type) {
            throw new Error("El tipo de fuente es requerido.");
        }

        if (input.type === "text" && !input.rawContent?.trim()) {
            throw new Error("Necesitas escribir el contenido de la nota.");
        }

        if (input.type !== "text" && !input.sourceUri?.trim()) {
            throw new Error("Necesitas indicar la URL o recurso a indexar.");
        }

        const source = await prisma.knowledgeSource.create({
            data: {
                title: (input.title || defaultTitle(input.type, input.sourceUri, input.rawContent)).trim(),
                type: input.type,
                sourceUri: input.sourceUri?.trim() || null,
                rawContent:
                    input.type === "text"
                        ? (input.rawContent ?? null)
                        : (input.rawContent?.trim() || null),
                metadata: sanitizeSourceMetadata(input.metadata),
                status: "pending",
            },
        });

        void processKnowledgeSource(source.id).catch((error) => {
            console.error("Knowledge source processing failed:", error);
        });

        revalidatePath("/dashboard/brain");
        return { success: true, source };
    } catch (error) {
        return {
            success: false,
            error: toKnowledgeActionErrorMessage(error),
        };
    }
}

export async function uploadKnowledgeFile(formData: FormData) {
    try {
        const file = formData.get("file") as File | null;
        if (!file) {
            throw new Error("No se recibio ningun archivo.");
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const rawContent = await extractTextFromFileBuffer(
            buffer,
            file.name,
            file.type || "application/octet-stream",
        );

        if (!rawContent.trim()) {
            throw new Error("No pude extraer contenido util del archivo.");
        }

        const source = await prisma.knowledgeSource.create({
            data: {
                title: file.name,
                type: "file",
                rawContent,
                mimeType: file.type || "application/octet-stream",
                status: "pending",
                metadata: {
                    originalFileName: file.name,
                },
            },
        });

        void processKnowledgeSource(source.id).catch((error) => {
            console.error("Knowledge file processing failed:", error);
        });

        revalidatePath("/dashboard/brain");
        return { success: true, source };
    } catch (error) {
        return {
            success: false,
            error: toKnowledgeActionErrorMessage(error),
        };
    }
}

export async function reindexKnowledgeSource(sourceId: string) {
    try {
        await processKnowledgeSource(sourceId);
        revalidatePath("/dashboard/brain");
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: toKnowledgeActionErrorMessage(error),
        };
    }
}

export async function deleteKnowledgeSource(sourceId: string) {
    try {
        await prisma.knowledgeSource.delete({
            where: { id: sourceId },
        });
        revalidatePath("/dashboard/brain");
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: toKnowledgeActionErrorMessage(error),
        };
    }
}

export async function downloadKnowledgeSourceText(sourceId: string) {
    try {
        const source = await prisma.knowledgeSource.findUnique({
            where: { id: sourceId },
            select: {
                id: true,
                title: true,
                type: true,
                rawContent: true,
            },
        });

        if (!source) {
            throw new Error("La fuente no existe.");
        }

        if (source.type !== "text") {
            throw new Error("Solo las fuentes tipo Texto se pueden descargar como TXT.");
        }

        if (!source.rawContent?.length) {
            throw new Error("Esta fuente no tiene texto original guardado.");
        }

        return {
            success: true,
            title: source.title,
            rawContent: source.rawContent,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "No se pudo descargar el texto.",
        };
    }
}
