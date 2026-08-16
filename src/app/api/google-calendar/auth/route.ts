import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { getSessionAccessSubject } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";
import {
    getGoogleCalendarAuthUrl,
    getGoogleCalendarRedirectUri,
    getPublicAppBaseUrl,
} from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.redirect(new URL("/login", getPublicAppBaseUrl(request.nextUrl.origin)));
    }
    if (!hasPermission(getSessionAccessSubject(session), "integrations.manage")) {
        return NextResponse.redirect(new URL("/dashboard", getPublicAppBaseUrl(request.nextUrl.origin)));
    }

    const redirectUri = getGoogleCalendarRedirectUri(request.nextUrl.origin);
    const state = randomUUID();
    const url = await getGoogleCalendarAuthUrl(redirectUri, state);
    const response = NextResponse.redirect(url);

    response.cookies.set("google_calendar_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 10 * 60,
    });

    return response;
}
