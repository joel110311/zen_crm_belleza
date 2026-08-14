import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse, getSessionUserId } from "@/lib/authz";
import {
    createBulkCampaign,
    listBulkCampaigns,
    normalizeBulkCampaignPayload,
} from "@/lib/bulk-campaigns";

export async function GET() {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "campaigns.manage", "No tienes permiso para administrar campañas.");
        if (forbidden) return forbidden;

        const campaigns = await listBulkCampaigns();
        return NextResponse.json({ campaigns });
    } catch (error) {
        console.error("[BulkCampaigns] GET failed:", error);
        return NextResponse.json({ error: "No se pudieron cargar las campañas" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "campaigns.manage", "No tienes permiso para administrar campañas.");
        if (forbidden) return forbidden;

        const body = await request.json();
        const campaign = await createBulkCampaign(
            normalizeBulkCampaignPayload(body),
            getSessionUserId(session),
        );

        return NextResponse.json({ success: true, campaign });
    } catch (error) {
        console.error("[BulkCampaigns] POST failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo crear la campaña" },
            { status: 400 },
        );
    }
}
