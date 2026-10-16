import type { LeadIntelligence, Prisma } from "@prisma/client";

export type ContactAiState = Omit<LeadIntelligence, "id" | "dealId" | "createdAt" | "updatedAt">;
const dateFields = ["askedForNameAt", "askedForEmailAt", "capturedNameAt", "capturedEmailAt", "interestDetectedAt", "lastScoredAt"] as const;

export function readContactAiState(value: unknown, email: string | null = null): ContactAiState {
    const defaults: ContactAiState = {
        score: 0, interestStatus: "nuevo", currentStep: "inicio", stepProgress: 0,
        pendingCaptureField: null, nameCaptured: false, emailCaptured: Boolean(email),
        nameDeclined: false, emailDeclined: false, capturedName: null, capturedEmail: email,
        askedForNameAt: null, askedForEmailAt: null, capturedNameAt: null, capturedEmailAt: email ? new Date() : null,
        interestDetectedAt: null, lastScoredAt: null, sameDayInboundCount: 0, lastSummary: null, signals: null,
    };
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const source = value as Record<string, unknown>;
    const state = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof ContactAiState)[]) {
        if (dateFields.includes(key as typeof dateFields[number])) continue;
        if (key === "signals") { state.signals = (source.signals ?? null) as Prisma.JsonValue; continue; }
        const candidate = source[key];
        if (typeof candidate === typeof defaults[key] || (defaults[key] === null && (candidate === null || typeof candidate === "string"))) {
            Object.assign(state, { [key]: candidate });
        }
    }
    for (const key of dateFields) {
        if (!Object.hasOwn(source, key)) continue;
        // PostgreSQL's timestamp-without-time-zone JSON represents UTC but has no suffix.
        const text = typeof source[key] === "string" ? source[key] as string : null;
        const date = text ? new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`) : source[key] instanceof Date ? source[key] as Date : null;
        state[key] = date && Number.isFinite(date.getTime()) ? date : null;
    }
    if (!state.emailCaptured && email) { state.emailCaptured = true; state.capturedEmail = email; state.capturedEmailAt ||= new Date(); }
    return state;
}

export function contactAiStateJson(state: ContactAiState): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
}
