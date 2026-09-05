import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getActiveTenantAccessSubject } from "@/lib/active-tenant-context";
import { getControlDb } from "@/lib/control-db";
import { normalizePermissions, normalizeRole } from "@/lib/permissions";
import { consumeRateLimit, getRequestIp, resetRateLimit } from "@/lib/security";

const AUTH_RATE_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

type AuthIdentity = {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    role: string;
    permissions: unknown;
    scope: "legacy" | "control";
    securityVersion: number;
};

type AuthUserClaims = {
    role?: unknown;
    permissions?: unknown;
    authScope?: unknown;
    securityVersion?: unknown;
};

type SessionUserClaims = {
    id?: string;
    role?: unknown;
    permissions?: unknown;
    authScope?: "legacy" | "control";
};

function isControlPlaneAuthEnabled(): boolean {
    return process.env.MULTITENANT_AUTH_ENABLED === "true";
}

async function findAuthIdentityByEmail(email: string): Promise<AuthIdentity | null> {
    if (isControlPlaneAuthEnabled()) {
        const user = await getControlDb().user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                name: true,
                passwordHash: true,
                securityVersion: true,
            },
        });

        if (!user?.passwordHash) {
            return null;
        }
        if (await getControlDb().accountDeletion.findUnique({ where: { userId: user.id } })) return null;

        return {
            id: user.id,
            email: user.email,
            name: user.name || user.email,
            passwordHash: user.passwordHash,
            // Tenant roles are resolved from TenantMembership after the URL slug is known.
            role: "RECEPCION",
            permissions: [],
            scope: "control",
            securityVersion: user.securityVersion,
        };
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.password) {
        return null;
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        passwordHash: user.password,
        role: user.role,
        permissions: user.permissions,
        scope: "legacy",
        securityVersion: 0,
    };
}

async function refreshAuthIdentity(id: string, scope: "legacy" | "control"): Promise<Omit<AuthIdentity, "passwordHash"> | null> {
    if (scope === "control") {
        if (await getControlDb().accountDeletion.findUnique({ where: { userId: id } })) return null;
        const user = await getControlDb().user.findUnique({
            where: { id },
            select: { id: true, email: true, name: true, securityVersion: true },
        });

        if (!user) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            name: user.name || user.email,
            role: "RECEPCION",
            permissions: [],
            scope,
            securityVersion: user.securityVersion,
        };
    }

    const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, name: true, role: true, permissions: true },
    });

    if (!user) {
        return null;
    }

    return {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        permissions: user.permissions,
        scope,
        securityVersion: 0,
    };
}

export const { handlers, signIn, signOut, auth } = NextAuth(() => ({
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    trustHost: true,
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials, request) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const email = String(credentials.email).trim().toLowerCase();
                const ip = getRequestIp(request.headers);
                const rateLimitKey = `auth:${ip}:${email}`;
                const rateLimit = consumeRateLimit(rateLimitKey, AUTH_RATE_LIMIT);
                if (!rateLimit.allowed) return null;

                const user = await findAuthIdentityByEmail(email);
                if (!user) {
                    return null;
                }

                const isPasswordValid = await bcrypt.compare(
                    credentials.password as string,
                    user.passwordHash,
                );

                if (!isPasswordValid) {
                    return null;
                }

                resetRateLimit(rateLimitKey);

                // ALWAYS return a non-null name — use email as fallback 
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: normalizeRole(user.role),
                    permissions: normalizePermissions(user.permissions),
                    authScope: user.scope,
                    securityVersion: user.securityVersion,
                };
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                const userClaims = user as typeof user & AuthUserClaims;
                token.role = normalizeRole(typeof userClaims.role === "string" ? userClaims.role : undefined);
                token.permissions = normalizePermissions(userClaims.permissions);
                token.id = user.id;
                token.authScope = userClaims.authScope === "control" ? "control" : "legacy";
                token.securityVersion = typeof userClaims.securityVersion === "number" ? userClaims.securityVersion : 0;
                // user.name is guaranteed non-null from authorize()
                token.name = user.name;
            }

            // Keep session claims synced with DB so profile/role edits show up after re-login.
            if (token.id) {
                try {
                    const scope = token.authScope === "control" ? "control" : "legacy";
                    const dbUser = await refreshAuthIdentity(token.id as string, scope);

                    if (dbUser) {
                        if (scope === "control" && typeof token.securityVersion === "number" && token.securityVersion !== dbUser.securityVersion) {
                            delete token.id;
                            delete token.role;
                            delete token.permissions;
                            delete token.authScope;
                            delete token.securityVersion;
                            token.name = "Sesión revocada";
                            return token;
                        }
                        token.email = dbUser.email;
                        token.name = dbUser.name || (token.email as string) || "Usuario";
                        token.role = normalizeRole(dbUser.role);
                        token.permissions = normalizePermissions(dbUser.permissions);
                        token.authScope = dbUser.scope;
                        token.securityVersion = dbUser.securityVersion;
                    } else {
                        delete token.id;
                        delete token.role;
                        delete token.permissions;
                        delete token.authScope;
                        delete token.securityVersion;
                        token.name = "Usuario desactivado";
                    }
                } catch {
                    if (!token.name) {
                        token.name = (token.email as string) || "Usuario";
                    }
                }
            } else if (!token.name) {
                token.name = (token.email as string) || "Usuario";
            }

            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                const sessionUser = session.user as typeof session.user & SessionUserClaims;
                sessionUser.role = token.role;
                sessionUser.permissions = normalizePermissions(token.permissions);
                if (typeof token.id === "string") {
                    sessionUser.id = token.id;
                }
                sessionUser.authScope = token.authScope === "control" ? "control" : "legacy";
                session.user.name = (token.name as string) || (token.email as string) || "Usuario";

                // A control-plane login gets its effective role from the membership of the
                // business selected by the trusted request headers. This keeps all established
                // CRM permission checks working without granting cross-business privileges.
                if (sessionUser.authScope === "control") {
                    try {
                        const tenantSubject = await getActiveTenantAccessSubject();
                        if (tenantSubject) {
                            sessionUser.role = tenantSubject.role;
                            sessionUser.permissions = normalizePermissions(tenantSubject.permissions);
                        }
                    } catch {
                        // The tenant layout/API performs the authoritative access check and
                        // returns 404/403. Authentication itself must remain available so it can.
                    }
                }
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
    },
}));
