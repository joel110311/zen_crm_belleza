import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deletionPreview, requestAccountDeletion } from "@/lib/account-deletion";
import { consumeSharedRateLimit, isSameApplicationOrigin } from "@/lib/security";

export async function GET() {
    const session = await auth();
    const user = session?.user as { id?: unknown; authScope?: unknown } | undefined;
    if (typeof user?.id !== "string" || user.authScope !== "control") return NextResponse.json({ error: "Inicia sesión en tu cuenta." }, { status: 401 });
    return NextResponse.json({ businesses: await deletionPreview(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
    if (!isSameApplicationOrigin(request)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
    const session = await auth();
    const user = session?.user as { id?: unknown; authScope?: unknown } | undefined;
    if (typeof user?.id !== "string" || user.authScope !== "control") return NextResponse.json({ error: "Inicia sesión en tu cuenta." }, { status: 401 });
    const limit = await consumeSharedRateLimit({ scope: "account-deletion", identifiers: [user.id], limit: 5, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
    try {
        await requestAccountDeletion(user.id, await request.json());
        return NextResponse.json({ status: "PENDING" }, { status: 202 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo solicitar la eliminación." }, { status: 400 });
    }
}
