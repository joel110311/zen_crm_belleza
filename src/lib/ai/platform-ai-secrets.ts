import "server-only";
import crypto from "node:crypto";

function key(version: number) {
    if (version !== Number(process.env.TENANT_CREDENTIALS_KEY_VERSION || 1)) throw new Error("Versión de cifrado no disponible.");
    const master = Buffer.from(process.env.TENANT_CREDENTIALS_ENCRYPTION_KEY?.trim() || "", "base64");
    if (master.length !== 32) throw new Error("Configura la llave de cifrado de la plataforma antes de guardar claves de IA.");
    return crypto.createHmac("sha256", master).update("zen-crm:platform-ai-providers:v1").digest();
}
export function platformAiEncryptionReady() {
    try { key(Number(process.env.TENANT_CREDENTIALS_KEY_VERSION || 1)); return true; } catch { return false; }
}
export function encryptPlatformAiKey(value: string) {
    const keyVersion = Number(process.env.TENANT_CREDENTIALS_KEY_VERSION || 1);
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(keyVersion), iv);
    const encrypted = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
    return { apiKeyCiphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"), keyVersion };
}
export function decryptPlatformAiKey(ciphertext: string, version: number) {
    const bytes = Buffer.from(ciphertext, "base64");
    if (bytes.length <= 28) throw new Error("Clave cifrada no válida.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(version), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
