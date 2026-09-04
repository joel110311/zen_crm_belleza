"use server";

import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getActiveTenantRuntimeContext } from "@/lib/active-tenant-context";
import { requirePermission } from "@/lib/authz";
import { getControlDb } from "@/lib/control-db";
import { tenantMembershipRoleToAppRole } from "@/lib/tenant-actor";
import {
    normalizePermissions,
    normalizeRole,
    type AppRole,
    type PermissionKey,
} from "@/lib/permissions";

type UserInput = {
    name: string;
    email: string;
    password?: string;
    role: AppRole | string;
    permissions?: PermissionKey[] | string[];
};

function cleanText(value?: string | null) {
    return value?.trim() || "";
}

function cleanUserPayload(data: UserInput) {
    return {
        name: cleanText(data.name),
        email: cleanText(data.email).toLowerCase(),
        role: normalizeRole(data.role),
        permissions: normalizePermissions(data.permissions),
    };
}

function userSelect() {
    return {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
    } satisfies Prisma.UserSelect;
}

function appRoleToMembershipRole(role: AppRole) {
    if (role === "ADMINISTRADOR") return "ADMIN" as const;
    if (role === "PROFESIONAL") return "PROFESSIONAL" as const;
    return "RECEPTION" as const;
}

async function getTenantUsers() {
    const runtime = await getActiveTenantRuntimeContext("read");
    if (!runtime) return null;

    const memberships = await getControlDb().tenantMembership.findMany({
        where: { tenantId: runtime.tenantId, isActive: true },
        orderBy: { createdAt: "asc" },
        include: {
            user: { select: { id: true, name: true, email: true, createdAt: true } },
        },
    });
    const actors = await runtime.db.user.findMany({
        where: { controlUserId: { in: memberships.map((membership) => membership.userId) } },
        select: { controlUserId: true, permissions: true },
    });
    const permissionsByUser = new Map(actors.map((actor) => [actor.controlUserId, actor.permissions]));

    return memberships.map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: tenantMembershipRoleToAppRole(membership.role),
        permissions: permissionsByUser.get(membership.user.id) || [],
        createdAt: membership.user.createdAt,
    }));
}

export async function getUsers() {
    await requirePermission("users.manage");

    const tenantUsers = await getTenantUsers();
    if (tenantUsers) return tenantUsers;

    return prisma.user.findMany({
        select: userSelect(),
        orderBy: { createdAt: "asc" },
    });
}

export async function createUser(data: UserInput & { password: string }) {
    await requirePermission("users.manage");

    const payload = cleanUserPayload(data);
    if (!payload.name || !payload.email) {
        return { success: false, error: "Nombre y correo son obligatorios." };
    }

    if (data.password.length < 12) {
        return { success: false, error: "La contraseña debe tener al menos 12 caracteres." };
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const runtime = await getActiveTenantRuntimeContext("write");
    if (runtime) {
        const control = getControlDb();
        const existing = await control.user.findUnique({
            where: { email: payload.email },
            select: { id: true, memberships: { where: { tenantId: runtime.tenantId }, select: { id: true } } },
        });
        if (existing?.memberships.length) {
            return { success: false, error: "Esta persona ya forma parte del negocio." };
        }
        if (existing) {
            return { success: false, error: "Ese correo ya tiene una cuenta. Usa el flujo de incorporación para agregarla de forma segura." };
        }

        const controlUser = await control.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    name: payload.name,
                    email: payload.email,
                    passwordHash: hashedPassword,
                    emailVerifiedAt: new Date(),
                },
                select: { id: true, name: true, email: true, createdAt: true },
            });
            await tx.tenantMembership.create({
                data: {
                    tenantId: runtime.tenantId,
                    userId: user.id,
                    role: appRoleToMembershipRole(payload.role),
                },
            });
            return user;
        });

        try {
            await runtime.db.user.create({
                data: {
                    controlUserId: controlUser.id,
                    name: controlUser.name,
                    email: controlUser.email,
                    password: null,
                    role: payload.role,
                    permissions: payload.permissions,
                },
            });
        } catch (error) {
            await control.tenantMembership.deleteMany({
                where: { tenantId: runtime.tenantId, userId: controlUser.id },
            }).catch(() => undefined);
            await control.user.delete({ where: { id: controlUser.id } }).catch(() => undefined);
            throw error;
        }

        revalidatePath(`/t/${runtime.slug}/settings`);
        return {
            success: true,
            user: {
                ...controlUser,
                role: payload.role,
                permissions: payload.permissions,
            },
        };
    }

    const existing = await prisma.user.findUnique({ where: { email: payload.email } });
    if (existing) return { success: false, error: "Ya existe un usuario con ese correo." };

    const user = await prisma.user.create({
        data: {
            name: payload.name,
            email: payload.email,
            password: hashedPassword,
            role: payload.role,
            permissions: payload.permissions,
        },
        select: userSelect(),
    });

    revalidatePath("/dashboard/settings");
    return { success: true, user };
}

