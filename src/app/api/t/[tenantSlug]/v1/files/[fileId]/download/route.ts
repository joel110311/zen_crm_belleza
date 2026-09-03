import { NextResponse } from "next/server";
import { isMultitenantPrivateStorageEnabled } from "@/lib/multitenant-features";
import { withTenantApi } from "@/lib/tenant-api";
import { getPrivateFileDownload } from "@/lib/tenant-private-files";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string; fileId: string }> }) {
    const { tenantSlug, fileId } = await params;
    if (!isMultitenantPrivateStorageEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { permission: "files.read" }, async (tenant) => {
        const { download } = await getPrivateFileDownload({ db: tenant.db, fileId });
        return NextResponse.redirect(download.url, { status: 307, headers: { "Cache-Control": "no-store", "x-request-id": tenant.requestId } });
    });
}
