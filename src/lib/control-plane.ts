import "server-only";
import bcrypt from "bcryptjs";
import { getControlDb } from "@/lib/control-db";
import { Prisma } from "@/generated/control-plane";

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export type TenantProvisioningRequestInput = {
    ownerUserId: string;
    displayName: string;
    slug: string;
    timeZone?: string;
    idempotencyKey: string;
};

export type TenantProvisioningRequest = {
    tenantId: string;
    slug: string;
    displayName: string;
    provisioningStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RETRY_WAIT" | "CANCELLED";
    jobId: string;
    jobStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RETRY_WAIT" | "CANCELLED";
};

export type TenantAccess = {
    tenantId: string;
    slug: string;
    displayName: string;
    timeZone: string;
    role: "OWNER" | "ADMIN" | "PROFESSIONAL" | "RECEPTION";
    status: "PROVISIONING" | "READY" | "SUSPENDED" | "ARCHIVED" | "FAILED";
    accessMode: "FULL" | "READ_ONLY" | "BILLING_ONLY" | "SUSPENDED";
};

export type CreateControlUserInput = {
    email: string;
    password: string;
    name?: string;
};

export type CreateControlTenantSignupInput = CreateControlUserInput & {
    displayName: string;
    slug: string;
    timeZone?: string;
    idempotencyKey: string;
};

export type ControlUser = {
    id: string;
    email: string;
    name: string;
};

function normalizeControlUserInput(input: CreateControlUserInput) {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const name = input.name?.trim() || null;

    if (!/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error("El correo electrónico no es válido.");
    }

    if (password.length < 12 || password.length > 128) {
        throw new Error("La contraseña debe tener entre 12 y 128 caracteres.");
    }

    if (name && name.length > 160) {
        throw new Error("El nombre es demasiado largo.");
    }

    return { email, password, name };
}

export async function createControlUser(input: CreateControlUserInput): Promise<ControlUser> {
    const { email, password, name } = normalizeControlUserInput(input);

    try {
        const user = await getControlDb().user.create({
            data: {
                email,
                name,
                passwordHash: await bcrypt.hash(password, 12),
            },
            select: {
                id: true,
                email: true,
                name: true,
            },
        });

        return {
            id: user.id,
            email: user.email,
            name: user.name || user.email,
        };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new Error("Ya existe una cuenta con este correo electrónico.");
        }
        throw error;
    }
}

async function getExistingSignupRequest(idempotencyKey: string, email: string) {
    const existingJob = await getControlDb().provisioningJob.findUnique({
        where: { idempotencyKey },
        include: {
            tenant: {
                select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    provisioningStatus: true,
                    createdBy: { select: { email: true } },
                },
            },
        },
    });

    if (!existingJob) {
        return null;
    }

    if (existingJob.tenant.createdBy?.email !== email) {
        throw new Error("No se pudo continuar el registro.");
    }

    return toProvisioningRequest(existingJob);
}

/**
 * Creates the global identity, owner membership, tenant and provisioning job in one transaction.
 * The idempotency key lets the public form be retried without allocating another tenant database.
 */
export async function createControlTenantSignup(
    input: CreateControlTenantSignupInput,
): Promise<TenantProvisioningRequest> {
    const { email, password, name } = normalizeControlUserInput(input);
    const displayName = input.displayName.trim();
    const slug = normalizeTenantSlug(input.slug);
    const timeZone = input.timeZone?.trim() || "America/Mexico_City";
    const idempotencyKey = input.idempotencyKey.trim();

    if (!displayName || displayName.length > 160 || !idempotencyKey || idempotencyKey.length > 200) {
        throw new Error("Completa los datos requeridos del negocio.");
    }

    const existing = await getExistingSignupRequest(idempotencyKey, email);
    if (existing) {
        return existing;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const db = getControlDb();

    try {
        return await db.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: { email, name, passwordHash },
                select: { id: true },
            });
            const tenant = await tx.tenant.create({
                data: {
                    slug,
                    displayName,
                    timeZone,
                    createdByUserId: user.id,
                    memberships: { create: { userId: user.id, role: "OWNER" } },
                },
                select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    provisioningStatus: true,
                },
            });
            const job = await tx.provisioningJob.create({
                data: {
                    tenantId: tenant.id,
                    kind: "CREATE_TENANT_DATABASE",
                    idempotencyKey,
                    payload: { requestedByUserId: user.id, source: "public-signup" },
                },
                select: { id: true, status: true },
            });

            return toProvisioningRequest({ ...job, tenant });
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const retried = await getExistingSignupRequest(idempotencyKey, email);
            if (retried) {
                return retried;
            }

            const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target || "");
            if (target.includes("email")) {
                throw new Error("Ya existe una cuenta con este correo electrónico. Inicia sesión para continuar.");
            }
            if (target.includes("slug")) {
                throw new Error("Ese identificador de negocio ya está en uso. Elige otro.");
            }
        }
        throw error;
    }
}

