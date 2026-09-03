import crypto from "crypto";
import { Prisma } from "@/generated/control-plane";
import { getControlDb } from "@/lib/control-db";

type RateLimitEntry = {
    count: number;
    resetAt: number;
};

type RateLimitOptions = {
    limit: number;
    windowMs: number;
};

const globalRateLimit = globalThis as typeof globalThis & {
    __zenCrmRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalRateLimit.__zenCrmRateLimits || new Map<string, RateLimitEntry>();
globalRateLimit.__zenCrmRateLimits = rateLimits;

function pruneRateLimits(now: number) {
    if (rateLimits.size < 5_000) return;

    for (const [key, entry] of rateLimits) {
        if (entry.resetAt <= now) rateLimits.delete(key);
    }
}

export function consumeRateLimit(key: string, options: RateLimitOptions) {
    const now = Date.now();
    pruneRateLimits(now);

    const current = rateLimits.get(key);
    if (!current || current.resetAt <= now) {
        const resetAt = now + options.windowMs;
        rateLimits.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: Math.max(0, options.limit - 1), resetAt };
    }

    current.count += 1;
    rateLimits.set(key, current);

    return {
        allowed: current.count <= options.limit,
        remaining: Math.max(0, options.limit - current.count),
        resetAt: current.resetAt,
    };
}

export function resetRateLimit(key: string) {
    rateLimits.delete(key);
}

export function getRequestIp(headers: Headers) {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}

/** Accept browser mutations only from the configured public app origin or request origin. */
export function isSameApplicationOrigin(request: Request) {
    const origin = request.headers.get("origin");
    if (!origin) return true;

    const allowedOrigins = new Set<string>();
    try {
        allowedOrigins.add(new URL(request.url).origin);
    } catch {}

    for (const candidate of [process.env.APP_BASE_URL, process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
        if (!candidate?.trim()) continue;
        try {
            allowedOrigins.add(new URL(candidate).origin);
        } catch {}
    }

    return allowedOrigins.has(origin);
}

function securityHashSalt() {
    return process.env.SECURITY_HASH_SALT
        || process.env.AUTH_SECRET
        || process.env.NEXTAUTH_SECRET
        || "zen-crm-local-development-salt";
}

/** Never persist raw IPs, emails or browser fingerprints in security-control tables. */
export function hashSecurityIdentifier(value: string) {
    return crypto.createHmac("sha256", securityHashSalt()).update(value.trim()).digest("hex");
}

type SharedRateLimitOptions = RateLimitOptions & {
    scope: string;
    identifiers: string[];
};

/**
 * Atomically increments a control-plane rate-limit counter. Unlike the legacy
 * in-memory limiter, this works when requests land on different processes.
 */
export async function consumeSharedRateLimit(options: SharedRateLimitOptions) {
    const now = new Date();
    const nextWindow = new Date(now.getTime() + options.windowMs);
    const normalizedIdentifiers = options.identifiers
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join("\u001f");
    const keyHash = hashSecurityIdentifier(`${options.scope}\u001f${normalizedIdentifiers}`);
    const rows = await getControlDb().$queryRaw<Array<{ count: number; windowEndsAt: Date }>>(Prisma.sql`
        INSERT INTO "SecurityRateLimit" ("keyHash", "windowStartedAt", "windowEndsAt", "count", "updatedAt")
        VALUES (${keyHash}, ${now}, ${nextWindow}, 1, ${now})
        ON CONFLICT ("keyHash") DO UPDATE SET
            "count" = CASE
                WHEN "SecurityRateLimit"."windowEndsAt" <= ${now} THEN 1
                ELSE "SecurityRateLimit"."count" + 1
            END,
            "windowStartedAt" = CASE
                WHEN "SecurityRateLimit"."windowEndsAt" <= ${now} THEN ${now}
                ELSE "SecurityRateLimit"."windowStartedAt"
            END,
            "windowEndsAt" = CASE
                WHEN "SecurityRateLimit"."windowEndsAt" <= ${now} THEN ${nextWindow}
                ELSE "SecurityRateLimit"."windowEndsAt"
            END,
            "updatedAt" = ${now}
        RETURNING "count", "windowEndsAt"
    `);
    const result = rows[0];
    if (!result) throw new Error("No fue posible aplicar el límite de seguridad.");

    return {
        allowed: result.count <= options.limit,
        remaining: Math.max(0, options.limit - result.count),
        resetAt: result.windowEndsAt.getTime(),
    };
}

export function getBearerToken(headers: Headers) {
    const authorization = headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
}

export function safeSecretEqual(received: string | null | undefined, expected: string | null | undefined) {
    if (!received || !expected) return false;

    const receivedHash = crypto.createHash("sha256").update(received).digest();
    const expectedHash = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(receivedHash, expectedHash);
}
