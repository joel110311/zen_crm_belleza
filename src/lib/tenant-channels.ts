import "server-only";
import crypto from "node:crypto";
import { Prisma, type ChannelProvider } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";
import { hashSecurityIdentifier, safeSecretEqual } from "@/lib/security";
import { decryptChannelSecret, encryptChannelSecret } from "@/lib/tenant-channel-secrets";
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
        status: connection.status,
        connectedAt: connection.connectedAt?.toISOString() || null,
        disconnectedAt: connection.disconnectedAt?.toISOString() || null,
        lastWebhookAt: connection.lastWebhookAt?.toISOString() || null,
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
    const encrypted = encryptChannelSecret(accessToken);
    let reservation: { id: string };

    try {
        reservation = await getControlDb().$transaction(async (tx) => {
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
                    status: "PENDING",
                    secretCiphertext: encrypted.ciphertext,
                    secretKeyVersion: encrypted.keyVersion,
                    routeSecretHash: channelRouteHash(routeToken),
                },
                update: {
                    status: "PENDING", secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion,
                    routeSecretHash: channelRouteHash(routeToken), connectedAt: null, disconnectedAt: null, lastError: null,
                },
                select: { id: true },
            });
            const consumed = await tx.channelConnectionState.updateMany({
                where: { id: connectionState.id, consumedAt: null, expiresAt: { gt: new Date() } },
                data: { consumedAt: new Date() },
            });
            if (consumed.count !== 1) throw new TenantServiceError("CONFLICT", "Este estado de conexión ya fue usado o venció.");
            return result;
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new TenantServiceError("CONFLICT", "Este número de WhatsApp ya está conectado a otro negocio.");
        }
        throw error;
    }

    try {
        await graphRequest<{ success?: boolean }>(config, {
            resource: `${wabaId}/subscribed_apps`,
            accessToken,
            method: "POST",
            body: {
                override_callback_uri: callbackUrl,
                verify_token: routeToken,
            },
        });
        if (registrationPin) {
            await graphRequest<{ success?: boolean }>(config, {
                resource: `${phoneNumberId}/register`, accessToken, method: "POST",
                body: { messaging_product: "whatsapp", pin: registrationPin },
            });
        }
    } catch (error) {
        await getControlDb().channelConnection.update({
            where: { id: reservation.id },
            data: {
                status: "FAILED",
                lastError: error instanceof Error ? error.message.slice(0, 500) : "Meta webhook configuration failed.",
            },
        }).catch(() => {});
        throw error;
    }

    const connection = await getControlDb().channelConnection.update({
        where: { id: reservation.id },
        data: { status: "CONNECTED", connectedAt: new Date(), disconnectedAt: null, lastError: null },
        select: {
            id: true, provider: true, externalAccountId: true, status: true, connectedAt: true,
            disconnectedAt: true, lastWebhookAt: true, lastError: true, secretCiphertext: true,
        },
    });
    return {
        channel: serializeChannel(connection),
        displayPhoneNumber: phone.display_phone_number?.trim() || null,
        wabaId,
        businessId: businessId || null,
    };
}

type QrGatewayUser = { id?: string | number; name?: string; token?: string };
type QrGatewayStatus = { connected?: boolean; loggedIn?: boolean; jid?: string; qrcode?: string };

function qrGatewayBaseUrl() {
    const value = (process.env.MULTITENANT_WUZAPI_BASE_URL || process.env.WHATSAPP_GATEWAY_URL || "").trim().replace(/\/+$/, "");
    if (!value) throw new Error("Falta configurar el servicio interno para la conexión mediante QR.");
    return value;
}

function qrGatewayAdminToken() {
    const value = (process.env.WUZAPI_ADMIN_TOKEN || "").trim();
    if (!value) throw new Error("Falta configurar la credencial maestra del servicio de conexión mediante QR.");
    return value;
}

function qrWebhookHmacKey() {
    const value = (process.env.MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY || process.env.WUZAPI_GLOBAL_HMAC_KEY || "").trim();
    if (!value) throw new Error("Falta configurar la firma de seguridad para los mensajes recibidos mediante QR.");
    return value;
}

function qrInstanceName(tenantId: string) {
    return `tenant-${crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 24)}`;
}

function qrImage(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return null;
    if (normalized.startsWith("data:image/")) return normalized;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(normalized)) return `data:image/png;base64,${normalized.replace(/\s+/g, "")}`;
    return null;
}

function unwrapGatewayResponse<T>(payload: unknown): T {
    if (payload && typeof payload === "object" && "data" in payload) return (payload as { data: T }).data;
    return payload as T;
}

