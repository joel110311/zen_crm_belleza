import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTED_PREFIX = "enc:v1";

function getEncryptionKey() {
    const configured = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
    if (!configured) {
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY no esta configurada.");
    }

    const key = /^[0-9a-f]{64}$/i.test(configured)
        ? Buffer.from(configured, "hex")
        : Buffer.from(configured, "base64");

    if (key.length !== 32) {
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY debe contener exactamente 32 bytes en base64 o 64 caracteres hexadecimales.");
    }

    return key;
}

export function isEncryptedGoogleToken(value?: string | null) {
    return Boolean(value?.startsWith(`${ENCRYPTED_PREFIX}:`));
}

export function encryptGoogleToken(value?: string | null) {
    if (!value) return null;
    if (isEncryptedGoogleToken(value)) return value;

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
        ENCRYPTED_PREFIX,
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url"),
    ].join(":");
}

export function decryptGoogleToken(value?: string | null) {
    if (!value) return null;
    if (!isEncryptedGoogleToken(value)) return value;

    const parts = value.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
        throw new Error("El token cifrado de Google tiene un formato invalido.");
    }

    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const encrypted = Buffer.from(parts[4], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
