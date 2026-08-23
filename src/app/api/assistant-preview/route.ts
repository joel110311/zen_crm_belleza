import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse, getSessionUserId } from "@/lib/authz";
import { generateAssistantPreview, type AssistantPreviewMessage } from "@/lib/ai/chatbot";
import { consumeRateLimit } from "@/lib/security";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_REQUEST_BYTES = 40_000;
const PREVIEW_RATE_LIMIT = { limit: 15, windowMs: 5 * 60 * 1000 };

function normalizeHistory(value: unknown): AssistantPreviewMessage[] {
    if (!Array.isArray(value)) return [];

    return value
        .slice(-MAX_HISTORY_MESSAGES)
        .flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const record = entry as Record<string, unknown>;
            if (record.role !== "user" && record.role !== "assistant") return [];
            if (typeof record.content !== "string") return [];
            const content = record.content.trim().slice(0, MAX_MESSAGE_LENGTH);
            return content ? [{ role: record.role, content }] : [];
        });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const denied = ensurePermissionResponse(
        session,
        "ai.manage",
        "No tienes permiso para probar el asistente.",
    );
    if (denied) return denied;

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        return NextResponse.json({ error: "La prueba es demasiado extensa." }, { status: 413 });
    }

    const userId = getSessionUserId(session) || "unknown";
    const rateLimit = consumeRateLimit(`assistant-preview:${userId}`, PREVIEW_RATE_LIMIT);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Alcanzaste el límite de pruebas. Espera unos minutos antes de continuar." },
            {
                status: 429,
                headers: {
                    "Retry-After": String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))),
                },
            },
        );
    }

    try {
        const body = await request.json();
        const message = typeof body?.message === "string"
            ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH)
            : "";
        if (!message) {
            return NextResponse.json({ error: "Escribe un mensaje para realizar la prueba." }, { status: 400 });
        }

        const result = await generateAssistantPreview({
            message,
            history: normalizeHistory(body?.history),
        });
        return NextResponse.json(result, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        console.error("[AssistantPreview] Failed to generate preview:", error);
        return NextResponse.json(
            { error: "No se pudo generar la prueba. Revisa la clave y el modelo de IA configurados." },
            { status: 500 },
        );
    }
}
