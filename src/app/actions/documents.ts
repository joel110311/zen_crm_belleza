"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

import { generateEmbedding } from "@/lib/ai/openai";
// Polyfill DOMMatrix for pdf-parse in Node environment
// @ts-ignore
if (!global.DOMMatrix) {
    // @ts-ignore
    global.DOMMatrix = class DOMMatrix {
        constructor() {
            // @ts-ignore
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
        toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
    };
}

const pdf = require("pdf-parse");

export async function uploadDocument(formData: FormData) {
    try {
        const file = formData.get("file") as File;
        if (!file) {
            throw new Error("No file provided");
        }

        let textContent = "";
        const buffer = Buffer.from(await file.arrayBuffer());

        if (file.type === "application/pdf") {
            const data = await pdf(buffer);
            textContent = data.text;
        } else {
            // Assume text/plain or similar
            textContent = buffer.toString("utf-8");
        }

        // Clean up text (remove excessive newlines)
        textContent = textContent.replace(/\n\s*\n/g, "\n").trim();

        if (!textContent) {
            throw new Error("Could not extract text from file");
        }

        // Generate Embedding
        const embedding = await generateEmbedding(textContent.substring(0, 8000)); // Limit size for embedding model

        // Store in DB
        // We use $executeRaw for vector insertion if Prisma doesn't support it directly yet for the specific type
        // But let's try standard create first, if existing 'embedding' field is handled as Unsupported

        // Since 'embedding' is Unsupported("vector"), we likely need raw SQL to insert it.
        // First create the document without embedding
        const doc = await prisma.document.create({
            data: {
                title: file.name,
                content: textContent,
            },
        });

        // Update with embedding using raw SQL
        const embeddingVector = `[${embedding.join(",")}]`;
        await prisma.$executeRaw`
            UPDATE "Document"
            SET embedding = ${embeddingVector}::vector
            WHERE id = ${doc.id}
        `;

        revalidatePath("/dashboard/brain/knowledge");
        return { success: true };
    } catch (error) {
        console.error("Failed to upload document:", error);
        return { success: false, error: "Failed to upload document" };
    }
}

export async function getDocuments() {
    try {
        return await prisma.document.findMany({
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.error("Failed to get documents:", error);
        return [];
    }
}

export async function deleteDocument(id: string) {
    try {
        await prisma.document.delete({
            where: { id },
        });
        revalidatePath("/dashboard/brain/knowledge");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete document:", error);
        return { success: false, error: "Failed to delete document" };
    }
}
