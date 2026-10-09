import "server-only";
import { randomUUID } from "node:crypto";
import { getControlDb } from "@/lib/control-db";
import { ENVIRONMENT_ADMIN_ID, environmentAdminCredentialVersion } from "@/lib/environment-platform-admin";
import { ControlValidationError } from "@/lib/control-validation-error";
import { PLATFORM_SUPPORT_DURATION_SECONDS, supportWorkspaceReturnPath } from "@/lib/platform-admin-policy";

export type SupportGrant = {
    id: string; tenantId: string; slug: string; adminUserId: string;
    mode: "READ_ONLY" | "FULL"; reason: string; expiresAt: string;
    securityVersion: number; credentialVersion: string | null;
};
const keyFor = (userId: string) => `support.workspace.${userId}`;
const durationMs = PLATFORM_SUPPORT_DURATION_SECONDS * 1000;

/** One explicit, expiring workspace per operator. A cookie alone is never an access grant. */
export async function getPlatformSupportGrant(userId: string): Promise<SupportGrant | null> {
    const db = getControlDb();
    const [user, setting, deletion] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true, securityVersion: true } }),
        db.platformRuntimeSetting.findUnique({ where: { key: keyFor(userId) } }),
        db.accountDeletion.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    if (!user?.isPlatformAdmin || deletion) return null;
    const value = setting?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const grant = value as unknown as SupportGrant;
    if (grant.adminUserId !== userId || grant.securityVersion !== user.securityVersion
        || typeof grant.id !== "string" || typeof grant.tenantId !== "string" || typeof grant.slug !== "string"
        || typeof grant.reason !== "string" || !["READ_ONLY", "FULL"].includes(grant.mode)
        || typeof grant.expiresAt !== "string" || !Number.isFinite(Date.parse(grant.expiresAt))
        || Date.parse(grant.expiresAt) <= Date.now() || Date.parse(grant.expiresAt) > Date.now() + durationMs + 5000) return null;
    if (userId === ENVIRONMENT_ADMIN_ID && (!environmentAdminCredentialVersion()
        || grant.credentialVersion !== environmentAdminCredentialVersion())) return null;
    return grant;
}

export async function startPlatformSupport(userId: string, input: Record<string, unknown>) {
    const tenantId = typeof input.tenantId === "string" ? input.tenantId : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const mode = input.mode === undefined ? "FULL" : input.mode;
    if (!tenantId || reason.length < 5 || reason.length > 500 || !["READ_ONLY", "FULL"].includes(String(mode))) {
        throw new ControlValidationError("Elige un negocio, un modo válido y un motivo de 5 a 500 caracteres.");
    }
    const db = getControlDb();
    return db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true, securityVersion: true } });
        if (!user?.isPlatformAdmin || await tx.accountDeletion.findUnique({ where: { userId } })) {
            throw new ControlValidationError("La cuenta administrativa ya no está disponible.");
        }
        const credentialVersion = userId === ENVIRONMENT_ADMIN_ID ? environmentAdminCredentialVersion() : null;
        if (userId === ENVIRONMENT_ADMIN_ID && !credentialVersion) throw new ControlValidationError("El acceso administrativo está desactivado.");
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, status: true } });
        if (!tenant || tenant.status === "ARCHIVED") throw new ControlValidationError("Este negocio no está disponible para soporte.");
        // Non-ready workspaces can be inspected in the provisioning status page, never opened
        // through a legacy database or by decrypting an unfinished runtime's credentials.
        const grant: SupportGrant = {
            id: randomUUID(), tenantId: tenant.id, slug: tenant.slug, adminUserId: userId,
            reason, mode: mode as SupportGrant["mode"], securityVersion: user.securityVersion,
            credentialVersion, expiresAt: new Date(Date.now() + durationMs).toISOString(),
        };
        const previous = await tx.platformRuntimeSetting.findUnique({ where: { key: keyFor(userId) } });
        await tx.platformRuntimeSetting.upsert({ where: { key: keyFor(userId) }, create: { key: keyFor(userId), value: grant }, update: { value: grant } });
        await tx.auditLog.create({ data: {
            actorUserId: userId, tenantId: tenant.id, action: "support.workspace.started",
            resourceType: "SupportSession", resourceId: grant.id,
            metadata: { mode: grant.mode, reason, expiresAt: grant.expiresAt, replacedPreviousSession: Boolean(previous) },
        } });
        const target = input.destination === "onboarding" ? "onboarding" : "dashboard";
        return { grant, destination: tenant.status === "READY" ? supportWorkspaceReturnPath(tenant.slug, input.returnTo) || `/t/${encodeURIComponent(tenant.slug)}/${target}` : `/onboarding/${encodeURIComponent(tenant.slug)}` };
    });
}

export async function endPlatformSupport(userId: string, grantId: unknown) {
    if (typeof grantId !== "string") throw new ControlValidationError("La sesión de soporte no es válida.");
    const db = getControlDb();
    await db.$transaction(async (tx) => {
        const setting = await tx.platformRuntimeSetting.findUnique({ where: { key: keyFor(userId) } });
        const grant = setting?.value as unknown as SupportGrant | undefined;
        if (!grant || grant.id !== grantId || grant.adminUserId !== userId) return;
        const deleted = await tx.platformRuntimeSetting.deleteMany({ where: { key: keyFor(userId), value: { path: ["id"], equals: grantId } } });
        if (!deleted.count) return; // A different tab may already have opened a new session.
        await tx.auditLog.create({ data: {
            actorUserId: userId, tenantId: grant.tenantId, action: "support.workspace.ended",
            resourceType: "SupportSession", resourceId: grant.id, metadata: { mode: grant.mode },
        } });
    });
}
