import { NextResponse } from "next/server";
import { resolveBranding, resolveTenantBranding } from "@/lib/branding";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";

export async function GET() {
    try {
        const tenant = await getActiveTenantRuntimeContext("read");
        if (isMultitenantRuntimeEnabled() && !tenant) {
            return NextResponse.json(resolveBranding(null), {
                headers: { "Cache-Control": "no-store" },
            });
        }
        const settings = await getSystemSettingsOrDefaults();

        return NextResponse.json(tenant ? resolveTenantBranding(settings, tenant.displayName) : resolveBranding(settings), {
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
