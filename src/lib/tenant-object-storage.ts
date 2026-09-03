import "server-only";
import crypto from "node:crypto";

type StorageConfig = {
    endpoint: URL;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string | null;
    forcePathStyle: boolean;
};

type SignedObjectRequest = {
    url: string;
    headers: Record<string, string>;
    expiresAt: Date;
};

const awsAlgorithm = "AWS4-HMAC-SHA256";

function awsEncode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(value: string | Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
    return crypto.createHmac("sha256", key).update(value).digest();
}

function dateStamp(value: Date) {
    return value.toISOString().slice(0, 10).replace(/-/g, "");
}

function amzDate(value: Date) {
    return value.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(config: StorageConfig, stamp: string) {
    const dateKey = hmac(`AWS4${config.secretAccessKey}`, stamp);
    const regionKey = hmac(dateKey, config.region);
    const serviceKey = hmac(regionKey, "s3");
    return hmac(serviceKey, "aws4_request");
}

function cleanBucket(value: string) {
    const bucket = value.trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
        throw new Error("TENANT_STORAGE_S3_BUCKET no es un bucket válido.");
    }
    return bucket;
}

export function getTenantStorageConfig(): StorageConfig {
    const rawEndpoint = process.env.TENANT_STORAGE_S3_ENDPOINT?.trim() || "";
    const bucket = cleanBucket(process.env.TENANT_STORAGE_S3_BUCKET || "");
    const accessKeyId = process.env.TENANT_STORAGE_S3_ACCESS_KEY_ID?.trim() || "";
    const secretAccessKey = process.env.TENANT_STORAGE_S3_SECRET_ACCESS_KEY?.trim() || "";
    if (!rawEndpoint || !accessKeyId || !secretAccessKey) {
        throw new Error("Falta configurar el almacenamiento privado S3 del tenant.");
    }

    let endpoint: URL;
    try {
        endpoint = new URL(rawEndpoint);
    } catch {
        throw new Error("TENANT_STORAGE_S3_ENDPOINT debe ser una URL HTTPS válida.");
    }
    const isLocal = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
    if (endpoint.protocol !== "https:" && !isLocal) {
        throw new Error("El endpoint S3 debe usar HTTPS fuera de desarrollo local.");
    }

    return {
        endpoint,
        bucket,
        region: process.env.TENANT_STORAGE_S3_REGION?.trim() || "us-east-1",
        accessKeyId,
        secretAccessKey,
        sessionToken: process.env.TENANT_STORAGE_S3_SESSION_TOKEN?.trim() || null,
        forcePathStyle: process.env.TENANT_STORAGE_S3_FORCE_PATH_STYLE !== "false",
    };
}

function objectUrl(config: StorageConfig, key: string) {
    const url = new URL(config.endpoint.toString());
    const basePath = url.pathname.replace(/\/+$/, "");
    const encodedKey = key.split("/").map(awsEncode).join("/");

    if (config.forcePathStyle) {
        url.pathname = `${basePath}/${awsEncode(config.bucket)}/${encodedKey}`.replace(/\/\/{2,}/g, "/");
    } else {
        url.hostname = `${config.bucket}.${url.hostname}`;
        url.pathname = `${basePath}/${encodedKey}`.replace(/\/\/{2,}/g, "/");
    }
    return url;
}

