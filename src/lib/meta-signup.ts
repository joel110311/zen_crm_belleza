export type MetaSignupMode = "cloud" | "coexistence";

export const META_COEXISTENCE_GUIDANCE = "En Meta, elige la opción para ingresar un número (puede decir «Crea uno nuevo») y captura el que ya usas en WhatsApp Business; no elijas un número virtual. Meta v4 detecta tu cuenta existente y debe mostrar su perfil y el QR de coexistencia. Si te pide borrar la cuenta o migrarla fuera del celular, no continúes. Compartir el historial con el CRM es opcional.";

export function metaSignupExtras(mode: MetaSignupMode, solutionId?: string) {
    // v4 is selected by the Login for Business configuration's products, not version: "v4".
    return { setup: solutionId ? { solutionID: solutionId } : {}, sessionInfoVersion: "3",
        ...(mode === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}) };
}

/** Wait for Meta without extending the signed server ceremony. */
export function metaSignupWaitMs(expiresAt?: string, now = Date.now()) {
    const maximum = 10 * 60_000;
    const expiration = expiresAt ? Date.parse(expiresAt) : NaN;
    return Number.isFinite(expiration) ? Math.max(0, Math.min(maximum, expiration - now - 5_000)) : maximum;
}

/** Generic FINISH must not switch a requested coexistence to exclusive API registration. */
export function metaSignupCompletionData(requestedMode: MetaSignupMode, received: { wabaId: string; phoneNumberId: string; businessId: string }) {
    return { wabaId: received.wabaId, phoneNumberId: received.phoneNumberId, businessId: received.businessId, mode: requestedMode };
}

export function isMetaSignupOrigin(origin: string) {
    return /^https:\/\/(?:www\.|web\.|business\.)?facebook\.com$/i.test(origin);
}

export function metaSignupFailure(data: unknown): string | null {
    let raw = data;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
    if (!raw || typeof raw !== "object") return null;
    const value = raw as { type?: unknown; event?: unknown };
    if (value.type !== "WA_EMBEDDED_SIGNUP") return null;
    if (value.event === "CANCEL") return "Cancelaste la conexión con Meta. Tu cuenta del celular no se modificó desde el CRM.";
    if (value.event === "ERROR") return "Meta no pudo completar la conexión. Revisa los requisitos indicados en su ventana e inténtalo de nuevo.";
    return null;
}

export function parseMetaSignupMessage(data: unknown) {
    let raw = data;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
    if (!raw || typeof raw !== "object") return null;
    const value = raw as { type?: unknown; event?: unknown; data?: Record<string, unknown> };
    if (value.type !== "WA_EMBEDDED_SIGNUP" || !value.data) return null;
    if (value.event !== "FINISH" && value.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return null;
    const wabaId = typeof value.data.waba_id === "string" ? value.data.waba_id : "";
    const phoneNumberId = typeof value.data.phone_number_id === "string" ? value.data.phone_number_id : "";
    if (!wabaId || (value.event === "FINISH" && !phoneNumberId)) return null;
    return { wabaId, phoneNumberId, businessId: typeof value.data.business_id === "string" ? value.data.business_id : "",
        mode: (value.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ? "coexistence" : "cloud") as MetaSignupMode };
}