async function qrGatewayRequest<T>(params: { path: string; token?: string; admin?: boolean; method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown }) {
    const headers = new Headers();
    if (params.admin) headers.set("Authorization", qrGatewayAdminToken());
    else if (params.token) headers.set("Token", params.token);
    if (params.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(`${qrGatewayBaseUrl()}${params.path.startsWith("/") ? params.path : `/${params.path}`}`, {
        method: params.method || "GET",
        headers,
        body: params.body === undefined ? undefined : JSON.stringify(params.body),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
        try { payload = JSON.parse(raw) as unknown; }
        catch { payload = raw; }
    }
    if (!response.ok) {
        const details = typeof payload === "string" ? payload : (payload as { message?: string; error?: string }).message || (payload as { error?: string }).error;
        throw new Error(details || `El servicio de conexión mediante QR respondió ${response.status}.`);
    }
    return unwrapGatewayResponse<T>(payload);
}

async function tenantQrProxy(tenantId: string) {
    const setting = await getControlDb().tenantQrChannelConfiguration.findUnique({ where: { tenantId } });
    if (!setting?.proxyEnabled || !setting.proxyUrlCiphertext || !setting.proxyUrlKeyVersion) return { enabled: false, url: "" };
    return {
        enabled: true,
        url: decryptChannelSecret(setting.proxyUrlCiphertext, setting.proxyUrlKeyVersion),
    };
}

async function qrConnection(tenantId: string) {
    return getControlDb().channelConnection.findFirst({
        where: { tenantId, provider: "WUZAPI" },
        orderBy: { createdAt: "asc" },
    });
}

function connectionToken(connection: { secretCiphertext: Uint8Array | null; secretKeyVersion: number | null }) {
    if (!connection.secretCiphertext || !connection.secretKeyVersion) throw new Error("La conexión mediante QR no tiene una credencial válida.");
    return decryptChannelSecret(connection.secretCiphertext, connection.secretKeyVersion);
}

async function synchronizeQrStatus(connection: { id: string }, status: QrGatewayStatus) {
    const active = Boolean(status.loggedIn);
    await getControlDb().channelConnection.update({
        where: { id: connection.id },
        data: active
            ? { status: "CONNECTED", connectedAt: new Date(), disconnectedAt: null, lastError: null }
            : { status: "PENDING", connectedAt: null, lastError: null },
    });
    return active;
}

async function provisionQrGatewayUser(params: { tenantId: string; instanceName: string; userToken: string; callbackUrl: string }) {
    const proxy = await tenantQrProxy(params.tenantId);
    const usersPayload = await qrGatewayRequest<unknown>({ path: "/admin/users", admin: true });
    const users = Array.isArray(usersPayload)
        ? usersPayload.filter((value): value is QrGatewayUser => Boolean(value) && typeof value === "object")
        : usersPayload && typeof usersPayload === "object"
            ? Object.values(usersPayload).flatMap((value) => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []).filter((value): value is QrGatewayUser => Boolean(value) && typeof value === "object")
            : [];
    const existing = users.find((user) => user.name === params.instanceName || user.token === params.userToken);
    const payload = {
        name: params.instanceName,
        token: params.userToken,
        webhook: params.callbackUrl,
        events: "Message,HistorySync",
        proxyConfig: { enabled: proxy.enabled, proxyURL: proxy.enabled ? proxy.url : "" },
    };
    if (!existing) {
        await qrGatewayRequest({ path: "/admin/users", admin: true, method: "POST", body: payload });
    } else if (existing.id !== undefined) {
        await qrGatewayRequest({ path: `/admin/users/${existing.id}`, admin: true, method: "PUT", body: payload }).catch((error) => {
            if (proxy.enabled) throw error;
            // Older gateway versions may not support updating a user. The per-user calls below
            // still rotate the webhook and signature when no proxy change is required.
        });
    }
    await qrGatewayRequest({ path: "/webhook", token: params.userToken, method: "POST", body: { webhookURL: params.callbackUrl } });
    await qrGatewayRequest({ path: "/session/hmac/config", token: params.userToken, method: "POST", body: { hmac_key: qrWebhookHmacKey() } });
}

/** Provisions the internal user and starts a QR ceremony without exposing platform credentials. */
export async function beginTenantQrConnection(tenantId: string, actorUserId: string | null) {
    qrWebhookHmacKey();
    const existing = await qrConnection(tenantId);
    const instanceName = existing?.externalAccountId || qrInstanceName(tenantId);
    const userToken = existing?.secretCiphertext && existing.secretKeyVersion
        ? decryptChannelSecret(existing.secretCiphertext, existing.secretKeyVersion)
        : crypto.randomBytes(32).toString("base64url");
    const encrypted = encryptChannelSecret(userToken);
    const routeToken = makeRouteToken();
    const callbackUrl = `${callbackBaseUrl()}/api/webhooks/tenant/wuzapi/${routeToken}`;
    const connection = await getControlDb().channelConnection.upsert({
        where: { provider_externalAccountId: { provider: "WUZAPI", externalAccountId: instanceName } },
        create: {
            tenantId, provider: "WUZAPI", externalAccountId: instanceName, status: "PENDING",
            secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion,
            routeSecretHash: channelRouteHash(routeToken),
        },
        update: {
            status: "PENDING", secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion,
            routeSecretHash: channelRouteHash(routeToken), connectedAt: null, disconnectedAt: null, lastError: null,
        },
    });
    try {
        await provisionQrGatewayUser({ tenantId, instanceName, userToken, callbackUrl });
        await qrGatewayRequest({ path: "/session/connect", token: userToken, method: "POST", body: { Subscribe: ["Message", "HistorySync"], Immediate: false } });
        const status = await qrGatewayRequest<QrGatewayStatus>({ path: "/session/status", token: userToken });
        const qrPayload = status.loggedIn ? null : await qrGatewayRequest<{ QRCode?: string }>({ path: "/session/qr", token: userToken }).catch(() => null);
        const active = await synchronizeQrStatus(connection, status);
        await getControlDb().auditLog.create({
            data: {
                tenantId,
                actorUserId,
                action: "qr_connection.risk_accepted",
                resourceType: "ChannelConnection",
                resourceId: connection.id,
                metadata: { disclosureVersion: 1 },
            },
        });
        return { configured: true, active, connected: Boolean(status.connected), phone: status.jid || null, qrCode: qrImage(qrPayload?.QRCode || status.qrcode) };
    } catch (error) {
        await getControlDb().channelConnection.update({
            where: { id: connection.id },
            data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 500) : "No fue posible preparar la conexión mediante QR." },
        }).catch(() => {});
        throw error;
    }
}

