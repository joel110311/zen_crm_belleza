import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { controlApiError, ControlValidationError } from "@/lib/control-api-errors";
import { isSameApplicationOrigin } from "@/lib/security";
import { getPlatformAiControlState, savePlatformAiRuntime } from "@/lib/ai/platform-runtime";

export const runtime = "nodejs";
export async function GET() {
    try { await requirePlatformAdmin(); return NextResponse.json(await getPlatformAiControlState(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { const result = controlApiError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}
export async function PATCH(request: NextRequest) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        const text = await request.text();
        if (Buffer.byteLength(text, "utf8") > 64_000) throw new ControlValidationError("La configuración es demasiado extensa.");
        let body: unknown;
        try { body = JSON.parse(text); } catch { throw new ControlValidationError("El cuerpo JSON no es válido."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ControlValidationError("La configuración no es válida.");
        return NextResponse.json(await savePlatformAiRuntime(body as Record<string, unknown>, admin.id));
    } catch (error) {
        const result = controlApiError(error);
        // Do not log request bodies, provider responses or encryption failures.
        return NextResponse.json({ error: result.message }, { status: result.status });
    }
}
