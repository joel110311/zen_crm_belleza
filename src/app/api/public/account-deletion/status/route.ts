import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getControlDb } from "@/lib/control-db";
import { consumeSharedRateLimit, getRequestIp, isSameApplicationOrigin } from "@/lib/security";

export async function POST(request: Request) {
    if (!isSameApplicationOrigin(request)) return new NextResponse(null, { status: 403 });
    const limit = await consumeSharedRateLimit({ scope: "deletion-status", identifiers: [getRequestIp(request.headers)], limit: 30, windowMs: 60000 });
    if (!limit.allowed) return new NextResponse(null, { status: 429 });
    const body = await request.json().catch(() => null);
    if (typeof body?.receipt !== "string" || !/^[a-f0-9]{64}$/.test(body.receipt)) return new NextResponse(null, { status: 400 });
    const job = await getControlDb().accountDeletion.findUnique({ where: { tokenHash: crypto.createHash("sha256").update(body.receipt).digest("hex") }, select: { status: true, completedAt: true } });
    return NextResponse.json(job || { status: "NOT_FOUND" }, { headers: { "Cache-Control": "no-store" } });
}
