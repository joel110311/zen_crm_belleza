import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { disconnectMetaWhatsApp, getMetaSessionSnapshot } from "@/lib/meta-whatsapp";

export async function GET() {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "integrations.manage", "No tienes permiso para consultar WhatsApp.");
    if (forbidden) return forbidden;
    return NextResponse.json(await getMetaSessionSnapshot());
}

export async function DELETE() {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "integrations.manage", "No tienes permiso para desconectar WhatsApp.");
    if (forbidden) return forbidden;
    await disconnectMetaWhatsApp();
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/inbox");
    return NextResponse.json({ ok: true });
}
