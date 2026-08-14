import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyPermission, hasPermission, type PermissionKey } from "@/lib/permissions";

export function getSessionAccessSubject(session: unknown) {
    return (session as { user?: { role?: string | null; permissions?: unknown } } | null)?.user || null;
}

export function getSessionUserId(session: unknown) {
    return (session as { user?: { id?: string } } | null)?.user?.id || null;
}

export function ensureAuthenticatedResponse(session: unknown) {
    if (!getSessionUserId(session)) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return null;
}

export function ensurePermissionResponse(session: unknown, permission: PermissionKey, message = "No tienes permiso para esta accion.") {
    const unauthorized = ensureAuthenticatedResponse(session);
    if (unauthorized) return unauthorized;

    if (!hasPermission(getSessionAccessSubject(session), permission)) {
        return NextResponse.json({ error: message }, { status: 403 });
    }

    return null;
}

export async function requirePermission(permission: PermissionKey) {
    const session = await auth();
    if (!getSessionUserId(session) || !hasPermission(getSessionAccessSubject(session), permission)) {
        throw new Error("Unauthorized");
    }
    return session;
}

export async function requireAnyPermission(permissions: PermissionKey[]) {
    const session = await auth();
    if (!getSessionUserId(session) || !hasAnyPermission(getSessionAccessSubject(session), permissions)) {
        throw new Error("Unauthorized");
    }
    return session;
}
