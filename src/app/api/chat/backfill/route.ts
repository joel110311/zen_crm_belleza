import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import {
    backfillMissingActiveConversations,
    getConversationCoverageSnapshot,
} from "@/lib/conversation-coverage";

export async function GET() {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "settings.manage", "No autorizado.");
        if (forbidden) return forbidden;

        const snapshot = await getConversationCoverageSnapshot();
        return NextResponse.json({ success: true, snapshot });
    } catch (error) {
        console.error("[Chat Backfill] Failed to get coverage snapshot:", error);
        return NextResponse.json(
            { error: "No se pudo consultar el estado de chats." },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "settings.manage", "No autorizado.");
        if (forbidden) return forbidden;

        const body = await request.json().catch(() => ({}));
        const dryRun = Boolean(body?.dryRun);
        const result = await backfillMissingActiveConversations({ dryRun });

        return NextResponse.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error("[Chat Backfill] Failed to run chat backfill:", error);
        return NextResponse.json(
            { error: "No se pudo reparar la cobertura de chats." },
            { status: 500 },
        );
    }
}
