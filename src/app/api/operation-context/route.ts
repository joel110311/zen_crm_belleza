import { NextResponse } from "next/server";
import { buildOperationContext } from "@/lib/operation-context";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

export async function GET() {
    const settings = await getSystemSettingsOrDefaults();
    return NextResponse.json(buildOperationContext(settings));
}
