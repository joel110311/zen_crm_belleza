import "server-only";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashSecurityIdentifier } from "@/lib/security";
import { inspectTenantObject, presignTenantObjectDownload, presignTenantObjectUpload } from "@/lib/tenant-object-storage";
import { TenantServiceError } from "@/lib/tenant-services/context";
import { enqueueTenantWork } from "@/lib/tenant-work-queue";

const maxUploadBytes = (() => {
    const value = Number.parseInt(process.env.TENANT_STORAGE_MAX_UPLOAD_BYTES || "26214400", 10);
    return Number.isSafeInteger(value) && value >= 1_024 * 1_024 && value <= 100 * 1_024 * 1_024
        ? value
        : 25 * 1_024 * 1_024;
})();

const allowedMimeTypes = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "audio/mpeg", "audio/ogg", "audio/opus", "audio/wav", "audio/mp4", "audio/aac", "audio/amr",
    "video/mp4", "video/webm", "video/quicktime",
    "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv",
]);

const extensionByMime: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "application/pdf": "pdf", "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt", "text/csv": "csv",
};

function text(value: unknown, field: string, maxLength: number) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || normalized.length > maxLength) {
        throw new TenantServiceError("VALIDATION_ERROR", `El campo ${field} no es válido.`);
    }
    return normalized;
}

function normalizeMimeType(value: unknown) {
    const mimeType = text(value, "mimeType", 120).toLowerCase().split(";")[0].trim();
    if (!allowedMimeTypes.has(mimeType)) {
        throw new TenantServiceError("VALIDATION_ERROR", "El tipo de archivo no está permitido.");
    }
    return mimeType;
}

function normalizeSize(value: unknown) {
    const size = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxUploadBytes) {
        throw new TenantServiceError("VALIDATION_ERROR", `El archivo debe medir entre 1 byte y ${maxUploadBytes} bytes.`);
    }
    return size;
}

function normalizeSha256(value: unknown) {
    const digest = text(value, "sha256", 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) {
        throw new TenantServiceError("VALIDATION_ERROR", "sha256 debe ser un hash SHA-256 hexadecimal.");
    }
    return digest;
}

function extension(fileName: string, mimeType: string) {
    const candidate = fileName.split(".").pop()?.toLowerCase() || "";
    return /^[a-z0-9]{1,8}$/.test(candidate) ? candidate : extensionByMime[mimeType] || "bin";
}

function requestHash(tenantId: string, idempotencyKey: string) {
    return hashSecurityIdentifier(`tenant-private-file:${tenantId}:${idempotencyKey}`);
}

function ensureIdempotencyKey(value: string | null) {
    const key = value?.trim() || "";
    if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key)) {
        throw new TenantServiceError("VALIDATION_ERROR", "Envía un encabezado Idempotency-Key válido (8 a 200 caracteres).");
    }
    return key;
}

function canDownload(file: { status: string; antivirusStatus: string }) {
    return file.status === "READY" && ["NOT_REQUESTED", "CLEAN"].includes(file.antivirusStatus);
}