export async function updateUser(userId: string, data: Partial<UserInput>) {
    await requirePermission("users.manage");

    const runtime = await getActiveTenantRuntimeContext("write");
    if (runtime) {
        const control = getControlDb();
        const membership = await control.tenantMembership.findUnique({
            where: { userId_tenantId: { userId, tenantId: runtime.tenantId } },
            include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
        });
        if (!membership?.isActive) return { success: false, error: "La persona ya no forma parte de este negocio." };

        const name = data.name === undefined ? membership.user.name : cleanText(data.name);
        const email = data.email === undefined ? membership.user.email : cleanText(data.email).toLowerCase();
        if (!email) return { success: false, error: "El correo es obligatorio." };
        const role = data.role === undefined
            ? tenantMembershipRoleToAppRole(membership.role)
            : normalizeRole(data.role);
        const permissions = data.permissions === undefined
            ? undefined
            : normalizePermissions(data.permissions);
        if (data.password && data.password.length < 12) {
            return { success: false, error: "La contraseña debe tener al menos 12 caracteres." };
        }

        try {
            const updatedControlUser = await control.$transaction(async (tx) => {
                const user = await tx.user.update({
                    where: { id: userId },
                    data: {
                        name,
                        email,
                        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12), securityVersion: { increment: 1 } } : {}),
                    },
                    select: { id: true, name: true, email: true, createdAt: true },
                });
                if (membership.role !== "OWNER") {
                    await tx.tenantMembership.update({
                        where: { id: membership.id },
                        data: { role: appRoleToMembershipRole(role) },
                    });
                }
                return user;
            });

            const actor = await runtime.db.user.upsert({
                where: { controlUserId: userId },
                create: {
                    controlUserId: userId,
                    name: updatedControlUser.name,
                    email: updatedControlUser.email,
                    password: null,
                    role: membership.role === "OWNER" ? "ADMINISTRADOR" : role,
                    permissions: permissions || [],
                },
                update: {
                    name: updatedControlUser.name,
                    email: updatedControlUser.email,
                    role: membership.role === "OWNER" ? "ADMINISTRADOR" : role,
                    ...(permissions ? { permissions } : {}),
                },
                select: { permissions: true },
            });
            revalidatePath(`/t/${runtime.slug}/settings`);
            return {
                success: true,
                user: {
                    ...updatedControlUser,
                    role: membership.role === "OWNER" ? "ADMINISTRADOR" : role,
                    permissions: actor.permissions,
                },
            };
        } catch (error) {
            const message = error instanceof Error && error.message.includes("Unique constraint")
                ? "Ya existe un usuario con ese correo."
                : "No se pudo actualizar el usuario.";
            return { success: false, error: message };
        }
    }

    const updateData: Prisma.UserUpdateInput = {};

    if (data.name !== undefined) {
        updateData.name = cleanText(data.name);
    }

    if (data.email !== undefined) {
        const email = cleanText(data.email).toLowerCase();
        if (!email) return { success: false, error: "El correo es obligatorio." };

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing && existing.id !== userId) {
            return { success: false, error: "Ya existe un usuario con ese correo." };
        }

        updateData.email = email;
    }

    if (data.role !== undefined) {
        updateData.role = normalizeRole(data.role);
    }

    if (data.permissions !== undefined) {
        updateData.permissions = normalizePermissions(data.permissions);
    }

    if (data.password && data.password.length > 0) {
        if (data.password.length < 12) {
            return { success: false, error: "La contraseña debe tener al menos 12 caracteres." };
        }
        updateData.password = await bcrypt.hash(data.password, 12);
    }

    const user = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: userSelect(),
    });

    revalidatePath("/dashboard/settings");
    return { success: true, user };
}

export async function deleteUser(userId: string) {
    const session = await requirePermission("users.manage");
    const currentUserId = (session?.user as { id?: string } | undefined)?.id;

    if (userId === currentUserId) {
        return { success: false, error: "No puedes eliminar tu propia cuenta." };
    }

    const runtime = await getActiveTenantRuntimeContext("write");
    if (runtime) {
        const membership = await getControlDb().tenantMembership.findUnique({
            where: { userId_tenantId: { userId, tenantId: runtime.tenantId } },
            select: { id: true, role: true },
        });
        if (!membership) return { success: false, error: "La persona no forma parte de este negocio." };
        if (membership.role === "OWNER") return { success: false, error: "La cuenta propietaria no se puede eliminar." };

        await getControlDb().tenantMembership.update({
            where: { id: membership.id },
            data: { isActive: false },
        });
        revalidatePath(`/t/${runtime.slug}/settings`);
        return { success: true };
    }

    await prisma.user.delete({
        where: { id: userId },
    });

    revalidatePath("/dashboard/settings");
    return { success: true };
}
