import { NextResponse } from "next/server";
import { isMultitenantPrivateStorageEnabled } from "@/lib/multitenant-features";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createPrivateFilePublicToken } from "@/lib/tenant-private-files";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; fileId: string }> }) {
    const { tenantSlug, fileId } = await params;
    if (!isMultitenantPrivateStorageEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "files.write" }, async (tenant) => {
        const body = asRecord(await readTenantJson(request));
        const expiresInMinutes = typeof body.expiresInMinutes === "number" ? body.expiresInMinutes : Number(body.expiresInMinutes);
        const result = await createPrivateFilePublicToken({ db: tenant.db, fileId, expiresInMinutes });
        return tenantData({
            expiresAt: result.expiresAt.toISOString(),
            url: `${new URL(request.url).origin}/api/public/t/${encodeURIComponent(tenant.slug)}/v1/files/${encodeURIComponent(result.token)}`,
        }, tenant.requestId, 201);
    });
}
