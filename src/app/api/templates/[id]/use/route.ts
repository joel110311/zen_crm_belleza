import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

function ensureAuthenticated(session: unknown) {
    if (!(session as { user?: { id?: string } } | null)?.user?.id) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return null;
}

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;
        const templateRepo = prisma.template as any;

        const { id } = await params;
        const template = await templateRepo.update({
            where: { id },
            data: {
                usageCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        return NextResponse.json({ success: true, template });
    } catch (error) {
        console.error("[Templates] use failed:", error);
        return NextResponse.json({ error: "No se pudo registrar el uso de la plantilla" }, { status: 500 });
    }
}
