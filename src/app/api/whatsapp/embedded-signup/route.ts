import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { completeMetaEmbeddedSignup, getMetaConfig, getMetaSessionSnapshot } from "@/lib/meta-whatsapp";

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "integrations.manage", "No tienes permiso para conectar WhatsApp.");
    if (forbidden) return forbidden;
    try {
        const [config, snapshot] = await Promise.all([
            getMetaConfig({ requireSecrets: false }),
            getMetaSessionSnapshot(),
        ]);
        return NextResponse.json({ ok: true, ...snapshot, appId: config.appId || null, configId: config.configId || null, solutionId: config.solutionId || null });
    } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Configuracion incompleta." }, { status: 400 });
    }
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "integrations.manage", "No tienes permiso para conectar WhatsApp.");
    if (forbidden) return forbidden;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const code = text(body?.code);
    const wabaId = text(body?.wabaId);
    const phoneNumberId = text(body?.phoneNumberId);
    const businessId = text(body?.businessId);
    if (!code || !wabaId || !phoneNumberId) {
        return NextResponse.json({ ok: false, error: "Meta no devolvio code, WABA ID y Phone Number ID completos." }, { status: 400 });
    }
    try {
        const result = await completeMetaEmbeddedSignup({ code, wabaId, phoneNumberId, businessId: businessId || null });
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/inbox");
        revalidatePath("/dashboard/templates");
        return NextResponse.json({
            ok: true,
            connected: true,
            displayPhoneNumber: result.settings.whatsappDisplayPhoneNumber,
            phoneNumberId: result.settings.whatsappPhoneNumberId,
            wabaId: result.settings.whatsappWabaId,
            subscription: result.subscription,
            registration: result.registration,
        });
    } catch (error) {
        console.error("[Meta Embedded Signup]", error);
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo completar la conexion." }, { status: 500 });
    }
}
