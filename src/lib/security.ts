import crypto from "crypto";

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
