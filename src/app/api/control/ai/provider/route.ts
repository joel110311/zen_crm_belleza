import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { controlApiError, ControlValidationError } from "@/lib/control-api-errors";
import { consumeRateLimit, isSameApplicationOrigin } from "@/lib/security";
import { compatibleChatEndpoint } from "@/lib/ai/platform-router-config";
import { resolvePlatformProviderCredential } from "@/lib/ai/platform-runtime";
import { PlatformAiHttpError, requestCompatibleAi, requestCompatibleModels } from "@/lib/ai/platform-compatible-transport";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        if (!consumeRateLimit(`platform-ai-diagnostic:${admin.id}`, { limit: 30, windowMs: 60_000 }).allowed) return NextResponse.json({ error: "Espera un momento antes de repetir la consulta." }, { status: 429 });
        const text = await request.text();
        if (Buffer.byteLength(text) > 8000) throw new ControlValidationError("La consulta es demasiado extensa.");
        let body: Record<string, unknown>;
        try { body = JSON.parse(text); } catch { throw new ControlValidationError("La consulta no es válida."); }
        if (!body || typeof body !== "object" || Array.isArray(body) || !["models", "test"].includes(String(body.action))) throw new ControlValidationError("Selecciona una consulta válida.");
        const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
        const draftKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        if (baseUrl.length > 500 || draftKey.length > 4096 || /[\r\n]/.test(draftKey)) throw new ControlValidationError("Revisa el endpoint y la clave.");
        try { compatibleChatEndpoint(baseUrl); } catch { throw new ControlValidationError("Usa un endpoint HTTPS público, sin credenciales ni parámetros."); }
        const key = await resolvePlatformProviderCredential(typeof body.id === "string" ? body.id : "", baseUrl, draftKey);
        const signal = AbortSignal.timeout(8000), started = Date.now();
        if (body.action === "models") return NextResponse.json({ models: await requestCompatibleModels(baseUrl, key, signal) }, { headers: { "Cache-Control": "no-store" } });
        const model = typeof body.model === "string" ? body.model.trim() : "";
        if (!model || model.length > 150) throw new ControlValidationError("Selecciona un modelo antes de probar.");
        await requestCompatibleAi(baseUrl, key, { model, messages: [{ role: "user", content: "Responde únicamente OK." }], max_tokens: 512, stream: false }, signal);
        return NextResponse.json({ responded: true, elapsedMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        if (error instanceof PlatformAiHttpError) return NextResponse.json({ error: `El endpoint respondió HTTP ${error.status}. Revisa la credencial, el modelo y su disponibilidad.` }, { status: 400 });
        if (error instanceof ControlValidationError || (typeof error === "object" && error && "status" in error)) {
            const result = controlApiError(error); return NextResponse.json({ error: result.message }, { status: result.status });
        }
        return NextResponse.json({ error: "No se pudo obtener una respuesta válida del endpoint. Comprueba la URL o intenta de nuevo." }, { status: 502 });
    }
}
