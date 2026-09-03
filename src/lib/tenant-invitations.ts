import "server-only";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { hashSecurityIdentifier } from "@/lib/security";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import type { TenantRuntimeContext } from "@/lib/tenant-context";
import { TenantServiceError } from "@/lib/tenant-services/context";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SEAT_LIMIT = 5;
const INVITABLE_ROLES = new Set(["ADMIN", "PROFESSIONAL", "RECEPTION"]);

export class TenantInvitationError extends TenantServiceError {
    constructor(
        message: string,
        code: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" = "VALIDATION_ERROR",
    ) {
        super(code, message);
        this.name = "TenantInvitationError";
    }
}

type ProfessionalProfile = {
    name: string;
    specialty: string | null;
    professionalTitle: string | null;
    professionalLicense: string | null;
};

type InvitationInput = {
    email?: unknown;
    role?: unknown;
    professionalProfile?: unknown;
};

function cleanText(value: unknown, label: string, maxLength: number, required = false) {
    const text = typeof value === "string" ? value.trim() : "";
    if (required && !text) throw new TenantInvitationError(`Completa ${label}.`);
    if (text.length > maxLength) throw new TenantInvitationError(`${label} no puede exceder ${maxLength} caracteres.`);
    return text || null;
}

function cleanEmail(value: unknown) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
        throw new TenantInvitationError("Ingresa un correo electrónico válido.");
    }
    return email;
}

function cleanRole(value: unknown) {
    const role = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!INVITABLE_ROLES.has(role)) {
        throw new TenantInvitationError("Selecciona un rol permitido para el equipo.");
    }
    return role as "ADMIN" | "PROFESSIONAL" | "RECEPTION";
}

function cleanIdempotencyKey(value: string | null) {
    const key = value?.trim() || "";
    if (key.length < 16 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
        throw new TenantInvitationError("Envía un encabezado Idempotency-Key válido.");
    }
    return key;
}

function normalizeProfessionalProfile(value: unknown, email: string): ProfessionalProfile {
    const input = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        name: cleanText(input.name, "el nombre del profesional", 160, false) || email.split("@")[0],
        specialty: cleanText(input.specialty, "la especialidad", 160),
        professionalTitle: cleanText(input.professionalTitle, "el título profesional", 160),
        professionalLicense: cleanText(input.professionalLicense, "la cédula profesional", 100),
    };
}

function publicBaseUrl() {
    const value = process.env.APP_BASE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL;
    if (!value) throw new Error("No hay una URL pública configurada para enviar invitaciones.");
    return value.replace(/\/$/, "");
}

function parseSeatLimit(value: unknown) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const raw = (value as Record<string, unknown>).limit;
        if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return raw;
    }
    return null;
}

async function resolveSeatLimit(tx: Prisma.TransactionClient, tenantId: string) {
    const entitlement = await tx.billingEntitlement.findUnique({
        where: { tenantId_key: { tenantId, key: "seats" } },
        select: { value: true, expiresAt: true },
    });
    if (!entitlement || (entitlement.expiresAt && entitlement.expiresAt <= new Date())) {
        return DEFAULT_SEAT_LIMIT;
    }
    return parseSeatLimit(entitlement.value) || DEFAULT_SEAT_LIMIT;
}

function invitationSummary(invitation: {
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "PROFESSIONAL" | "RECEPTION";
    status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
    expiresAt: Date;
    createdAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    invitedBy: { name: string | null; email: string };
    professionalProfile: unknown;
    professionalProfileStatus: "PENDING" | "SUCCEEDED" | "FAILED" | null;
    professionalProfileError: string | null;
}) {
    return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        acceptedAt: invitation.acceptedAt?.toISOString() || null,
        revokedAt: invitation.revokedAt?.toISOString() || null,
        invitedBy: invitation.invitedBy.name || invitation.invitedBy.email,
        professionalProfile: invitation.professionalProfile,
        professionalProfileStatus: invitation.professionalProfileStatus,
        professionalProfileError: invitation.professionalProfileError,
    };
}

