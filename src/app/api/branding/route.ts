import { NextResponse } from "next/server";
import { resolveBranding } from "@/lib/branding";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

export async function GET() {
    try {
        const settings = await getSystemSettingsOrDefaults();

        return NextResponse.json(resolveBranding(settings), {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        console.error("[API] Failed to get branding:", error);

        return NextResponse.json(resolveBranding(null), {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    }
}
