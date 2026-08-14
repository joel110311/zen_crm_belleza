import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { normalizePermissions, normalizeRole } from "@/lib/permissions";

export const { handlers, signIn, signOut, auth } = NextAuth({
    trustHost: true,
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email as string },
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
                        } else if (!token.name) {
                            token.name = (token.email as string) || "Usuario";
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
                (session.user as any).id = token.id;
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
