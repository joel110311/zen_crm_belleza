import { NextResponse } from "next/server";
import { getPipelineData } from "@/app/actions/pipeline";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await auth();
    const denied = ensurePermissionResponse(session, "contacts.manage");
    if (denied) return denied;

    try {
        const data = await getPipelineData();

        // Serialize dates
        const serialized = {
            stages: data.stages,
            deals: data.deals.map((deal) => ({
                ...deal,
                createdAt: deal.createdAt instanceof Date ? deal.createdAt.toISOString() : String(deal.createdAt),
                updatedAt: deal.updatedAt instanceof Date ? deal.updatedAt.toISOString() : String(deal.updatedAt),
            })),
        };

        return NextResponse.json(serialized);
    } catch (error) {
        console.error("Pipeline API error:", error);
        return NextResponse.json({ stages: [], deals: [] }, { status: 500 });
    }
}
