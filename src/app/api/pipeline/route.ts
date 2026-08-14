import { NextResponse } from "next/server";
import { getPipelineData } from "@/app/actions/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const data = await getPipelineData();

        // Serialize dates
        const serialized = {
            stages: data.stages,
            deals: data.deals.map((d: any) => ({
                ...d,
                createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
                updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d.updatedAt),
            })),
        };

        return NextResponse.json(serialized);
    } catch (error) {
        console.error("Pipeline API error:", error);
        return NextResponse.json({ stages: [], deals: [] }, { status: 500 });
    }
}
