import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { controlApiError } from "@/lib/control-api-errors";
import { getPlatformModelCatalog } from "@/lib/ai/platform-model-catalog";
export const runtime = "nodejs";
export async function GET() {
    try { await requirePlatformAdmin(); return NextResponse.json(await getPlatformModelCatalog(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { const result = controlApiError(error); return NextResponse.json({ error: result.message }, { status: result.status }); }
}
