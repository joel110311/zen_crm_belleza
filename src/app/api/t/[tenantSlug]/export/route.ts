import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireTenantContext, requireTenantRuntimeContext, TenantAccessDeniedError } from "@/lib/tenant-context";
import { workspaceExportStream } from "@/lib/billing/workspace-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
    const session = await auth();
    if (!session?.user?.id || (session.user as { authScope?: string }).authScope !== "control") return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const { tenantSlug } = await params;
    try {
        const tenant = await requireTenantContext(session.user.id, tenantSlug, "read");
        if (tenant.role !== "OWNER" || tenant.support) return NextResponse.json({ error: "Sólo el propietario puede exportar los datos del negocio." }, { status: 403 });
        const context = await requireTenantRuntimeContext(session.user.id, tenantSlug, "read");
        return new Response(workspaceExportStream(context.db, { business: context.slug, exportedAt: new Date().toISOString() }, () => requireTenantContext(session.user!.id!, tenantSlug, "read")), {
            headers: {
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Content-Disposition": `attachment; filename="datos-${context.slug}-${new Date().toISOString().slice(0, 10)}.jsonl"`,
                "Cache-Control": "private, no-store, max-age=0",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        if (error instanceof TenantAccessDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
        return NextResponse.json({ error: "No se pudo preparar la exportación." }, { status: 500 });
    }
}
