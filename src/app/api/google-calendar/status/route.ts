import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import {
    discoverGoogleCalendarSources,
    disconnectGoogleCalendar,
    getGoogleCalendarStatus,
    saveGoogleCalendarSources,
    syncGoogleCalendarToCrm,
} from "@/lib/google-calendar";

export async function GET() {
    const session = await auth();
    const denied = ensurePermissionResponse(session, "integrations.manage");
    if (denied) return denied;

    return NextResponse.json(await getGoogleCalendarStatus());
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const denied = ensurePermissionResponse(session, "integrations.manage");
    if (denied) return denied;

    try {
        const body = await request.json().catch(() => ({}));
        const action = body?.action as string | undefined;

        if (action === "sync") {
            const result = await syncGoogleCalendarToCrm(true);
            return NextResponse.json({
                ...(await getGoogleCalendarStatus()),
                sync: result,
            });
        }

        if (action === "discover") {
            return NextResponse.json(await discoverGoogleCalendarSources());
        }

        if (action === "save_sources") {
            const result = await saveGoogleCalendarSources(Array.isArray(body?.sources) ? body.sources : []);
            return NextResponse.json(result);
        }

        if (action === "disconnect") {
            await disconnectGoogleCalendar();
            return NextResponse.json(await getGoogleCalendarStatus());
        }

        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    } catch {
        return NextResponse.json(
            { error: "No se pudo completar la operacion de Google Calendar." },
            { status: 500 },
        );
    }
}
