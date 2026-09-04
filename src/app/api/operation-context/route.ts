import { NextResponse } from "next/server";
import { buildOperationContext } from "@/lib/operation-context";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { withSettingsDefaults } from "@/lib/system-settings-defaults";

export async function GET() {
    if (isMultitenantRuntimeEnabled() && !(await getActiveTenantRuntimeContext("read"))) {
        return NextResponse.json(buildOperationContext(withSettingsDefaults(null)));
    }
    const settings = await getSystemSettingsOrDefaults();
    return NextResponse.json(buildOperationContext(settings));
}
