import { NextResponse } from "next/server";
import { isMultitenantPrivateStorageEnabled } from "@/lib/multitenant-features";
import { readTenantJson, tenantData, withTenantApi } from "@/lib/tenant-api";
import { createPrivateFileUpload } from "@/lib/tenant-private-files";
import { asRecord } from "@/lib/tenant-services/validation";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    if (!isMultitenantPrivateStorageEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return withTenantApi(request, tenantSlug, { operation: "write", permission: "files.write" }, async (tenant) => {
        const result = await createPrivateFileUpload({
            db: tenant.db,
            tenantId: tenant.tenantId,
            actorId: tenant.actor.id,
            idempotencyKey: request.headers.get("idempotency-key"),
            input: asRecord(await readTenantJson(request)),
        });
        return tenantData({
            file: {
                id: result.file.id,
                status: result.file.status,
                originalFileName: result.file.originalFileName,
                mimeType: result.file.mimeType,
                sizeBytes: result.file.sizeBytes,
                expiresAt: result.upload?.expiresAt.toISOString() || null,
            },
            upload: result.upload ? { url: result.upload.url, headers: result.upload.headers, expiresAt: result.upload.expiresAt.toISOString() } : null,
            alreadyComplete: result.alreadyComplete,
        }, tenant.requestId, result.alreadyComplete ? 200 : 201);
    });
}
