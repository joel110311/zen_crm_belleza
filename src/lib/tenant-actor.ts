import "server-only";
import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { getControlDb } from "@/lib/control-db";
import type { TenantAccess } from "@/lib/control-plane";
import type { AppRole } from "@/lib/permissions";

export class TenantActorResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TenantActorResolutionError";
    }
}

export type TenantActor = Pick<User, "id" | "controlUserId" | "email" | "name" | "role" | "permissions">;

export function tenantMembershipRoleToAppRole(role: TenantAccess["role"]): AppRole {
    switch (role) {
        case "OWNER":
        case "ADMIN":
            return "ADMINISTRADOR";
        case "PROFESSIONAL":
            return "PROFESIONAL";
        case "RECEPTION":
        default:
            return "RECEPCION";
    }
}

async function projectAcceptedProfessionalInvitation(
    tenantDb: PrismaClient,
    access: TenantAccess,
    controlUserId: string,
    actor: TenantActor,
) {
    // Membership succeeds independently from this projection. A capacity/schema issue must be
    // visible and retryable on the next access, never leave a "phantom" global member.
    if (access.role !== "PROFESSIONAL") return;

    const controlDb = getControlDb();
    const invitation = await controlDb.tenantInvitation.findFirst({
        where: {
            tenantId: access.tenantId,
            acceptedByUserId: controlUserId,
            role: "PROFESSIONAL",
            status: "ACCEPTED",
            professionalProfileStatus: { not: "SUCCEEDED" },
        },
        orderBy: { acceptedAt: "desc" },
        select: { id: true, professionalProfile: true },
    });
    if (!invitation) return;

    try {
        const profile = invitation.professionalProfile && typeof invitation.professionalProfile === "object" && !Array.isArray(invitation.professionalProfile)
            ? invitation.professionalProfile as Record<string, unknown>
            : {};
        const text = (value: unknown, fallback: string, maxLength: number) => {
            const candidate = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
            return candidate || fallback;
        };
        const existing = await tenantDb.specialist.findFirst({
            where: { userId: actor.id },
            select: { id: true },
        });
        const specialist = existing || await tenantDb.specialist.create({
            data: {
                userId: actor.id,
                name: text(profile.name, actor.name || actor.email, 160),
                displayName: text(profile.name, actor.name || actor.email, 160),
                specialty: text(profile.specialty, "", 160) || null,
                professionalTitle: text(profile.professionalTitle, "", 160) || null,
                professionalLicense: text(profile.professionalLicense, "", 100) || null,
                email: actor.email,
                isActive: true,
            },
            select: { id: true },
        });
        await controlDb.tenantInvitation.update({
            where: { id: invitation.id },
            data: {
                professionalProfileStatus: "SUCCEEDED",
                professionalProfileError: null,
                professionalProfileSpecialistId: specialist.id,
            },
        });
    } catch (error) {
        await controlDb.tenantInvitation.update({
            where: { id: invitation.id },
            data: {
                professionalProfileStatus: "FAILED",
                professionalProfileError: error instanceof Error ? error.message.slice(0, 300) : "projection_failed",
            },
        }).catch(() => {});
    }
}

/**
 * Creates or refreshes the operational user stored in one tenant database. Passwords never cross
 * this boundary: authentication and membership remain exclusively in the control plane.
 */
export async function ensureTenantActor(
    tenantDb: PrismaClient,
    access: TenantAccess,
    controlUserId: string,
): Promise<TenantActor> {
    const globalUser = await getControlDb().user.findUnique({
        where: { id: controlUserId },
        select: { id: true, email: true, name: true },
    });
    if (!globalUser) {
        throw new TenantActorResolutionError("La identidad global ya no está disponible.");
    }

    const role = tenantMembershipRoleToAppRole(access.role);
    const select = {
        id: true,
        controlUserId: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
    } as const;

    const refreshActor = (id: string) => tenantDb.user.update({
        where: { id },
        data: { email: globalUser.email, name: globalUser.name, role },
        select,
    });

    let actor: TenantActor;
    try {
        actor = await tenantDb.$transaction(async (tx) => {
            const linked = await tx.user.findUnique({
                where: { controlUserId: globalUser.id },
                select,
            });
            if (linked) {
                return tx.user.update({
                    where: { id: linked.id },
                    data: { email: globalUser.email, name: globalUser.name, role },
                    select,
                });
            }

            const sameEmail = await tx.user.findUnique({
                where: { email: globalUser.email },
                select,
            });
            if (sameEmail?.controlUserId && sameEmail.controlUserId !== globalUser.id) {
                throw new TenantActorResolutionError("El correo ya está vinculado con otra identidad global en este negocio.");
            }

            if (sameEmail) {
                return tx.user.update({
                    where: { id: sameEmail.id },
                    data: {
                        controlUserId: globalUser.id,
                        name: globalUser.name,
                        role,
                    },
                    select,
                });
            }

            return tx.user.create({
                data: {
                    controlUserId: globalUser.id,
                    email: globalUser.email,
                    name: globalUser.name,
                    password: null,
                    role,
                    permissions: [],
                },
                select,
            });
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const concurrentActor = await tenantDb.user.findUnique({
                where: { controlUserId: globalUser.id },
                select: { id: true },
            });
            if (concurrentActor) {
                actor = await refreshActor(concurrentActor.id);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }

    await projectAcceptedProfessionalInvitation(tenantDb, access, controlUserId, actor);
    return actor;
}
