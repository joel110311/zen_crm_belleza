import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { isLegacyApplicationRequest } from "@/lib/application-host";
import { isGoogleSignInEnabled } from "@/lib/google-signin";

export const dynamic = "force-dynamic";

export async function GET() {
    const requestHeaders = await headers();
    return NextResponse.json(
        { google: isGoogleSignInEnabled() && !isLegacyApplicationRequest(requestHeaders) },
        { headers: { "Cache-Control": "no-store" } },
    );
}
