import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
    WuzapiConfigError,
    connectWuzapiSession,
    disconnectWuzapiSession,
    deleteWuzapiInstance,
    ensureWuzapiUserToken,
    getWuzapiQrCode,
    getWuzapiSessionStatus,
    logoutWuzapiSession,
    provisionWuzapiInstance,
} from "@/lib/wuzapi";
import { clearCrmChatHistory, importWhatsAppHistory } from "@/lib/whatsapp-history-import";
import { getMetaSessionSnapshot } from "@/lib/meta-whatsapp";
import { auth } from "@/lib/auth";
import { getSessionAccessSubject, getSessionUserId } from "@/lib/authz";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";

async function authorizeWhatsAppSession(write = false) {
    const session = await auth();
    if (!getSessionUserId(session)) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const subject = getSessionAccessSubject(session);
    const allowed = write
        ? hasPermission(subject, "integrations.manage")
        : hasAnyPermission(subject, ["integrations.manage", "chats.manage"]);
    return allowed ? null : NextResponse.json({ error: "Sin permiso" }, { status: 403 });
}

export async function GET(request: NextRequest) {
    const denied = await authorizeWhatsAppSession(false);
    if (denied) return denied;

    let meta = { metaConfigured: false, metaConnected: false, phoneNumberId: null as string | null };

    try {
        meta = { ...meta, ...(await getMetaSessionSnapshot()) };
        const includeQr = request.nextUrl.searchParams.get("includeQr") === "1";
        const status = await getWuzapiSessionStatus();

        let qrCode: string | undefined;
        if (includeQr && !status.loggedIn) {
            try {
                const qr = await getWuzapiQrCode();
                qrCode = qr.QRCode || status.qrcode || undefined;
            } catch {
                qrCode = status.qrcode || undefined;
            }
        }

        return NextResponse.json({
            configured: true,
            ...meta,
            ...status,
            qrCode,
        });
    } catch (error) {
        if (error instanceof WuzapiConfigError) {
            return NextResponse.json(
                { configured: false, ...meta, error: error.message },
                { status: 200 },
            );
        }

        return NextResponse.json(
            { configured: true, ...meta, error: error instanceof Error ? error.message : "No se pudo consultar WhatsApp" },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    const denied = await authorizeWhatsAppSession(true);
    if (denied) return denied;

    try {
        const { action, months, clearChats } = await request.json();

        if (!action) {
            return NextResponse.json({ error: "action es requerido" }, { status: 400 });
        }

        if (action === "provision") {
            await ensureWuzapiUserToken();
            const result = await provisionWuzapiInstance(request.nextUrl.origin);
            return NextResponse.json({ success: true, ...result });
        }

        if (action === "connect") {
            await ensureWuzapiUserToken();
            await provisionWuzapiInstance(request.nextUrl.origin);
            await connectWuzapiSession();
            const status = await getWuzapiSessionStatus();
            let qrCode: string | undefined;
            if (!status.loggedIn) {
                try {
                    const qr = await getWuzapiQrCode();
                    qrCode = qr.QRCode || status.qrcode || undefined;
                } catch {
                    qrCode = status.qrcode || undefined;
                }
            }

            return NextResponse.json({
                success: true,
                ...status,
                qrCode,
            });
        }

        if (action === "disconnect") {
            await disconnectWuzapiSession();
            const status = await getWuzapiSessionStatus().catch(() => ({
                connected: false,
                loggedIn: true,
            }));
            return NextResponse.json({ success: true, ...status });
        }

        if (action === "logout") {
            await logoutWuzapiSession();
            return NextResponse.json({ success: true });
        }

        if (action === "delete") {
            await deleteWuzapiInstance();
            if (clearChats) {
                await clearCrmChatHistory();
                revalidatePath("/dashboard/inbox");
                revalidatePath("/dashboard/contacts");
            }

            return NextResponse.json({
                success: true,
                deleted: true,
                clearedChats: Boolean(clearChats),
            });
        }

        if (action === "importHistory") {
            const summary = await importWhatsAppHistory({
                months: months === 3 ? 3 : months === 2 ? 2 : 1,
            });

            revalidatePath("/dashboard/inbox");
            revalidatePath("/dashboard/contacts");
            revalidatePath("/dashboard/templates");

            return NextResponse.json({
                success: true,
                summary,
            });
        }

        return NextResponse.json({ error: "Accion no soportada" }, { status: 400 });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo ejecutar la accion de WhatsApp" },
            { status: 500 },
        );
    }
}
