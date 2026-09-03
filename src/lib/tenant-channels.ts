import "server-only";
import crypto from "node:crypto";
import { Prisma, type ChannelProvider } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { hashSecurityIdentifier, safeSecretEqual } from "@/lib/security";
import { encryptChannelSecret } from "@/lib/tenant-channel-secrets";
import { TenantServiceError } from "@/lib/tenant-services/context";

type ChannelStatePayload = {
    v: 1;
    jti: string;
    tenantId: string;
    userId: string;
    provider: ChannelProvider;
    exp: number;
};

type MetaPlatformConfig = {
    appId: string;
    appSecret: string;
    embeddedSignupConfigId: string;
    graphApiVersion: string;
};

function channelStateSecret() {
    const value = (process.env.CHANNEL_STATE_SIGNING_SECRET
        || process.env.SECURITY_HASH_SALT
        || process.env.AUTH_SECRET
        || process.env.NEXTAUTH_SECRET
        || "").trim();
    if (value.length < 32) throw new Error("Falta CHANNEL_STATE_SIGNING_SECRET o un secreto de aplicación seguro.");
    return value;
}

function encodeState(payload: ChannelStatePayload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto.createHmac("sha256", channelStateSecret()).update(body).digest("base64url");
    return `${body}.${signature}`;
}

function decodeState(value: string): ChannelStatePayload {
    const [body, signature, extra] = value.split(".");
    if (!body || !signature || extra || !safeSecretEqual(signature, crypto.createHmac("sha256", channelStateSecret()).update(body).digest("base64url"))) {
        throw new TenantServiceError("FORBIDDEN", "El estado de conexión no es válido.");
    }
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ChannelStatePayload>;
        if (payload.v !== 1 || typeof payload.jti !== "string" || typeof payload.tenantId !== "string" || typeof payload.userId !== "string" || (payload.provider !== "META_CLOUD" && payload.provider !== "WUZAPI") || !Number.isSafeInteger(payload.exp)) {
            throw new Error("invalid");
        }
        return payload as ChannelStatePayload;
    } catch {
        throw new TenantServiceError("FORBIDDEN", "El estado de conexión no es válido.");
    }
}

function stateHash(value: string) {
    return hashSecurityIdentifier(`tenant-channel-state:${value}`);
}

export function channelRouteHash(value: string) {
    return hashSecurityIdentifier(`tenant-channel-route:${value}`);
}

function text(value: unknown, field: string, maxLength: number) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || normalized.length > maxLength) throw new TenantServiceError("VALIDATION_ERROR", `El campo ${field} no es válido.`);
    return normalized;
}

function safeExternalAccountId(value: unknown, field: string) {
    const normalized = text(value, field, 160);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,159}$/.test(normalized)) {
        throw new TenantServiceError("VALIDATION_ERROR", `El campo ${field} no es válido.`);
    }
    return normalized;
}

function callbackBaseUrl() {
    const value = (process.env.APP_BASE_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").trim();
    if (!value) throw new Error("Define APP_BASE_URL para construir la URL de los webhooks multitenant.");
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("APP_BASE_URL no es una URL válida.");
    }
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !isLocal) throw new Error("APP_BASE_URL debe usar HTTPS para conectar un canal.");
    return url.toString().replace(/\/$/, "");
}

function makeRouteToken() {
    return crypto.randomBytes(32).toString("base64url");
}

function metaConfig(): MetaPlatformConfig {
    const appId = process.env.META_APP_ID?.trim() || "";
    const appSecret = process.env.META_APP_SECRET?.trim() || "";
    const embeddedSignupConfigId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || "";
    const graphApiVersion = (process.env.META_GRAPH_API_VERSION?.trim() || "v26.0").replace(/^([^v])/, "v$1");
    if (!appId || !appSecret || !embeddedSignupConfigId) {
        throw new Error("Falta META_APP_ID, META_APP_SECRET o META_EMBEDDED_SIGNUP_CONFIG_ID.");
    }
    return { appId, appSecret, embeddedSignupConfigId, graphApiVersion };
}

