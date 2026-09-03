import { TenantServiceError } from "@/lib/tenant-services/context";

export function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TenantServiceError("VALIDATION_ERROR", "El cuerpo de la solicitud no es válido.");
    }
    return value as Record<string, unknown>;
}

export function text(
    value: unknown,
    field: string,
    options: { required?: boolean; max?: number; fallback?: string } = {},
) {
    const result = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : (options.fallback ?? "");
    if (options.required && !result) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} es obligatorio.`, { field });
    }
    if (options.max && result.length > options.max) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} no puede exceder ${options.max} caracteres.`, { field });
    }
    return result;
}

export function optionalText(value: unknown, field: string, max: number) {
    const result = text(value, field, { max });
    return result || null;
}

export function numberValue(
    value: unknown,
    field: string,
    options: { min?: number; max?: number; fallback?: number; integer?: boolean } = {},
) {
    const parsed = typeof value === "number" ? value : (typeof value === "string" && value.trim() ? Number(value) : options.fallback);
    if (parsed === undefined || !Number.isFinite(parsed)) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} debe ser un número válido.`, { field });
    }
    if (options.integer && !Number.isInteger(parsed)) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} debe ser un número entero.`, { field });
    }
    if (options.min !== undefined && parsed < options.min) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} debe ser mayor o igual a ${options.min}.`, { field });
    }
    if (options.max !== undefined && parsed > options.max) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} debe ser menor o igual a ${options.max}.`, { field });
    }
    return parsed;
}

export function booleanValue(value: unknown, fallback: boolean) {
    return typeof value === "boolean" ? value : fallback;
}

export function stringArray(value: unknown, field: string, maxItems = 30, maxLength = 80) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} debe ser una lista.`, { field });
    }
    if (value.length > maxItems) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} contiene demasiados elementos.`, { field });
    }
    return [...new Set(value.map((item) => text(item, field, { required: true, max: maxLength })))];
}

export function dateValue(value: unknown, field: string, options: { required?: boolean } = {}) {
    if ((value === undefined || value === null || value === "") && !options.required) return null;
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} no contiene una fecha válida.`, { field });
    }
    return parsed;
}

export function emailValue(value: unknown, field = "Correo") {
    const email = optionalText(value, field, 160)?.toLowerCase() || null;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        throw new TenantServiceError("VALIDATION_ERROR", `${field} no es válido.`, { field });
    }
    return email;
}

export function identifier(value: unknown, field = "Identificador") {
    return text(value, field, { required: true, max: 100 });
}
