import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

const DEFAULT_GRAPH_API_VERSION = "v26.0";

type MetaConfig = {
    appId: string;
    appSecret: string;
    configId: string;
    solutionId: string;
    graphApiVersion: string;
    registrationPin: string;
    webhookVerifyToken: string;
    webhookBaseUrl: string;
};

type MetaGraphError = {
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        error_user_title?: string;
        error_user_msg?: string;
    };
};

function clean(value: string | null | undefined) {
    return (value || "").trim();
}

function graphVersion(value: string | null | undefined) {
    const normalized = clean(value) || DEFAULT_GRAPH_API_VERSION;
    return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function graphUrl(version: string, path: string) {
    return `https://graph.facebook.com/${graphVersion(version)}/${path.replace(/^\//, "")}`;
}

async function parseGraphResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({})) as T & MetaGraphError;
    if (!response.ok || payload.error) {
        const error = payload.error;
        const details = error?.error_user_msg || error?.message || `Meta Graph API respondio ${response.status}.`;
        const code = error?.code ? ` (codigo ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""})` : "";
        throw new Error(`${details}${code}`);
    }
    return payload;
}

async function graphRequest<T>(params: {
    version: string;
    path: string;
    accessToken: string;
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
}) {
    const method = params.method || "GET";
    const response = await fetch(graphUrl(params.version, params.path), {
        method,
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            ...(params.body ? { "Content-Type": "application/json" } : {}),
        },
        body: params.body ? JSON.stringify(params.body) : undefined,
        cache: "no-store",
    });
    return parseGraphResponse<T>(response);
}

export async function getMetaConfig(options: { requireSecrets?: boolean } = {}): Promise<MetaConfig> {
    const settings = await getSystemSettingsOrDefaults();
    const config: MetaConfig = {
        appId: clean(settings.whatsappMetaAppId || process.env.META_APP_ID),
        appSecret: clean(settings.whatsappMetaAppSecret || process.env.META_APP_SECRET),
        configId: clean(settings.whatsappEmbeddedSignupConfigId || process.env.META_EMBEDDED_SIGNUP_CONFIG_ID),
        solutionId: clean(settings.whatsappTechProviderSolutionId || process.env.META_TECH_PROVIDER_SOLUTION_ID),
        graphApiVersion: graphVersion(settings.whatsappGraphApiVersion || process.env.META_GRAPH_API_VERSION),
        registrationPin: clean(settings.whatsappRegistrationPin || process.env.META_WHATSAPP_REGISTRATION_PIN),
        webhookVerifyToken: clean(settings.whatsappWebhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN),
        webhookBaseUrl: clean(settings.whatsappWebhookBaseUrl || process.env.META_WEBHOOK_BASE_URL || process.env.APP_BASE_URL || process.env.AUTH_URL).replace(/\/$/, ""),
    };

    if (options.requireSecrets !== false) {
        const missing = [
            !config.appId && "App ID",
            !config.appSecret && "App Secret",
            !config.configId && "Configuration ID de Embedded Signup v4",
            !config.webhookVerifyToken && "token de verificacion del webhook",
            !config.webhookBaseUrl && "URL publica HTTPS",
        ].filter(Boolean);
        if (missing.length) throw new Error(`Falta configurar: ${missing.join(", ")}.`);
        if (!/^\d{6}$/.test(config.registrationPin)) {
            throw new Error("El PIN de registro de WhatsApp debe tener exactamente 6 digitos.");
        }
    }

    return config;
}

export async function getMetaSessionSnapshot() {
    const settings = await getSystemSettingsOrDefaults();
    const config = await getMetaConfig({ requireSecrets: false });
    return {
        metaConfigured: Boolean(config.appId && config.appSecret && config.configId && config.registrationPin && config.webhookVerifyToken && config.webhookBaseUrl),
        metaConnected: Boolean(settings.whatsappAccessToken && settings.whatsappPhoneNumberId && settings.whatsappWabaId),
        appId: config.appId || null,
        configId: config.configId || null,
        solutionId: config.solutionId || null,
        graphApiVersion: config.graphApiVersion,
        phoneNumberId: settings.whatsappPhoneNumberId || null,
        displayPhoneNumber: settings.whatsappDisplayPhoneNumber || null,
        wabaId: settings.whatsappWabaId || null,
        businessId: settings.whatsappBusinessId || null,
        connectedAt: settings.whatsappConnectedAt || null,
        registrationPinConfigured: /^\d{6}$/.test(config.registrationPin),
        appSecretConfigured: Boolean(config.appSecret),
        webhookVerifyToken: config.webhookVerifyToken || null,
        webhookBaseUrl: config.webhookBaseUrl || null,
        webhookUrl: config.webhookBaseUrl ? `${config.webhookBaseUrl}/api/webhooks/whatsapp` : null,
    };
}

