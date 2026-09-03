import "server-only";
import type { TenantRuntimeContext } from "@/lib/tenant-context";

export type TenantPermission =
    | "services.read"
    | "services.write"
    | "specialists.read"
    | "specialists.write"
    | "contacts.read"
    | "contacts.write"
    | "calendar.read"
    | "calendar.write"
    | "pipeline.read"
    | "pipeline.write"
    | "team.read"
    | "team.write"
    | "channels.read"
    | "channels.write"
    | "files.read"
    | "files.write";

export type TenantServiceContext = TenantRuntimeContext & {
    requestId: string;
};

const ROLE_PERMISSIONS: Record<TenantRuntimeContext["role"], readonly TenantPermission[]> = {
    OWNER: [
        "services.read", "services.write", "specialists.read", "specialists.write",
        "contacts.read", "contacts.write",
        "calendar.read", "calendar.write", "pipeline.read", "pipeline.write",
        "team.read", "team.write",
        "channels.read", "channels.write", "files.read", "files.write",
    ],
    ADMIN: [
        "services.read", "services.write", "specialists.read", "specialists.write",
        "contacts.read", "contacts.write",
        "calendar.read", "calendar.write", "pipeline.read", "pipeline.write",
        "team.read", "team.write",
        "channels.read", "channels.write", "files.read", "files.write",
    ],
    RECEPTION: [
        "services.read", "specialists.read", "contacts.read", "contacts.write",
        "calendar.read", "calendar.write", "pipeline.read", "pipeline.write",
        "files.read", "files.write",
    ],
    PROFESSIONAL: [
        "services.read", "specialists.read", "contacts.read",
        "calendar.read", "calendar.write",
        "files.read", "files.write",
    ],
};

export function hasTenantPermission(context: TenantRuntimeContext, permission: TenantPermission) {
    return ROLE_PERMISSIONS[context.role].includes(permission);
}

export function assertTenantPermission(context: TenantRuntimeContext, permission: TenantPermission) {
    if (!hasTenantPermission(context, permission)) {
        throw new TenantServiceError("FORBIDDEN", "No tienes permiso para realizar esta acción.");
    }
}

export type TenantServiceErrorCode =
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "CONFLICT"
    | "FORBIDDEN";

export class TenantServiceError extends Error {
    constructor(
        public readonly code: TenantServiceErrorCode,
        message: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "TenantServiceError";
    }
}
