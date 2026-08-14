import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { getBulkCampaignAudiencePreview } from "@/lib/bulk-campaigns";
import {
    MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    normalizeBulkCampaignAudienceFilters,
} from "@/lib/bulk-campaign-audience";

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "campaigns.manage", "No tienes permiso para administrar campañas.");
        if (forbidden) return forbidden;

        const body = await request.json();
        const filters = normalizeBulkCampaignAudienceFilters(
            body?.audienceFilters,
            MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
        );
        const preview = await getBulkCampaignAudiencePreview(filters);

        return NextResponse.json({ success: true, preview });
    } catch (error) {
        console.error("[BulkCampaigns] preview failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo cargar la vista previa de audiencia" },
            { status: 400 },
        );
    }
}
