import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processDueAppointmentReminders } from "@/lib/appointment-reminders";
import { processDueBulkCampaigns } from "@/lib/bulk-campaigns";
import { getControlDb } from "@/lib/control-db";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { runWithTenantPrisma } from "@/lib/routed-prisma";
import { getTenantPrismaManager } from "@/lib/tenant-prisma-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function POST(request: NextRequest) {
    if (!isMultitenantRuntimeEnabled()) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const expectedSecret = process.env.SECURITY_HASH_SALT?.trim() || "";
    const suppliedSecret = request.headers.get("x-tenant-worker-secret")?.trim() || "";
    if (!expectedSecret || !suppliedSecret || !safeEqual(expectedSecret, suppliedSecret)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await request.json().catch(() => null) as { tenantId?: unknown } | null;
    const tenantId = typeof payload?.tenantId === "string" ? payload.tenantId.trim() : "";
    if (!tenantId) {
        return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    const tenant = await getControlDb().tenant.findFirst({
        where: {
            id: tenantId,
            status: "READY",
            provisioningStatus: "SUCCEEDED",
            accessMode: "FULL",
            database: { status: "READY" },
        },
        select: { id: true },
    });
    if (!tenant) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const tenantDb = await getTenantPrismaManager().getForTenant(tenant.id);
    const result = await runWithTenantPrisma(tenantDb, async () => {
        await processDueBulkCampaigns();
        return processDueAppointmentReminders();
    });

    return NextResponse.json({
        success: true,
        remindersProcessed: result.processed,
    });
}
