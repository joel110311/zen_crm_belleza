import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { getActiveCampaignChannels } from "@/lib/campaign-channels";

export async function GET() {
    const forbidden = ensurePermissionResponse(await auth(), "campaigns.manage", "No tienes permiso para administrar campañas.");
    if (forbidden) return forbidden;
    try {
        return NextResponse.json({ channels: await getActiveCampaignChannels() }, { headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ channels: [], error: "No se pudieron verificar los canales." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
