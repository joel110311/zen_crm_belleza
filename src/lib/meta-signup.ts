export type MetaSignupMode = "cloud" | "coexistence";

export function metaSignupExtras(mode: MetaSignupMode, solutionId?: string) {
    return { setup: solutionId ? { solutionID: solutionId } : {}, version: "v4", sessionInfoVersion: "3",
        ...(mode === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}) };
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