function canonicalQuery(values: Record<string, string>) {
    return Object.entries(values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
        .join("&");
}

function canonicalHeaders(headers: Record<string, string>) {
    const normalized = Object.entries(headers)
        .map(([key, value]) => [key.toLowerCase().trim(), value.trim().replace(/\s+/g, " ")] as const)
        .sort(([left], [right]) => left.localeCompare(right));
    return {
        value: normalized.map(([key, value]) => `${key}:${value}\n`).join(""),
        signedHeaders: normalized.map(([key]) => key).join(";"),
    };
}

function credentialScope(config: StorageConfig, now: Date) {
    return `${dateStamp(now)}/${config.region}/s3/aws4_request`;
}

function signPresignedRequest(params: {
    method: "GET" | "PUT";
    key: string;
    expiresInSeconds: number;
    headers?: Record<string, string>;
}) : SignedObjectRequest {
    const config = getTenantStorageConfig();
    const now = new Date();
    const url = objectUrl(config, params.key);
    const headers = canonicalHeaders({ host: url.host, ...(params.headers || {}) });
    const query: Record<string, string> = {
        "X-Amz-Algorithm": awsAlgorithm,
        "X-Amz-Credential": `${config.accessKeyId}/${credentialScope(config, now)}`,
        "X-Amz-Date": amzDate(now),
        "X-Amz-Expires": String(params.expiresInSeconds),
        "X-Amz-SignedHeaders": headers.signedHeaders,
    };
    if (config.sessionToken) query["X-Amz-Security-Token"] = config.sessionToken;

    const canonicalRequest = [
        params.method,
        url.pathname,
        canonicalQuery(query),
        headers.value,
        headers.signedHeaders,
        "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
        awsAlgorithm,
        amzDate(now),
        credentialScope(config, now),
        sha256(canonicalRequest),
    ].join("\n");
    query["X-Amz-Signature"] = hmac(signingKey(config, dateStamp(now)), stringToSign).toString("hex");
    url.search = canonicalQuery(query);

    return {
        url: url.toString(),
        headers: params.headers || {},
        expiresAt: new Date(now.getTime() + params.expiresInSeconds * 1000),
    };
}

function signServerRequest(method: "HEAD" | "DELETE", key: string) {
    const config = getTenantStorageConfig();
    const now = new Date();
    const url = objectUrl(config, key);
    const headers = canonicalHeaders({ host: url.host, "x-amz-content-sha256": sha256(""), "x-amz-date": amzDate(now) });
    const scope = credentialScope(config, now);
    const canonicalRequest = [method, url.pathname, "", headers.value, headers.signedHeaders, sha256("")].join("\n");
    const stringToSign = [awsAlgorithm, amzDate(now), scope, sha256(canonicalRequest)].join("\n");
    const authorization = `${awsAlgorithm} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${headers.signedHeaders}, Signature=${hmac(signingKey(config, dateStamp(now)), stringToSign).toString("hex")}`;
    return {
        url: url.toString(),
        headers: {
            "x-amz-content-sha256": sha256(""),
            "x-amz-date": amzDate(now),
            Authorization: authorization,
            ...(config.sessionToken ? { "x-amz-security-token": config.sessionToken } : {}),
        },
    };
}

export function presignTenantObjectUpload(params: { key: string; mimeType: string; sha256: string }) {
    return signPresignedRequest({
        method: "PUT",
        key: params.key,
        expiresInSeconds: 10 * 60,
        headers: {
            "content-type": params.mimeType,
            "x-amz-meta-sha256": params.sha256,
        },
    });
}

export function presignTenantObjectDownload(key: string) {
    return signPresignedRequest({ method: "GET", key, expiresInSeconds: 60 });
}

export async function inspectTenantObject(key: string) {
    const request = signServerRequest("HEAD", key);
    const response = await fetch(request.url, { method: "HEAD", headers: request.headers, cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`El almacenamiento privado respondió ${response.status} al confirmar el archivo.`);
    const size = Number.parseInt(response.headers.get("content-length") || "", 10);
    return {
        sizeBytes: Number.isSafeInteger(size) && size >= 0 ? size : null,
        mimeType: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
        sha256: response.headers.get("x-amz-meta-sha256")?.trim().toLowerCase() || null,
    };
}

export async function deleteTenantObject(key: string) {
    const request = signServerRequest("DELETE", key);
    const response = await fetch(request.url, { method: "DELETE", headers: request.headers, cache: "no-store" });
    if (!response.ok && response.status !== 404) {
        throw new Error(`El almacenamiento privado respondió ${response.status} al eliminar el archivo.`);
    }
}
