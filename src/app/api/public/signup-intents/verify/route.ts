import { NextRequest, NextResponse } from "next/server";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";
import { verifySignupIntent } from "@/lib/public-auth";
import { isSameApplicationOrigin } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    if (!isPublicTenantSignupEnabled()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ verified: false }, { status: 403 });
    let body: { token?: unknown };
    try {
        body = await request.json() as { token?: unknown };
    } catch {
        return NextResponse.json({ verified: false }, { status: 400 });
    }
    const token = typeof body.token === "string" ? body.token : "";
    try {
        const result = await verifySignupIntent(token);
        return NextResponse.json(result ? { verified: true, ...result } : { verified: false });
    } catch {
        return NextResponse.json({ verified: false }, { status: 400 });
    }
}
