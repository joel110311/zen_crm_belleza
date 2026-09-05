import "server-only";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getControlDb } from "@/lib/control-db";

export async function deletionPreview(userId: string) {
    const memberships = await getControlDb().tenantMembership.findMany({
        where: { userId, isActive: true },
        include: { tenant: { include: { memberships: { where: { isActive: true, userId: { not: userId } }, include: { user: { select: { name: true, email: true } } } } } } },
    });
    return memberships.map((m) => ({
        id: m.tenantId, name: m.tenant.displayName,
        soleOwner: m.role === "OWNER" && !m.tenant.memberships.some((other) => other.role === "OWNER"),
        successors: m.role === "OWNER" ? m.tenant.memberships.map((other) => ({ id: other.userId, name: other.user.name || other.user.email })) : [],
    }));
}

export async function requestAccountDeletion(userId: string, body: { password?: unknown; confirmation?: unknown; receipt?: unknown; decisions?: unknown }) {
    if (body.confirmation !== "ELIMINAR MI CUENTA" || typeof body.password !== "string" || body.password.length > 256 || typeof body.receipt !== "string" || !/^[a-f0-9]{64}$/.test(body.receipt)) throw new Error("Completa la contraseña y la confirmación de eliminación.");
    const db = getControlDb();
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !await bcrypt.compare(body.password, user.passwordHash)) throw new Error("La contraseña no es correcta.");
    const decisions = body.decisions && typeof body.decisions === "object" && !Array.isArray(body.decisions) ? body.decisions as Record<string, unknown> : {};
    const tokenHash = crypto.createHash("sha256").update(body.receipt).digest("hex");
    await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const current = await tx.user.findUnique({ where: { id: userId } });
        if (!current || current.passwordHash !== user.passwordHash) throw new Error("Tu cuenta cambió. Vuelve a iniciar sesión.");
        if (await tx.accountDeletion.findUnique({ where: { userId } })) throw new Error("La eliminación ya está en curso.");
        const memberships = await tx.tenantMembership.findMany({ where: { userId, isActive: true }, include: { tenant: { include: { memberships: { where: { isActive: true } } } } } });
        const close: string[] = [];
        for (const m of memberships) {
            if (m.role !== "OWNER" || m.tenant.memberships.some((other) => other.userId !== userId && other.role === "OWNER")) continue;
            const decision = decisions[m.tenantId];
            if (decision === "close") {
                const busy = await tx.provisioningJob.count({ where: { tenantId: m.tenantId, status: "RUNNING" } });
                if (busy) throw new Error("El negocio está realizando una operación. Inténtalo cuando termine.");
                close.push(m.tenantId);
            } else if (typeof decision === "string" && m.tenant.memberships.some((other) => other.userId === decision && other.userId !== userId)) {
                if (await tx.accountDeletion.findUnique({ where: { userId: decision } })) throw new Error("El nuevo propietario está eliminando su cuenta.");
                await tx.tenantMembership.update({ where: { userId_tenantId: { userId: decision, tenantId: m.tenantId } }, data: { role: "OWNER" } });
            } else throw new Error(`Elige cerrar o transferir ${m.tenant.displayName}.`);
        }
        await tx.accountDeletion.create({ data: { userId, tokenHash, targets: { close } } });
        await tx.user.update({ where: { id: userId }, data: { passwordHash: null, securityVersion: { increment: 1 } } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.tenantMembership.updateMany({ where: { userId }, data: { isActive: false } });
        await tx.tenant.updateMany({ where: { id: { in: close } }, data: { status: "ARCHIVED", accessMode: "SUSPENDED" } });
        await tx.provisioningJob.updateMany({ where: { tenantId: { in: close }, status: { in: ["PENDING", "RETRY_WAIT", "FAILED"] } }, data: { status: "CANCELLED" } });
        await tx.tenantWorkItem.updateMany({ where: { tenantId: { in: close }, status: { in: ["QUEUED", "RETRY_WAIT"] } }, data: { status: "CANCELLED" } });
    }, { isolationLevel: "Serializable", timeout: 15000 });
}