const invitationSelect = {
    id: true,
    email: true,
    role: true,
    status: true,
    expiresAt: true,
    createdAt: true,
    acceptedAt: true,
    revokedAt: true,
    professionalProfile: true,
    professionalProfileStatus: true,
    professionalProfileError: true,
    invitedBy: { select: { name: true, email: true } },
} satisfies Prisma.TenantInvitationSelect;

export async function listTenantTeam(context: TenantRuntimeContext) {
    const db = getControlDb();
    const now = new Date();
    await db.tenantInvitation.updateMany({
        where: { tenantId: context.tenantId, status: "PENDING", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
    });
    const [memberships, invitations, entitlement] = await Promise.all([
        db.tenantMembership.findMany({
            where: { tenantId: context.tenantId },
            orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
            select: {
                id: true, role: true, isActive: true, createdAt: true, updatedAt: true,
                user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
            },
        }),
        db.tenantInvitation.findMany({
            where: { tenantId: context.tenantId },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: invitationSelect,
        }),
        db.billingEntitlement.findUnique({
            where: { tenantId_key: { tenantId: context.tenantId, key: "seats" } },
            select: { value: true, expiresAt: true },
        }),
    ]);
    const seatLimit = !entitlement || (entitlement.expiresAt && entitlement.expiresAt <= now)
        ? DEFAULT_SEAT_LIMIT
        : parseSeatLimit(entitlement.value) || DEFAULT_SEAT_LIMIT;
    const activeSeats = memberships.filter((membership) => membership.isActive).length;
    const pendingSeats = invitations.filter((invitation) => invitation.status === "PENDING" && invitation.expiresAt > now).length;

    return {
        memberships: memberships.map((membership) => ({
            id: membership.id,
            role: membership.role,
            isActive: membership.isActive,
            createdAt: membership.createdAt.toISOString(),
            updatedAt: membership.updatedAt.toISOString(),
            user: {
                id: membership.user.id,
                name: membership.user.name || membership.user.email,
                email: membership.user.email,
                emailVerifiedAt: membership.user.emailVerifiedAt?.toISOString() || null,
            },
        })),
        invitations: invitations.map(invitationSummary),
        seats: { limit: seatLimit, active: activeSeats, pending: pendingSeats, available: Math.max(0, seatLimit - activeSeats - pendingSeats) },
    };
}

export async function createTenantInvitation(
    context: TenantRuntimeContext,
    rawInput: InvitationInput,
    headerIdempotencyKey: string | null,
) {
    const email = cleanEmail(rawInput.email);
    const role = cleanRole(rawInput.role);
    const idempotencyKey = cleanIdempotencyKey(headerIdempotencyKey);
    const professionalProfile = role === "PROFESSIONAL" ? normalizeProfessionalProfile(rawInput.professionalProfile, email) : null;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSecurityIdentifier(`tenant-invitation:${token}`);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const db = getControlDb();

    const prepared = await db.$transaction(async (tx) => {
        const replay = await tx.tenantInvitation.findUnique({
            where: { idempotencyKey },
            select: { tenantId: true, ...invitationSelect },
        });
        if (replay) {
            if (replay.tenantId !== context.tenantId || replay.email !== email) {
                throw new TenantInvitationError("La clave de idempotencia ya se usó con otra invitación.", "CONFLICT");
            }
            return { replay: true, invitation: replay, deliveryId: null as string | null };
        }

        const activeMembership = await tx.tenantMembership.findFirst({
            where: { tenantId: context.tenantId, isActive: true, user: { email } },
            select: { id: true },
        });
        if (activeMembership) {
            throw new TenantInvitationError("Esta persona ya forma parte del equipo activo.", "CONFLICT");
        }

        // Re-sending to the same address supersedes the old capability, so it cannot consume an extra seat.
        await tx.tenantInvitation.updateMany({
            where: { tenantId: context.tenantId, email, status: "PENDING" },
            data: { status: "REVOKED", revokedAt: now },
        });
        const [seatLimit, activeSeats, pendingSeats] = await Promise.all([
            resolveSeatLimit(tx, context.tenantId),
            tx.tenantMembership.count({ where: { tenantId: context.tenantId, isActive: true } }),
            tx.tenantInvitation.count({ where: { tenantId: context.tenantId, status: "PENDING", expiresAt: { gt: now } } }),
        ]);
        if (activeSeats + pendingSeats >= seatLimit) {
            throw new TenantInvitationError(`El plan permite ${seatLimit} integrantes. Libera un asiento o actualiza el plan para invitar a alguien más.`, "CONFLICT");
        }

        const invitation = await tx.tenantInvitation.create({
            data: {
                tenantId: context.tenantId,
                email,
                role,
                tokenHash,
                expiresAt,
                invitedByUserId: context.actor.controlUserId || context.actor.id,
                idempotencyKey,
                professionalProfile: professionalProfile as Prisma.InputJsonValue | undefined,
                professionalProfileStatus: role === "PROFESSIONAL" ? "PENDING" : null,
            },
            select: invitationSelect,
        });
        const delivery = await tx.emailDelivery.create({
            data: {
                tenantInvitationId: invitation.id,
                recipientEmail: email,
                template: "tenant-invitation",
                provider: "resend",
            },
            select: { id: true },
        });
        await tx.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.actor.controlUserId || context.actor.id,
                action: "tenant.invitation.created",
                resourceType: "TenantInvitation",
                resourceId: invitation.id,
                metadata: { role, email },
            },
        });
        return { replay: false, invitation, deliveryId: delivery.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (prepared.replay) {
        return { invitation: invitationSummary(prepared.invitation), replayed: true };
    }

    const inviteUrl = `${publicBaseUrl()}/invitations/${encodeURIComponent(token)}`;
    try {
        const sent = await sendTransactionalEmail({
            to: email,
            subject: `Te invitaron a ${context.displayName}`,
            text: `Te invitaron a colaborar en ${context.displayName}. Acepta la invitación antes del ${expiresAt.toLocaleDateString("es-MX")}: ${inviteUrl}`,
            html: `<p>Te invitaron a colaborar en <strong>${escapeHtml(context.displayName)}</strong>.</p><p><a href="${escapeHtml(inviteUrl)}">Aceptar invitación</a></p><p>Este enlace vence el ${escapeHtml(expiresAt.toLocaleDateString("es-MX"))}.</p>`,
        });
        await db.emailDelivery.update({
            where: { id: prepared.deliveryId! },
            data: { status: "SENT", externalId: sent.externalId, sentAt: new Date() },
        });
    } catch (error) {
        await db.emailDelivery.update({
            where: { id: prepared.deliveryId! },
            data: { status: "FAILED", errorCode: error instanceof Error ? error.message.slice(0, 160) : "delivery_failed" },
        }).catch(() => {});
        throw new TenantInvitationError("La invitación se guardó, pero no se pudo enviar el correo. Vuelve a enviarla desde Equipo.", "CONFLICT");
    }

    return { invitation: invitationSummary(prepared.invitation), replayed: false };
}

function escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

export async function revokeTenantInvitation(context: TenantRuntimeContext, invitationId: string) {
    const id = invitationId.trim();
    if (!/^[a-zA-Z0-9_-]{8,200}$/.test(id)) throw new TenantInvitationError("La invitación no es válida.");
    const now = new Date();
    const db = getControlDb();
    const invitation = await db.tenantInvitation.updateMany({
        where: { id, tenantId: context.tenantId, status: "PENDING" },
        data: { status: "REVOKED", revokedAt: now },
    });
    if (invitation.count !== 1) throw new TenantInvitationError("La invitación ya no está pendiente.", "NOT_FOUND");
    await db.auditLog.create({
        data: { tenantId: context.tenantId, actorUserId: context.actor.controlUserId || context.actor.id, action: "tenant.invitation.revoked", resourceType: "TenantInvitation", resourceId: id },
    });
    return { id, revoked: true };
}

export async function setTenantMembershipActive(context: TenantRuntimeContext, membershipId: string, isActive: boolean) {
    const id = membershipId.trim();
    if (!/^[a-zA-Z0-9_-]{8,200}$/.test(id)) throw new TenantInvitationError("La membresía no es válida.");
    const db = getControlDb();
    const membership = await db.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId },
        select: { id: true, role: true, isActive: true, userId: true },
    });
    if (!membership) throw new TenantInvitationError("La membresía ya no existe.", "NOT_FOUND");
    if (membership.role === "OWNER" && !isActive) {
        throw new TenantInvitationError("No se puede desactivar a la persona propietaria. Primero será necesario transferir la propiedad.", "CONFLICT");
    }
    if (membership.isActive === isActive) return { id, isActive, unchanged: true };
    await db.$transaction([
        db.tenantMembership.update({ where: { id }, data: { isActive } }),
        db.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.actor.controlUserId || context.actor.id,
                action: isActive ? "tenant.membership.reactivated" : "tenant.membership.deactivated",
                resourceType: "TenantMembership",
                resourceId: id,
                metadata: { userId: membership.userId, role: membership.role },
            },
        }),
    ]);
    return { id, isActive, unchanged: false };
}

