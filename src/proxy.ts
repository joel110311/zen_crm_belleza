import { getToken, type JWT } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import {
    ACTIVE_TENANT_COOKIE,
    TENANT_SCOPE_HEADER,
    TENANT_SLUG_HEADER,
    TENANT_USER_HEADER,
    normalizeRequestTenantSlug,
    tenantDashboardPath,
    tenantSlugFromPath,
} from "@/lib/tenant-request-routing";

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

export async function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const forwardedHeaders = new Headers(req.headers);

    // These headers are trusted only when this middleware creates them from a verified JWT.
    // Never allow a browser or reverse proxy client to select a tenant database directly.
    forwardedHeaders.delete(TENANT_SCOPE_HEADER);
    forwardedHeaders.delete(TENANT_SLUG_HEADER);
    forwardedHeaders.delete(TENANT_USER_HEADER);

    const nextWithSanitizedHeaders = () => NextResponse.next({
        request: { headers: forwardedHeaders },
    });

    // Public paths that don't require authentication
    const publicPaths = [
        "/login",
        "/signup",
        "/verify-email",
        "/forgot-password",
        "/delete-account",
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
        "/api/internal/tenant-scheduled-work",
        "/api/operation-context",
    ];
    // The canonical application URL is the public acquisition page.  It must
    // bypass this authentication middleware just like /signup; otherwise the
    // page component never gets a chance to render the registration CTA.
    const isPublicPath = pathname === "/" || publicPaths.some((path) => pathname.startsWith(path));

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

    const tokenUserId = typeof token?.id === "string" && token.id ? token.id : null;
    const isControlSession = token?.authScope === "control";
    const pathTenantSlug = tenantSlugFromPath(pathname);
    const refererTenantSlug = (() => {
        const value = req.headers.get("referer");
        if (!value) return null;
        try {
            const referer = new URL(value);
            return referer.host === req.nextUrl.host ? tenantSlugFromPath(referer.pathname) : null;
        } catch {
            return null;
        }
    })();
    const cookieTenantSlug = normalizeRequestTenantSlug(req.cookies.get(ACTIVE_TENANT_COOKIE)?.value);
    const activeTenantSlug = pathTenantSlug || refererTenantSlug || cookieTenantSlug;

    if (tokenUserId && isControlSession && activeTenantSlug) {
        forwardedHeaders.set(TENANT_SCOPE_HEADER, "control");
        forwardedHeaders.set(TENANT_SLUG_HEADER, activeTenantSlug);
        forwardedHeaders.set(TENANT_USER_HEADER, tokenUserId);
    }

    if (isPublicPath) {
        return nextWithSanitizedHeaders();
    }

    // Tenant API routes enforce authentication and membership themselves. Keep their stable
    // JSON 401/403/404 contract instead of converting failures into an HTML login redirect.
    if (pathname.startsWith("/api/t/")) {
        return nextWithSanitizedHeaders();
    }

    // If not authenticated, redirect to login
    if (!tokenUserId) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("redirectTo", pathname);
        return NextResponse.redirect(loginUrl);
    }

    if (isControlSession) {
        // Established CRM screens still contain /dashboard links. Keep those links usable while
        // preserving the selected business in the URL and in subsequent API requests.
        if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
            if (!cookieTenantSlug) {
                return NextResponse.redirect(new URL("/", req.url));
            }
            return NextResponse.redirect(new URL(tenantDashboardPath(cookieTenantSlug, pathname), req.url));
        }

        return nextWithSanitizedHeaders();
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
                role: typeof token?.role === "string" ? token.role : undefined,
                permissions: token?.permissions,
            },
            matchedRoute.permission,
        )
    ) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return nextWithSanitizedHeaders();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|wav|ogg|woff|woff2|ttf|otf)$).*)",
    ],
};
