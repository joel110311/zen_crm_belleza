import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import {
    cancelBulkCampaign,
    pauseBulkCampaign,
    resumeBulkCampaign,
    startBulkCampaign,
} from "@/lib/bulk-campaigns";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "campaigns.manage", "No tienes permiso para controlar campañas.");
        if (forbidden) return forbidden;

        const body = await request.json();
        const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
        const { id } = await params;

        let campaign;
        switch (action) {
            case "start":
                campaign = await startBulkCampaign(id);
                break;
            case "pause":
                campaign = await pauseBulkCampaign(id);
                break;
            case "resume":
                campaign = await resumeBulkCampaign(id);
                break;
            case "cancel":
                campaign = await cancelBulkCampaign(id);
                break;
            default:
                return NextResponse.json({ error: "Accion no soportada" }, { status: 400 });
        }

        return NextResponse.json({ success: true, campaign });
    } catch (error) {
        console.error("[BulkCampaigns] control failed:", error);
        const message = error instanceof Error ? error.message : "No se pudo ejecutar la accion";
        const status = message === "Campana no encontrada" ? 404 : 400;
        return NextResponse.json({ error: message }, { status });
    }
}