export async function getTenantQrConnection(tenantId: string, includeQr = false) {
    const connection = await qrConnection(tenantId);
    if (!connection?.secretCiphertext || !connection.secretKeyVersion) return { configured: false, active: false, connected: false, phone: null, qrCode: null };
    const token = connectionToken(connection);
    const status = await qrGatewayRequest<QrGatewayStatus>({ path: "/session/status", token });
    const qrPayload = includeQr && !status.loggedIn
        ? await qrGatewayRequest<{ QRCode?: string }>({ path: "/session/qr", token }).catch(() => null)
        : null;
    const active = await synchronizeQrStatus(connection, status);
    return { configured: true, active, connected: Boolean(status.connected), phone: status.jid || null, qrCode: qrImage(qrPayload?.QRCode || status.qrcode) };
}

export async function disconnectTenantQrConnection(tenantId: string) {
    const connection = await qrConnection(tenantId);
    if (!connection) return { disconnected: true };
    if (connection.secretCiphertext && connection.secretKeyVersion) {
        const token = connectionToken(connection);
        await qrGatewayRequest({ path: "/session/logout", token, method: "POST", body: {} }).catch(async () => {
            await qrGatewayRequest({ path: "/session/disconnect", token, method: "POST", body: {} });
        });
    }
    await getControlDb().channelConnection.update({
        where: { id: connection.id },
        data: { status: "DISCONNECTED", connectedAt: null, disconnectedAt: new Date(), lastError: null },
    });
    return { disconnected: true };
}

export async function getChannelForRoute(provider: ChannelProvider, routeToken: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(routeToken)) return null;
    return getControlDb().channelConnection.findFirst({
        where: { provider, routeSecretHash: channelRouteHash(routeToken), status: "CONNECTED" },
        select: { id: true, tenantId: true, provider: true, externalAccountId: true, status: true },
    });
}

export async function getChannelForRouteVerification(provider: ChannelProvider, routeToken: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(routeToken)) return null;
    return getControlDb().channelConnection.findFirst({
        where: {
            provider,
            routeSecretHash: channelRouteHash(routeToken),
            status: { in: ["PENDING", "CONNECTED"] },
        },
        select: { id: true },
    });
}

export async function touchChannelWebhook(connectionId: string) {
    await getControlDb().channelConnection.update({ where: { id: connectionId }, data: { lastWebhookAt: new Date(), lastError: null } }).catch(() => {});
}
