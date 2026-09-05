import "server-only";

import crypto from "node:crypto";

export function normalizeTrialEmail(value: string): string {
    return value.trim().normalize("NFKC").toLowerCase();
}

export function trialIdentityKeyVersion(): number {
    const parsed = Number.parseInt(process.env.TRIAL_IDENTITY_KEY_VERSION || "1", 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function trialIdentityPepper(): string {
    const value = process.env.TRIAL_IDENTITY_PEPPER?.trim()
        || process.env.SECURITY_HASH_SALT?.trim()
        || process.env.AUTH_SECRET?.trim()
        || process.env.NEXTAUTH_SECRET?.trim();
    if (!value) throw new Error("TRIAL_IDENTITY_PEPPER no está configurado.");
    return value;
}

/** Equality-only identifier. The control database never stores the source email in this table. */
export function trialEmailHmac(email: string): string {
    const normalized = normalizeTrialEmail(email);
    return crypto.createHmac("sha256", trialIdentityPepper())
        .update(`trial-email:v${trialIdentityKeyVersion()}:${normalized}`)
        .digest("hex");
}