export function normalizeTenantSlug(value: string): string {
    const slug = value
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (!tenantSlugPattern.test(slug)) {
        throw new Error("El identificador del negocio debe tener entre 3 y 48 caracteres: letras, números o guiones.");
    }

    return slug;
}

function toProvisioningRequest(job: {
    id: string;
    status: TenantProvisioningRequest["jobStatus"];
    tenant: {
        id: string;
        slug: string;
        displayName: string;
        provisioningStatus: TenantProvisioningRequest["provisioningStatus"];
    };
}): TenantProvisioningRequest {
    return {
        tenantId: job.tenant.id,
        slug: job.tenant.slug,
        displayName: job.tenant.displayName,
        provisioningStatus: job.tenant.provisioningStatus,
        jobId: job.id,
        jobStatus: job.status,
    };
}

/**
 * Registers an already-authenticated global user as a tenant owner and queues exactly one
 * database-creation job for an idempotency key. The trial starts only after the worker marks
 * the tenant database READY.
 */
export async function createTenantProvisioningRequest(
    input: TenantProvisioningRequestInput,
): Promise<TenantProvisioningRequest> {
    const ownerUserId = input.ownerUserId.trim();
    const displayName = input.displayName.trim();
    const slug = normalizeTenantSlug(input.slug);
    const timeZone = input.timeZone?.trim() || "America/Mexico_City";
    const idempotencyKey = input.idempotencyKey.trim();

    if (!ownerUserId || !displayName || !idempotencyKey) {
        throw new Error("ownerUserId, displayName e idempotencyKey son obligatorios.");
    }

    if (displayName.length > 160 || timeZone.length > 100 || idempotencyKey.length > 200) {
        throw new Error("Uno de los valores de alta excede el tamaño permitido.");
    }

    const db = getControlDb();
    const existingJob = await db.provisioningJob.findUnique({
        where: { idempotencyKey },
        include: {
            tenant: {
                select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    provisioningStatus: true,
                },
            },
        },
    });

    if (existingJob) {
        return toProvisioningRequest(existingJob);
    }

    try {
        return await db.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    slug,
                    displayName,
                    timeZone,
                    createdByUserId: ownerUserId,
                    memberships: {
                        create: {
                            userId: ownerUserId,
                            role: "OWNER",
                        },
                    },
                },
                select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    provisioningStatus: true,
                },
            });

            const job = await tx.provisioningJob.create({
                data: {
                    tenantId: tenant.id,
                    kind: "CREATE_TENANT_DATABASE",
                    idempotencyKey,
                    payload: {
                        requestedByUserId: ownerUserId,
                    },
                },
                select: {
                    id: true,
                    status: true,
                },
            });

            return toProvisioningRequest({ ...job, tenant });
        });
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
        }

        const concurrentJob = await db.provisioningJob.findUnique({
            where: { idempotencyKey },
            include: {
                tenant: {
                    select: {
                        id: true,
                        slug: true,
                        displayName: true,
                        provisioningStatus: true,
                    },
                },
            },
        });

        if (concurrentJob) {
            return toProvisioningRequest(concurrentJob);
        }

        throw error;
    }
}

/**
 * Resolves a tenant only when the specified global user has an active membership.
 * Callers must still check the returned status and accessMode for the requested operation.
 */
export async function getTenantAccessForUser(
    userId: string,
    rawSlug: string,
): Promise<TenantAccess | null> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return null;
    }
    if (await getControlDb().accountDeletion.findUnique({ where: { userId: normalizedUserId } })) return null;

    const slug = normalizeTenantSlug(rawSlug);
    const tenant = await getControlDb().tenant.findUnique({
        where: { slug },
        select: {
            id: true,
            slug: true,
            displayName: true,
            timeZone: true,
            status: true,
            accessMode: true,
            memberships: {
                where: {
                    userId: normalizedUserId,
                    isActive: true,
                },
                select: {
                    role: true,
                },
                take: 1,
            },
        },
    });

    const membership = tenant?.memberships[0];
    if (!tenant || !membership) {
        return null;
    }

    return {
        tenantId: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        timeZone: tenant.timeZone,
        role: membership.role,
        status: tenant.status,
        accessMode: tenant.accessMode,
    };
}
