import { NextResponse } from "next/server";
import { ACTIVE_TENANT_COOKIE } from "@/lib/tenant-request-routing";
import { withTenantApi } from "@/lib/tenant-api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    return withTenantApi(request, tenantSlug, { permission: "contacts.read" }, async (tenant) => {
        const response = NextResponse.json({ active: true });
        response.cookies.set(ACTIVE_TENANT_COOKIE, tenant.slug, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
        });
        return response;
    });
}
