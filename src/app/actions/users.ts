"use server";

import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
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

export async function getUsers() {
    await requirePermission("users.manage");

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

    const existing = await prisma.user.findUnique({
        where: { email: payload.email },
    });
    if (existing) {
        return { success: false, error: "Ya existe un usuario con ese correo." };
    }

    if (data.password.length < 6) {
        return { success: false, error: "La contraseña debe tener al menos 6 caracteres." };
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

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
        if (data.password.length < 6) {
            return { success: false, error: "La contraseña debe tener al menos 6 caracteres." };
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

    await prisma.user.delete({
        where: { id: userId },
    });

    revalidatePath("/dashboard/settings");
    return { success: true };
}