async function exchangeAuthorizationCode(config: MetaConfig, code: string) {
    const params = new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        code,
    });
    const response = await fetch(`${graphUrl(config.graphApiVersion, "oauth/access_token")}?${params}`, {
        cache: "no-store",
    });
    return parseGraphResponse<{ access_token: string; token_type?: string; expires_in?: number }>(response);
}

export async function completeMetaEmbeddedSignup(params: {
    code: string;
    wabaId: string;
    phoneNumberId: string;
    businessId?: string | null;
}) {
    const config = await getMetaConfig();
    const exchanged = await exchangeAuthorizationCode(config, params.code);
    if (!exchanged.access_token) throw new Error("Meta no devolvio un token de acceso empresarial.");

    const phone = await graphRequest<{
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        code_verification_status?: string;
    }>({
        version: config.graphApiVersion,
        path: `${params.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`,
        accessToken: exchanged.access_token,
    });

    const subscription = await graphRequest<{ success?: boolean }>({
        version: config.graphApiVersion,
        path: `${params.wabaId}/subscribed_apps`,
        accessToken: exchanged.access_token,
        method: "POST",
        body: {
            override_callback_uri: `${config.webhookBaseUrl}/api/webhooks/whatsapp`,
            verify_token: config.webhookVerifyToken,
            fields: ["messages", "account_update", "message_template_status_update"],
        },
    });

    const registration = await graphRequest<{ success?: boolean }>({
        version: config.graphApiVersion,
        path: `${params.phoneNumberId}/register`,
        accessToken: exchanged.access_token,
        method: "POST",
        body: { messaging_product: "whatsapp", pin: config.registrationPin },
    });

    const existing = await prisma.systemSettings.findFirst();
    const data = {
        whatsappWabaId: params.wabaId,
        whatsappPhoneNumberId: params.phoneNumberId,
        whatsappDisplayPhoneNumber: clean(phone.display_phone_number) || null,
        whatsappAccessToken: exchanged.access_token,
        whatsappBusinessId: clean(params.businessId) || null,
        whatsappConnectedAt: new Date(),
    };
    const settings = existing
        ? await prisma.systemSettings.update({ where: { id: existing.id }, data })
        : await prisma.systemSettings.create({ data });

    return { settings, phone, subscription, registration };
}

async function getConnectedCredentials() {
    const settings = await getSystemSettingsOrDefaults();
    const accessToken = clean(settings.whatsappAccessToken);
    const phoneNumberId = clean(settings.whatsappPhoneNumberId);
    const wabaId = clean(settings.whatsappWabaId);
    if (!accessToken || !phoneNumberId || !wabaId) {
        throw new Error("WhatsApp oficial no esta conectado mediante Embedded Signup.");
    }
    return { settings, accessToken, phoneNumberId, wabaId, version: graphVersion(settings.whatsappGraphApiVersion) };
}

export async function sendMetaTextMessage(to: string, body: string) {
    const credentials = await getConnectedCredentials();
    const payload = await graphRequest<{ messages?: Array<{ id?: string }> }>({
        version: credentials.version,
        path: `${credentials.phoneNumberId}/messages`,
        accessToken: credentials.accessToken,
        method: "POST",
        body: { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/\D/g, ""), type: "text", text: { preview_url: false, body } },
    });
    return { Id: payload.messages?.[0]?.id || null };
}

export async function sendMetaMediaMessage(params: {
    to: string;
    mediaType: "image" | "document" | "audio" | "video";
    link: string;
    caption?: string;
    fileName?: string;
}) {
    const credentials = await getConnectedCredentials();
    const media: Record<string, unknown> = { link: params.link };
    if (params.caption && params.mediaType !== "audio") media.caption = params.caption;
    if (params.fileName && params.mediaType === "document") media.filename = params.fileName;
    const payload = await graphRequest<{ messages?: Array<{ id?: string }> }>({
        version: credentials.version,
        path: `${credentials.phoneNumberId}/messages`,
        accessToken: credentials.accessToken,
        method: "POST",
        body: { messaging_product: "whatsapp", recipient_type: "individual", to: params.to.replace(/\D/g, ""), type: params.mediaType, [params.mediaType]: media },
    });
    return { Id: payload.messages?.[0]?.id || null };
}

