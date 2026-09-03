import { getToken, type JWT } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

const protectedRoutes: Array<{ prefix: string; permission: PermissionKey }> = [
    { prefix: "/dashboard/contacts", permission: "contacts.manage" },
    { prefix: "/dashboard/patients", permission: "patients.manage" },
    { prefix: "/dashboard/reception", permission: "reception.manage" },
    { prefix: "/dashboard/billing", permission: "billing.manage" },
    { prefix: "/dashboard/reports", permission: "reports.view" },
    { prefix: "/dashboard/inbox", permission: "chats.manage" },
    { prefix: "/dashboard/templates", permission: "templates.manage" },
    { prefix: "/dashboard/calendar", permission: "calendar.manage" },
    { prefix: "/dashboard/brain", permission: "ai.manage" },
];

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Public paths that don't require authentication
    const publicPaths = [
        "/login",
        "/signup",
        "/verify-email",
        "/forgot-password",
        "/reset-password",
        "/terms",
        "/privacy",
        "/portal",
        "/invitations",
        "/google-calendar",
        "/legal",
        "/api/auth",
        "/api/public",
        "/api/branding",
        "/api/webhook",
        "/api/webhooks",
        "/api/bot-message",
        "/api/health",
        "/api/operation-context",
    ];
    const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

    if (isPublicPath) {
        return NextResponse.next();
    }

    // Tenant API routes enforce control-plane authentication, membership, access mode and
    // role permissions in withTenantApi. Let them return their stable JSON 401/403/404
    // contract instead of turning API calls into HTML redirects to /login.
    if (pathname.startsWith("/api/t/")) {
        return NextResponse.next();
    }

    // Try both cookie names (HTTPS uses __Secure- prefix, HTTP uses plain)
    // Behind reverse proxies like Traefik, the internal request may be HTTP
    // but the cookie was set with __Secure- prefix because AUTH_URL is HTTPS
    let token: JWT | null = null;
    try {
        token = await getToken({
            req,
            secret: process.env.AUTH_SECRET,
            cookieName: "__Secure-authjs.session-token",
        });

        if (!token) {
            token = await getToken({
                req,
                secret: process.env.AUTH_SECRET,
                cookieName: "authjs.session-token",
            });
        }
    } catch {
        token = null;
    }

    // If not authenticated, redirect to login
    if (!token || typeof token.id !== "string" || !token.id) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("redirectTo", pathname);
        return NextResponse.redirect(loginUrl);
    }

    if (pathname.startsWith("/dashboard/pipeline")) {
        return NextResponse.redirect(new URL("/dashboard/contacts", req.url));
    }

    if (pathname.startsWith("/dashboard/patients")) {
        return NextResponse.redirect(new URL("/dashboard/contacts", req.url));
    }

    const matchedRoute = protectedRoutes.find((route) => pathname.startsWith(route.prefix));
    if (
        matchedRoute &&
        !hasPermission(
            {
                role: typeof token.role === "string" ? token.role : undefined,
                permissions: token.permissions,
            },
            matchedRoute.permission,
        )
    ) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav|ogg|woff|woff2|ttf|otf)$).*)",
    ],
};
