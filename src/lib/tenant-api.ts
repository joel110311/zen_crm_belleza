import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isMultitenantRuntimeEnabled } from "@/lib/multitenant-features";
import { isSameApplicationOrigin } from "@/lib/security";
import {
    requireTenantRuntimeContext,
    TenantAccessDeniedError,
    type TenantOperation,
} from "@/lib/tenant-context";
import { TenantDatabaseUnavailableError } from "@/lib/tenant-prisma-manager";
import {
    assertTenantPermission,
    TenantServiceError,
    type TenantPermission,
    type TenantServiceContext,
} from "@/lib/tenant-services/context";

type TenantApiOptions = {
    operation?: TenantOperation;
    permission: TenantPermission;
};

type ApiErrorBody = {
    error: {
        code: string;
        message: string;
        requestId: string;
        details?: Record<string, unknown>;
    };
};

function cleanRequestId(value: string | null) {
    return value && /^[a-zA-Z0-9._:-]{8,100}$/.test(value) ? value : randomUUID();
}

export function tenantData<T>(data: T, requestId: string, status = 200) {
    return NextResponse.json({ data, meta: { requestId } }, {
        status,
        headers: { "x-request-id": requestId },
    });
}

function tenantError(
    requestId: string,
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>,
) {
    const body: ApiErrorBody = { error: { code, message, requestId } };
    if (details) body.error.details = details;
    return NextResponse.json(body, {
        status,
        headers: { "x-request-id": requestId },
    });
}

function accessError(error: TenantAccessDeniedError, requestId: string) {
    switch (error.reason) {
        case "TENANT_NOT_READY":
            return tenantError(requestId, error.reason, error.message, 409);
        case "BILLING_REQUIRED":
            return tenantError(requestId, error.reason, error.message, 402);
        case "TENANT_SUSPENDED":
        case "READ_ONLY":
            return tenantError(requestId, error.reason, error.message, 403);
        default:
            return tenantError(requestId, "TENANT_NOT_FOUND", "No se encontró el negocio solicitado.", 404);
    }
}

function mapApiError(error: unknown, requestId: string) {
    if (error instanceof TenantAccessDeniedError) return accessError(error, requestId);
    if (error instanceof TenantDatabaseUnavailableError) {
        return tenantError(requestId, "TENANT_DATABASE_UNAVAILABLE", error.message, 503);
    }

    if (error instanceof TenantServiceError) {
        const status = error.code === "VALIDATION_ERROR"
            ? 400
            : error.code === "NOT_FOUND"
                ? 404
                : error.code === "CONFLICT"
                    ? 409
                    : 403;
        return tenantError(requestId, error.code, error.message, status, error.details);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return tenantError(requestId, "CONFLICT", "Ya existe un registro con esos datos.", 409);
        }
        if (error.code === "P2003") {
            return tenantError(requestId, "CONFLICT", "El registro está relacionado con otros datos y no se puede eliminar.", 409);
        }
        if (error.code === "P2025") {
            return tenantError(requestId, "NOT_FOUND", "No se encontró el registro solicitado.", 404);
        }
        if (error.code === "P2034") {
            return tenantError(requestId, "CONFLICT", "Los datos cambiaron al mismo tiempo. Vuelve a intentarlo.", 409);
        }
    }

    return tenantError(requestId, "INTERNAL_ERROR", "Ocurrió un error inesperado.", 500);
}

/**
 * Resolves auth, tenant membership, access mode, isolated DB and role permission in one place.
 * Route handlers never receive a global Prisma client.
 */
export async function withTenantApi(
    request: Request,
    tenantSlug: string,
    options: TenantApiOptions,
    handler: (context: TenantServiceContext) => Promise<NextResponse>,
) {
    const requestId = cleanRequestId(request.headers.get("x-request-id"));

    try {
        if (!isMultitenantRuntimeEnabled()) {
            return tenantError(requestId, "NOT_FOUND", "No se encontró el recurso solicitado.", 404);
        }

        if ((options.operation ?? "read") === "write" && !isSameApplicationOrigin(request)) {
            return tenantError(requestId, "INVALID_ORIGIN", "El origen de la solicitud no es válido.", 403);
        }

        const session = await auth();
        const user = session?.user as { id?: unknown; authScope?: unknown } | undefined;
        if (typeof user?.id !== "string" || user.authScope !== "control") {
            return tenantError(requestId, "UNAUTHORIZED", "Debes iniciar sesión.", 401);
        }

        const runtime = await requireTenantRuntimeContext(
            user.id,
            tenantSlug,
            options.operation ?? "read",
        );
        assertTenantPermission(runtime, options.permission);
        return await handler({ ...runtime, requestId });
    } catch (error) {
        return mapApiError(error, requestId);
    }
}

export async function readTenantJson(request: Request) {
    try {
        return await request.json() as unknown;
    } catch {
        throw new TenantServiceError("VALIDATION_ERROR", "El cuerpo JSON no es válido.");
    }
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, stableValue(child)]),
        );
    }
    return value;
}

function payloadHash(payload: unknown) {
    return createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

function idempotencyKey(request: Request) {
    const key = request.headers.get("idempotency-key")?.trim() || "";
    if (key.length < 8 || key.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
        throw new TenantServiceError(
            "VALIDATION_ERROR",
            "Envía un encabezado Idempotency-Key válido (8 a 200 caracteres).",
            { field: "Idempotency-Key" },
        );
    }
    return key;
}

/** Saves successful mutation responses in the tenant DB and replays them on safe retries. */
export async function runTenantMutation<T>(
    context: TenantServiceContext,
    request: Request,
    payload: unknown,
    action: () => Promise<T>,
    status = 200,
) {
    const key = idempotencyKey(request);
    const scope = `${request.method.toUpperCase()}:${new URL(request.url).pathname}`;
    const requestHash = payloadHash(payload);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await context.db.apiMutationReceipt.deleteMany({
        where: { scope, key, expiresAt: { lte: new Date() } },
    });

    try {
        await context.db.apiMutationReceipt.create({
            data: { scope, key, requestHash, requestId: context.requestId, expiresAt },
        });
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;

        const previous = await context.db.apiMutationReceipt.findUnique({
            where: { scope_key: { scope, key } },
        });
        if (!previous || previous.requestHash !== requestHash) {
            throw new TenantServiceError("CONFLICT", "La clave de idempotencia ya se usó con otros datos.");
        }
        if (previous.response !== null && previous.statusCode !== null) {
            return NextResponse.json(previous.response, {
                status: previous.statusCode,
                headers: {
                    "x-request-id": previous.requestId,
                    "idempotent-replayed": "true",
                },
            });
        }
        throw new TenantServiceError("CONFLICT", "La solicitud con esta clave todavía está en proceso.");
    }

    try {
        const data = await action();
        const response = JSON.parse(JSON.stringify({
            data,
            meta: { requestId: context.requestId },
        })) as Prisma.InputJsonObject;
        await context.db.apiMutationReceipt.update({
            where: { scope_key: { scope, key } },
            data: {
                response,
                statusCode: status,
            },
        });
        return NextResponse.json(response, {
            status,
            headers: { "x-request-id": context.requestId },
        });
    } catch (error) {
        await context.db.apiMutationReceipt.deleteMany({ where: { scope, key } });
        throw error;
    }
}