export async function createPrivateFileUpload(params: {
    db: PrismaClient;
    tenantId: string;
    actorId: string;
    idempotencyKey: string | null;
    input: Record<string, unknown>;
}) {
    const resourceType = text(params.input.resourceType, "resourceType", 80);
    const resourceId = text(params.input.resourceId, "resourceId", 160);
    const originalFileName = text(params.input.fileName, "fileName", 255).replace(/[\u0000-\u001F<>:"/\\|?*]+/g, "-");
    const mimeType = normalizeMimeType(params.input.mimeType);
    const sizeBytes = normalizeSize(params.input.sizeBytes);
    const digest = normalizeSha256(params.input.sha256);
    const key = ensureIdempotencyKey(params.idempotencyKey);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(resourceType) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(resourceId)) {
        throw new TenantServiceError("VALIDATION_ERROR", "El recurso del archivo no es válido.");
    }

    const requestKeyHash = requestHash(params.tenantId, key);
    const existing = await params.db.privateFile.findUnique({ where: { requestKeyHash } });
    if (existing) {
        if (existing.resourceType !== resourceType || existing.resourceId !== resourceId || existing.sha256 !== digest || existing.sizeBytes !== sizeBytes || existing.mimeType !== mimeType) {
            throw new TenantServiceError("CONFLICT", "La clave de idempotencia ya se usó con otro archivo.");
        }
        if (existing.status === "DELETED") throw new TenantServiceError("CONFLICT", "La carga anterior ya fue eliminada.");
        if (existing.status === "READY") return { file: existing, upload: null, alreadyComplete: true };
        const upload = presignTenantObjectUpload({ key: existing.storageKey, mimeType: existing.mimeType, sha256: existing.sha256 });
        return { file: existing, upload, alreadyComplete: false };
    }

    const storageKey = `tenants/${params.tenantId}/${resourceType}/${resourceId}/${crypto.randomUUID()}.${extension(originalFileName, mimeType)}`;
    const upload = presignTenantObjectUpload({ key: storageKey, mimeType, sha256: digest });
    const file = await params.db.privateFile.create({
        data: {
            storageKey,
            resourceType,
            resourceId,
            originalFileName,
            mimeType,
            sizeBytes,
            sha256: digest,
            requestKeyHash,
            uploadedByUserId: params.actorId,
            uploadExpiresAt: upload.expiresAt,
        },
    });
    return { file, upload, alreadyComplete: false };
}

export async function confirmPrivateFileUpload(params: { db: PrismaClient; fileId: string }) {
    const file = await params.db.privateFile.findUnique({ where: { id: params.fileId } });
    if (!file) throw new TenantServiceError("NOT_FOUND", "No se encontró el archivo.");
    if (file.status === "READY") return file;
    if (file.status !== "PENDING_UPLOAD") throw new TenantServiceError("CONFLICT", "El archivo ya no puede confirmarse.");
    if (file.uploadExpiresAt && file.uploadExpiresAt <= new Date()) {
        throw new TenantServiceError("CONFLICT", "La URL de carga venció. Solicita una nueva carga con la misma clave de idempotencia.");
    }

    const object = await inspectTenantObject(file.storageKey);
    if (!object || object.sizeBytes !== file.sizeBytes || object.mimeType !== file.mimeType || object.sha256 !== file.sha256) {
        await params.db.privateFile.update({
            where: { id: file.id },
            data: { status: "FAILED", antivirusDetail: "La metadata del objeto no coincide con la carga autorizada." },
        });
        throw new TenantServiceError("CONFLICT", "El archivo almacenado no coincide con la carga autorizada.");
    }

    const antivirusStatus = process.env.TENANT_STORAGE_REQUIRE_ANTIVIRUS === "true" ? "PENDING" : "NOT_REQUESTED";
    return params.db.privateFile.update({
        where: { id: file.id },
        data: { status: "READY", antivirusStatus, confirmedAt: new Date(), uploadExpiresAt: null },
    });
}

export async function getPrivateFileDownload(params: { db: PrismaClient; fileId: string }) {
    const file = await params.db.privateFile.findUnique({ where: { id: params.fileId } });
    if (!file) throw new TenantServiceError("NOT_FOUND", "No se encontró el archivo.");
    if (!canDownload(file)) throw new TenantServiceError("CONFLICT", "El archivo todavía no está disponible para descarga.");
    return { file, download: presignTenantObjectDownload(file.storageKey) };
}

export async function createPrivateFilePublicToken(params: { db: PrismaClient; fileId: string; expiresInMinutes: number }) {
    const file = await params.db.privateFile.findUnique({ where: { id: params.fileId } });
    if (!file) throw new TenantServiceError("NOT_FOUND", "No se encontró el archivo.");
    if (!canDownload(file)) throw new TenantServiceError("CONFLICT", "El archivo todavía no está disponible para compartir.");
    if (!Number.isSafeInteger(params.expiresInMinutes) || params.expiresInMinutes < 1 || params.expiresInMinutes > 10_080) {
        throw new TenantServiceError("VALIDATION_ERROR", "La vigencia debe estar entre 1 minuto y 7 días.");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + params.expiresInMinutes * 60_000);
    await params.db.privateFile.update({
        where: { id: file.id },
        data: {
            publicAccessTokenHash: hashSecurityIdentifier(`tenant-private-file-public:${token}`),
            publicAccessExpiresAt: expiresAt,
        },
    });
    return { token, expiresAt };
}

export async function getPublicPrivateFileDownload(db: PrismaClient, token: string) {
    const file = await db.privateFile.findUnique({
        where: { publicAccessTokenHash: hashSecurityIdentifier(`tenant-private-file-public:${token}`) },
    });
    if (!file || !file.publicAccessExpiresAt || file.publicAccessExpiresAt <= new Date() || !canDownload(file)) return null;
    return { file, download: presignTenantObjectDownload(file.storageKey) };
}

export async function deletePrivateFile(params: { db: PrismaClient; tenantId: string; fileId: string }) {
    const file = await params.db.privateFile.findUnique({ where: { id: params.fileId } });
    if (!file) throw new TenantServiceError("NOT_FOUND", "No se encontró el archivo.");
    if (file.status === "DELETED") return file;
    const deleted = await params.db.privateFile.update({
        where: { id: file.id },
        data: { status: "DELETED", deletedAt: new Date(), publicAccessTokenHash: null, publicAccessExpiresAt: null },
    });
    await enqueueTenantWork({
        tenantId: params.tenantId,
        kind: "MAINTENANCE",
        recordId: file.id,
        idempotencyKey: `private-file-delete:${params.tenantId}:${file.id}`,
        payload: { action: "delete_private_object", storageKey: file.storageKey, fileId: file.id },
    });
    return deleted;
}