function graphUrl(config: MetaPlatformConfig, resource: string) {
    return `https://graph.facebook.com/${config.graphApiVersion}/${resource.replace(/^\//, "")}`;
}

async function graphRequest<T>(config: MetaPlatformConfig, input: { resource: string; accessToken: string; method?: "GET" | "POST"; body?: Record<string, unknown> }) {
    const response = await fetch(graphUrl(config, input.resource), {
        method: input.method || "GET",
        headers: {
            Authorization: `Bearer ${input.accessToken}`,
            ...(input.body ? { "Content-Type": "application/json" } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string; code?: number } } & T;
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.error_user_msg || payload.error?.message || `Meta Graph API respondió ${response.status}.`);
    }
    return payload;
}

async function exchangeMetaCode(config: MetaPlatformConfig, code: string) {
    const parameters = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, code });
    const response = await fetch(`${graphUrl(config, "oauth/access_token")}?${parameters}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; error?: { message?: string } };
    if (!response.ok || !payload.access_token) throw new Error(payload.error?.message || "Meta no devolvió un token de acceso.");
    return payload.access_token;
}

function serializeChannel(connection: {
    id: string;
    provider: ChannelProvider;
    externalAccountId: string;
    status: string;
    connectedAt: Date | null;
    disconnectedAt: Date | null;
    lastWebhookAt: Date | null;
    lastError: string | null;
    secretCiphertext: Uint8Array | null;
}) {
    return {
        id: connection.id,
        provider: connection.provider,
        externalAccountId: connection.externalAccountId,
        status: connection.status,
        credentialConfigured: Boolean(connection.secretCiphertext),
        connectedAt: connection.connectedAt?.toISOString() || null,
        disconnectedAt: connection.disconnectedAt?.toISOString() || null,
        lastWebhookAt: connection.lastWebhookAt?.toISOString() || null,
        lastError: connection.lastError || null,
    };
}

export async function listTenantChannels(tenantId: string) {
    const channels = await getControlDb().channelConnection.findMany({
        where: { tenantId },
        orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
        select: {
            id: true, provider: true, externalAccountId: true, status: true, connectedAt: true,
            disconnectedAt: true, lastWebhookAt: true, lastError: true, secretCiphertext: true,
        },
    });
    return channels.map(serializeChannel);
}

/** Begins a single-use Embedded Signup ceremony; the browser receives no token or callback secret. */
export async function beginMetaEmbeddedSignup(params: { tenantId: string; userId: string }) {
    const config = metaConfig();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const payload: ChannelStatePayload = {
        v: 1,
        jti: crypto.randomUUID(),
        tenantId: params.tenantId,
        userId: params.userId,
        provider: "META_CLOUD",
        exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const state = encodeState(payload);
    await getControlDb().channelConnectionState.create({
        data: {
            tenantId: params.tenantId,
            requestedByUserId: params.userId,
            provider: "META_CLOUD",
            stateHash: stateHash(state),
            expiresAt,
        },
    });
    return {
        state,
        expiresAt: expiresAt.toISOString(),
        appId: config.appId,
        configId: config.embeddedSignupConfigId,
        graphApiVersion: config.graphApiVersion,
    };
}

async function verifyUnconsumedState(params: { state: string; tenantId: string; userId: string; provider: ChannelProvider }) {
    const state = decodeState(params.state);
    if (state.tenantId !== params.tenantId || state.userId !== params.userId || state.provider !== params.provider || state.exp * 1000 <= Date.now()) {
        throw new TenantServiceError("FORBIDDEN", "El estado de conexión venció o no pertenece a este negocio.");
    }
    const record = await getControlDb().channelConnectionState.findUnique({ where: { stateHash: stateHash(params.state) } });
    if (!record || record.consumedAt || record.expiresAt <= new Date() || record.tenantId !== params.tenantId || record.requestedByUserId !== params.userId || record.provider !== params.provider) {
        throw new TenantServiceError("CONFLICT", "Este estado de conexión ya fue usado o venció.");
    }
    return record;
}

export async function completeMetaEmbeddedSignup(params: {
    tenantId: string;
    userId: string;
    state: string;
    code: unknown;
    wabaId: unknown;
    phoneNumberId: unknown;
    businessId?: unknown;
    registrationPin?: unknown;
}) {
    const connectionState = await verifyUnconsumedState({ state: params.state, tenantId: params.tenantId, userId: params.userId, provider: "META_CLOUD" });
    const code = text(params.code, "code", 4096);
    const wabaId = safeExternalAccountId(params.wabaId, "wabaId");
    const phoneNumberId = safeExternalAccountId(params.phoneNumberId, "phoneNumberId");
    const businessId = typeof params.businessId === "string" ? params.businessId.trim().slice(0, 160) : "";
    const registrationPin = (typeof params.registrationPin === "string" ? params.registrationPin.trim() : process.env.META_WHATSAPP_REGISTRATION_PIN?.trim() || "");
    if (registrationPin && !/^\d{6}$/.test(registrationPin)) throw new TenantServiceError("VALIDATION_ERROR", "El PIN de registro de WhatsApp debe contener seis dígitos.");

    const config = metaConfig();
    const routeToken = makeRouteToken();
    const callbackUrl = `${callbackBaseUrl()}/api/webhooks/tenant/meta/${routeToken}`;
    const accessToken = await exchangeMetaCode(config, code);
    const phone = await graphRequest<{ display_phone_number?: string }>(config, {
        resource: `${phoneNumberId}?fields=id,display_phone_number`,
        accessToken,
    });
    await graphRequest<{ success?: boolean }>(config, {
        resource: `${wabaId}/subscribed_apps`,
        accessToken,
        method: "POST",
        body: {
            override_callback_uri: callbackUrl,
            verify_token: routeToken,
            fields: ["messages", "account_update", "message_template_status_update"],
        },
    });
    if (registrationPin) {
        await graphRequest<{ success?: boolean }>(config, {
            resource: `${phoneNumberId}/register`, accessToken, method: "POST",
            body: { messaging_product: "whatsapp", pin: registrationPin },
        });
    }
    const encrypted = encryptChannelSecret(accessToken);

    try {
        const connection = await getControlDb().$transaction(async (tx) => {
            const existing = await tx.channelConnection.findUnique({ where: { provider_externalAccountId: { provider: "META_CLOUD", externalAccountId: phoneNumberId } } });
            if (existing && existing.tenantId !== params.tenantId) {
                throw new TenantServiceError("CONFLICT", "Este número de WhatsApp ya está conectado a otro negocio.");
            }
            const result = await tx.channelConnection.upsert({
                where: { provider_externalAccountId: { provider: "META_CLOUD", externalAccountId: phoneNumberId } },
                create: {
                    tenantId: params.tenantId,
                    provider: "META_CLOUD",
                    externalAccountId: phoneNumberId,
                    status: "CONNECTED",
                    secretCiphertext: encrypted.ciphertext,
                    secretKeyVersion: encrypted.keyVersion,
                    routeSecretHash: channelRouteHash(routeToken),
                    connectedAt: new Date(),
                },
                update: {
                    status: "CONNECTED", secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion,
                    routeSecretHash: channelRouteHash(routeToken), connectedAt: new Date(), disconnectedAt: null, lastError: null,
                },
                select: {
                    id: true, provider: true, externalAccountId: true, status: true, connectedAt: true,
                    disconnectedAt: true, lastWebhookAt: true, lastError: true, secretCiphertext: true,
                },
            });
            const consumed = await tx.channelConnectionState.updateMany({
                where: { id: connectionState.id, consumedAt: null, expiresAt: { gt: new Date() } },
                data: { consumedAt: new Date() },
            });
            if (consumed.count !== 1) throw new TenantServiceError("CONFLICT", "Este estado de conexión ya fue usado o venció.");
            return result;
        });
        return {
            channel: serializeChannel(connection),
            displayPhoneNumber: phone.display_phone_number?.trim() || null,
            wabaId,
            businessId: businessId || null,
        };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new TenantServiceError("CONFLICT", "Este número de WhatsApp ya está conectado a otro negocio.");
        }
        throw error;
    }
}

async function configureWuzapiWebhook(userToken: string, callbackUrl: string) {
    const baseUrl = process.env.MULTITENANT_WUZAPI_BASE_URL?.trim().replace(/\/+$/, "") || "";
    if (!baseUrl) return false;
    const response = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Token: userToken },
        body: JSON.stringify({ webhookURL: callbackUrl }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`WuzAPI respondió ${response.status} al registrar el webhook.`);
    const hmacKey = process.env.MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY?.trim() || "";
    if (hmacKey) {
        const hmacResponse = await fetch(`${baseUrl}/session/hmac/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Token: userToken },
            body: JSON.stringify({ hmac_key: hmacKey }),
            cache: "no-store",
        });
        if (!hmacResponse.ok) throw new Error(`WuzAPI respondió ${hmacResponse.status} al configurar la firma del webhook.`);
    }
    return true;
}

