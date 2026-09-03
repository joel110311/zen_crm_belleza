import { NextResponse } from "next/server";
import { isMultitenantPrivateStorageEnabled } from "@/lib/multitenant-features";
import { withPublicTenantPortalApi } from "@/lib/public-tenant-portal";
import { getPublicPrivateFileDownload } from "@/lib/tenant-private-files";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string; token: string }> }) {
    const { tenantSlug, token } = await params;
    if (!isMultitenantPrivateStorageEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withPublicTenantPortalApi(request, tenantSlug, async (tenant, requestId) => {
        const result = await getPublicPrivateFileDownload(tenant.db, token);
        if (!result) return NextResponse.json({ error: { code: "NOT_FOUND", message: "No se encontró el archivo.", requestId } }, { status: 404, headers: { "x-request-id": requestId } });
        return NextResponse.redirect(result.download.url, { status: 307, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
    });
}
