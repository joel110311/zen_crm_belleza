import "server-only";
import crypto from "node:crypto";

const ivLength = 12;
const tagLength = 16;
const purpose = "zen-crm:tenant-channel-connection:v1";

function configuredKeyVersion() {
    const value = Number.parseInt(process.env.TENANT_CREDENTIALS_KEY_VERSION || "1", 10);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("TENANT_CREDENTIALS_KEY_VERSION no es válido.");
    }
    return value;
}

function channelKey(keyVersion: number) {
    if (configuredKeyVersion() !== keyVersion) {
        throw new Error(`No hay una llave configurada para secretos de canal versión ${keyVersion}.`);
    }

    const encoded = (process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY
        || process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY
        || "").trim();
    const master = Buffer.from(encoded, "base64");
    if (master.length !== 32) {
        throw new Error("TENANT_CREDENTIALS_ENCRYPTION_KEY debe contener 32 bytes codificados en base64.");
    }

    // A channel token is never encrypted directly with the tenant DB credential key. This gives
    // both key material a separate cryptographic domain while preserving one rotation process.
    return crypto.createHmac("sha256", master).update(purpose).digest();
}

export function encryptChannelSecret(value: string) {
    const normalized = value.trim();
    if (!normalized) throw new Error("El secreto del canal está vacío.");

    const keyVersion = configuredKeyVersion();
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv("aes-256-gcm", channelKey(keyVersion), iv);
    const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
    return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
        keyVersion,
    };
}

export function decryptChannelSecret(ciphertext: Uint8Array, keyVersion: number) {
    const payload = Buffer.from(ciphertext);
    if (payload.length <= ivLength + tagLength) throw new Error("El secreto cifrado del canal no es válido.");

    const decipher = crypto.createDecipheriv("aes-256-gcm", channelKey(keyVersion), payload.subarray(0, ivLength));
    decipher.setAuthTag(payload.subarray(ivLength, ivLength + tagLength));
    return Buffer.concat([
        decipher.update(payload.subarray(ivLength + tagLength)),
        decipher.final(),
    ]).toString("utf8");
}