export async function sendMetaTemplateMessage(params: {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: Array<Record<string, unknown>>;
}) {
    const credentials = await getConnectedCredentials();
    const payload = await graphRequest<{ messages?: Array<{ id?: string }> }>({
        version: credentials.version,
        path: `${credentials.phoneNumberId}/messages`,
        accessToken: credentials.accessToken,
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: params.to.replace(/\D/g, ""),
            type: "template",
            template: {
                name: params.templateName,
                language: { code: params.languageCode || "es" },
                ...(params.components?.length ? { components: params.components } : {}),
            },
        },
    });
    return { Id: payload.messages?.[0]?.id || null };
}

export async function sendMetaReaction(params: { to: string; providerMessageId: string; reaction: string | null }) {
    const credentials = await getConnectedCredentials();
    const payload = await graphRequest<{ messages?: Array<{ id?: string }> }>({
        version: credentials.version,
        path: `${credentials.phoneNumberId}/messages`,
        accessToken: credentials.accessToken,
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: params.to.replace(/\D/g, ""),
            type: "reaction",
            reaction: { message_id: params.providerMessageId, emoji: params.reaction || "" },
        },
    });
    return { Id: payload.messages?.[0]?.id || null };
}

export async function listMetaTemplates(params: { limit?: number } = {}) {
    const credentials = await getConnectedCredentials();
    const limit = Math.min(Math.max(params.limit || 100, 1), 100);
    const payload = await graphRequest<{
        data?: Array<Record<string, unknown>>;
        paging?: Record<string, unknown>;
    }>({
        version: credentials.version,
        path: `${credentials.wabaId}/message_templates?fields=id,name,status,language,category,components&limit=${limit}`,
        accessToken: credentials.accessToken,
    });
    return {
        items: (payload.data || []).map((template) => ({ ...template, wabaId: credentials.wabaId })),
        paging: payload.paging || null,
        wabaId: credentials.wabaId,
    };
}

export async function createMetaTemplate(payload: {
    name: string;
    category: string;
    language: string;
    components: Array<Record<string, unknown>>;
    allowCategoryChange?: boolean;
}) {
    const credentials = await getConnectedCredentials();
    return graphRequest<Record<string, unknown>>({
        version: credentials.version,
        path: `${credentials.wabaId}/message_templates`,
        accessToken: credentials.accessToken,
        method: "POST",
        body: {
            name: payload.name,
            category: payload.category,
            language: payload.language,
            components: payload.components,
            allow_category_change: payload.allowCategoryChange === true,
        },
    });
}

export async function deleteMetaTemplate(name: string) {
    const credentials = await getConnectedCredentials();
    return graphRequest<Record<string, unknown>>({
        version: credentials.version,
        path: `${credentials.wabaId}/message_templates?name=${encodeURIComponent(name)}`,
        accessToken: credentials.accessToken,
        method: "DELETE",
    });
}

export async function fetchMetaMedia(mediaId: string) {
    const credentials = await getConnectedCredentials();
    const descriptor = await graphRequest<{ url?: string; mime_type?: string; file_size?: number }>({
        version: credentials.version,
        path: mediaId,
        accessToken: credentials.accessToken,
    });
    if (!descriptor.url) throw new Error("Meta no devolvio la URL del archivo.");
    const response = await fetch(descriptor.url, { headers: { Authorization: `Bearer ${credentials.accessToken}` }, cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo descargar el archivo de Meta (${response.status}).`);
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: descriptor.mime_type || response.headers.get("content-type") || "application/octet-stream" };
}

export async function verifyMetaWebhookSignature(rawBody: string, signature: string | null) {
    const config = await getMetaConfig({ requireSecrets: false });
    if (!config.appSecret || !signature?.startsWith("sha256=")) return false;
    const expected = `sha256=${crypto.createHmac("sha256", config.appSecret).update(rawBody).digest("hex")}`;
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function getMetaWebhookVerifyToken() {
    return (await getMetaConfig({ requireSecrets: false })).webhookVerifyToken;
}

export async function disconnectMetaWhatsApp() {
    const existing = await prisma.systemSettings.findFirst();
    if (!existing) return;
    if (existing.whatsappAccessToken && existing.whatsappWabaId) {
        await graphRequest<{ success?: boolean }>({
            version: graphVersion(existing.whatsappGraphApiVersion),
            path: `${existing.whatsappWabaId}/subscribed_apps`,
            accessToken: existing.whatsappAccessToken,
            method: "DELETE",
        }).catch((error) => console.warn("[Meta WhatsApp] No se pudo cancelar la suscripcion remota:", error));
    }
    await prisma.systemSettings.update({
        where: { id: existing.id },
        data: {
            whatsappWabaId: null,
            whatsappPhoneNumberId: null,
            whatsappDisplayPhoneNumber: null,
            whatsappAccessToken: null,
            whatsappBusinessId: null,
            whatsappConnectedAt: null,
        },
    });
}
