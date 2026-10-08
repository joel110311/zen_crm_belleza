import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { getControlDb } from "@/lib/control-db";
import { controlApiError, ControlValidationError } from "@/lib/control-api-errors";
import { isSameApplicationOrigin } from "@/lib/security";
import { startPlatformSupport, endPlatformSupport } from "@/lib/platform-support";
import { ACTIVE_TENANT_COOKIE } from "@/lib/tenant-request-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
    const { status, message } = controlApiError(error);
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
    try {
        await requirePlatformAdmin();
        const params = new URL(request.url).searchParams;
        const page = Math.max(0, Math.min(100000, Number(params.get("page") || 0)));
        if (!Number.isSafeInteger(page)) throw new ControlValidationError("Página no válida.");
        const query = (params.get("q") || "").trim().slice(0, 120);
        const where = query ? { OR: [{ displayName: { contains: query, mode: "insensitive" as const } }, { slug: { contains: query, mode: "insensitive" as const } }] } : {};
        const db = getControlDb();
        const [total, tenants] = await Promise.all([
            db.tenant.count({ where }),
            db.tenant.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: page * 50, take: 50,
                select: { id: true, slug: true, displayName: true, status: true, accessMode: true, createdAt: true } }),
        ]);
        return NextResponse.json({ tenants, total, page, pageSize: 50 }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
}
async function readBody(request: Request) {
    const body = await request.json().catch(() => { throw new ControlValidationError("JSON no válido."); });
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ControlValidationError("JSON no válido.");
    return body as Record<string, unknown>;
}
export async function POST(request: Request) {
    if (!request.headers.get("origin") || !isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        const result = await startPlatformSupport(admin.id, await readBody(request));
        const response = NextResponse.json({ destination: result.destination }, { headers: { "Cache-Control": "no-store" } });
        // Update routing before navigation/legacy links. The grant, never this cookie,
        // remains the source of authorization (including the optional read-only mode).
        response.cookies.set(ACTIVE_TENANT_COOKIE, result.grant.slug, {
            httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 60,
        });
        return response;
    } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
    if (!request.headers.get("origin") || !isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    try {
        const admin = await requirePlatformAdmin();
        await endPlatformSupport(admin.id, (await readBody(request)).grantId);
        return NextResponse.json({ ended: true });
    } catch (error) { return failure(error); }
}
