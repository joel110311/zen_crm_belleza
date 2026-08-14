import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    completeGoogleCalendarOAuth,
    getGoogleCalendarRedirectUri,
    getPublicAppBaseUrl,
    syncGoogleCalendarToCrm,
} from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.redirect(new URL("/login", getPublicAppBaseUrl(request.nextUrl.origin)));
    }

    const code = request.nextUrl.searchParams.get("code");
    const error = request.nextUrl.searchParams.get("error");
    const state = request.nextUrl.searchParams.get("state");
    const expectedState = request.cookies.get("google_calendar_oauth_state")?.value;
    const redirectUri = getGoogleCalendarRedirectUri(request.nextUrl.origin);
    const settingsUrl = new URL("/dashboard/settings?section=calendar", getPublicAppBaseUrl(request.nextUrl.origin));

    const clearStateCookie = (response: NextResponse) => {
        response.cookies.set("google_calendar_oauth_state", "", {
            httpOnly: true,
            sameSite: "lax",
            secure: request.nextUrl.protocol === "https:",
            path: "/",
            maxAge: 0,
        });
        return response;
    };

    if (error) {
        settingsUrl.searchParams.set("google", "error");
        settingsUrl.searchParams.set("reason", error);
        return clearStateCookie(NextResponse.redirect(settingsUrl));
    }

    if (!code) {
        settingsUrl.searchParams.set("google", "missing_code");
        return clearStateCookie(NextResponse.redirect(settingsUrl));
    }

    if (!state || !expectedState || state !== expectedState) {
        settingsUrl.searchParams.set("google", "error");
        settingsUrl.searchParams.set("reason", "state_mismatch");
        return clearStateCookie(NextResponse.redirect(settingsUrl));
    }

    try {
        await completeGoogleCalendarOAuth(code, redirectUri);
        await syncGoogleCalendarToCrm(true);
        settingsUrl.searchParams.set("google", "connected");
        return clearStateCookie(NextResponse.redirect(settingsUrl));
    } catch (oauthError) {
        settingsUrl.searchParams.set("google", "error");
        settingsUrl.searchParams.set("reason", oauthError instanceof Error ? oauthError.message : "oauth_failed");
        return clearStateCookie(NextResponse.redirect(settingsUrl));
    }
}
