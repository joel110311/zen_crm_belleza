import "server-only";
import crypto from "node:crypto";

const cipherIvLength = 12;
const cipherTagLength = 16;

function getTenantCredentialKey(keyVersion: number): Buffer {
    const configuredVersion = Number.parseInt(process.env.TENANT_CREDENTIALS_KEY_VERSION || "1", 10);
    if (configuredVersion !== keyVersion) {
        throw new Error(`No decryption key is configured for tenant credential key version ${keyVersion}.`);
    }

    const encodedKey = process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY?.trim();
    if (!encodedKey) {
        throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY is required to open a tenant database.");
    }

    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32) {
        throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    }

    return key;
}

/**
 * Decrypts the AES-256-GCM envelope emitted by the provisioner. The plaintext stays only in
 * this server-only module and is never returned by a tenant context or API response.
 */
export function decryptTenantRuntimeUrl(ciphertext: Uint8Array, keyVersion: number): string {
    const payload = Buffer.from(ciphertext);
    if (payload.length <= cipherIvLength + cipherTagLength) {
        throw new Error("Tenant runtime credential ciphertext is invalid.");
    }

    const iv = payload.subarray(0, cipherIvLength);
    const tag = payload.subarray(cipherIvLength, cipherIvLength + cipherTagLength);
    const encryptedValue = payload.subarray(cipherIvLength + cipherTagLength);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getTenantCredentialKey(keyVersion), iv);
    decipher.setAuthTag(tag);

    const runtimeUrl = Buffer.concat([decipher.update(encryptedValue), decipher.final()]).toString("utf8");
    const parsedUrl = new URL(runtimeUrl);
    if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
        throw new Error("Tenant runtime credential is not a PostgreSQL URL.");
    }

    return runtimeUrl;
}