function invitationTokenHash(token: unknown) {
    const value = typeof token === "string" ? token.trim() : "";
    if (value.length < 32 || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    return hashSecurityIdentifier(`tenant-invitation:${value}`);
}

export async function acceptTenantInvitation(input: { token?: unknown; name?: unknown; password?: unknown }) {
    const tokenHash = invitationTokenHash(input.token);
    if (!tokenHash) throw new TenantInvitationError("La invitación no es válida o ya venció.", "NOT_FOUND");
    const now = new Date();
    const db = getControlDb();

    try {
        const accepted = await db.$transaction(async (tx) => {
            const invitation = await tx.tenantInvitation.findUnique({
                where: { tokenHash },
                include: { tenant: { select: { id: true, slug: true, displayName: true, status: true } } },
            });
            if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt <= now) {
                if (invitation?.status === "PENDING") {
                    await tx.tenantInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
                }
                throw new TenantInvitationError("La invitación no es válida o ya venció.", "NOT_FOUND");
            }

            let user = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true, email: true, name: true } });
            if (!user) {
                const password = typeof input.password === "string" ? input.password : "";
                if (password.length < 12 || password.length > 128) {
                    throw new TenantInvitationError("Crea una contraseña de entre 12 y 128 caracteres para terminar la invitación.");
                }
                const name = cleanText(input.name, "tu nombre", 160, true)!;
                user = await tx.user.create({
                    data: { email: invitation.email, name, passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: now },
                    select: { id: true, email: true, name: true },
                });
            } else {
                await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
            }

            await tx.tenantMembership.upsert({
                where: { userId_tenantId: { userId: user.id, tenantId: invitation.tenantId } },
                create: { userId: user.id, tenantId: invitation.tenantId, role: invitation.role, isActive: true },
                update: { role: invitation.role, isActive: true },
            });
            await tx.tenantInvitation.update({
                where: { id: invitation.id },
                data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: user.id },
            });
            await tx.auditLog.create({
                data: { tenantId: invitation.tenantId, actorUserId: user.id, action: "tenant.invitation.accepted", resourceType: "TenantInvitation", resourceId: invitation.id, metadata: { role: invitation.role } },
            });
            return { slug: invitation.tenant.slug, displayName: invitation.tenant.displayName, email: user.email };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { ...accepted, alreadyAccepted: false };
    } catch (error) {
        if (error instanceof TenantInvitationError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
            const accepted = await db.tenantInvitation.findUnique({
                where: { tokenHash },
                include: { tenant: { select: { slug: true, displayName: true } }, acceptedBy: { select: { email: true } } },
            });
            if (accepted?.status === "ACCEPTED" && accepted.acceptedBy) {
                return { slug: accepted.tenant.slug, displayName: accepted.tenant.displayName, email: accepted.acceptedBy.email, alreadyAccepted: true };
            }
        }
        throw error;
    }
}
