import { NextResponse } from "next/server";
import { isMultitenantPrivateStorageEnabled } from "@/lib/multitenant-features";
import { tenantData, withTenantApi } from "@/lib/tenant-api";
import { deletePrivateFile } from "@/lib/tenant-private-files";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ tenantSlug: string; fileId: string }> }) {
    const { tenantSlug, fileId } = await params;
    if (!isMultitenantPrivateStorageEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "files.write" }, async (tenant) => {
        const file = await deletePrivateFile({ db: tenant.db, tenantId: tenant.tenantId, fileId });
        return tenantData({ file: { id: file.id, status: file.status, deletedAt: file.deletedAt?.toISOString() || null } }, tenant.requestId);
    });
}