export async function connectWuzapiChannel(params: { tenantId: string; externalAccountId: unknown; userToken: unknown }) {
    const externalAccountId = safeExternalAccountId(params.externalAccountId, "externalAccountId");
    const userToken = text(params.userToken, "userToken", 4096);
    if (!(process.env.MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY || "").trim()) {
        throw new Error("MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY es obligatorio para conectar WuzAPI por tenant.");
    }
    const routeToken = makeRouteToken();
    const callbackUrl = `${callbackBaseUrl()}/api/webhooks/tenant/wuzapi/${routeToken}`;
    let reservation: { id: string };
    try {
        reservation = await getControlDb().$transaction(async (tx) => {
            const existing = await tx.channelConnection.findUnique({
                where: { provider_externalAccountId: { provider: "WUZAPI", externalAccountId } },
                select: { tenantId: true },
            });
            if (existing && existing.tenantId !== params.tenantId) {
                throw new TenantServiceError("CONFLICT", "Esta instancia WuzAPI ya está conectada a otro negocio.");
            }
            return tx.channelConnection.upsert({
                where: { provider_externalAccountId: { provider: "WUZAPI", externalAccountId } },
                create: {
                    tenantId: params.tenantId, provider: "WUZAPI", externalAccountId, status: "PENDING",
                    routeSecretHash: channelRouteHash(routeToken),
                },
                update: { status: "PENDING", routeSecretHash: channelRouteHash(routeToken), lastError: null },
                select: { id: true },
            });
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new TenantServiceError("CONFLICT", "Esta instancia WuzAPI ya está conectada a otro negocio.");
        }
        throw error;
    }

    let configuredRemotely: boolean;
    try {
        configuredRemotely = await configureWuzapiWebhook(userToken, callbackUrl);
    } catch (error) {
        await getControlDb().channelConnection.update({
            where: { id: reservation.id },
            data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 500) : "WuzAPI webhook configuration failed." },
        }).catch(() => {});
        throw error;
    }

    const encrypted = encryptChannelSecret(userToken);
    const connection = await getControlDb().channelConnection.update({
        where: { id: reservation.id },
        data: {
            status: "CONNECTED", secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion,
            connectedAt: new Date(), disconnectedAt: null, lastError: null,
        },
        select: {
            id: true, provider: true, externalAccountId: true, status: true, connectedAt: true,
            disconnectedAt: true, lastWebhookAt: true, lastError: true, secretCiphertext: true,
        },
    });
    return { channel: serializeChannel(connection), callbackUrl, configuredRemotely };
}

export async function getChannelForRoute(provider: ChannelProvider, routeToken: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(routeToken)) return null;
    return getControlDb().channelConnection.findFirst({
        where: { provider, routeSecretHash: channelRouteHash(routeToken), status: "CONNECTED" },
        select: { id: true, tenantId: true, provider: true, externalAccountId: true, status: true },
    });
}

export async function touchChannelWebhook(connectionId: string) {
    await getControlDb().channelConnection.update({ where: { id: connectionId }, data: { lastWebhookAt: new Date(), lastError: null } }).catch(() => {});
}
