import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { normalizePermissions, normalizeRole } from "@/lib/permissions";
import { consumeRateLimit, getRequestIp, resetRateLimit } from "@/lib/security";

const AUTH_RATE_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };

export const { handlers, signIn, signOut, auth } = NextAuth({
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

                const user = await prisma.user.findUnique({
                    where: { email },
                });

                if (!user) {
                    return null;
                }

                const isPasswordValid = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                if (!isPasswordValid) {
                    return null;
                }

                resetRateLimit(rateLimitKey);

                // ALWAYS return a non-null name — use email as fallback 
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name || user.email,
                    role: normalizeRole(user.role),
                    permissions: normalizePermissions(user.permissions),
                };
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.role = normalizeRole((user as any).role);
                token.permissions = normalizePermissions((user as any).permissions);
                token.id = user.id;
                // user.name is guaranteed non-null from authorize()
                token.name = user.name;
            }

            // Keep session claims synced with DB so profile/role edits show up after re-login.
            if (token.id) {
                if (token.id) {
                    try {
                        const dbUser = await prisma.user.findUnique({
                            where: { id: token.id as string },
                            select: { name: true, email: true, role: true, permissions: true },
                        });

                        if (dbUser) {
                            token.name = dbUser.name || dbUser.email || (token.email as string) || "Usuario";
                            token.role = normalizeRole(dbUser.role);
                            token.permissions = normalizePermissions(dbUser.permissions);
                        } else {
                            delete token.id;
                            delete token.role;
                            delete token.permissions;
                            token.name = "Usuario desactivado";
                        }
                    } catch {
                        if (!token.name) {
                            token.name = (token.email as string) || "Usuario";
                        }
                    }
                }
            } else if (!token.name) {
                token.name = (token.email as string) || "Usuario";
            }

            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).role = token.role;
                (session.user as any).permissions = normalizePermissions((token as any).permissions);
                (session.user as any).id = typeof token.id === "string" ? token.id : undefined;
                session.user.name = (token.name as string) || (token.email as string) || "Usuario";
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
});
