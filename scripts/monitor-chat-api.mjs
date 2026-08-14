#!/usr/bin/env node
import { performance } from "node:perf_hooks";

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            args[key] = "true";
            continue;
        }
        args[key] = next;
        i += 1;
    }
    return args;
}

function requireArg(args, key) {
    const value = args[key];
    if (!value) {
        throw new Error(`Missing required argument: --${key}`);
    }
    return value;
}

function numberArg(args, key, fallback) {
    const raw = args[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid numeric value for --${key}: ${raw}`);
    }
    return parsed;
}

function getSetCookies(response) {
    if (typeof response.headers.getSetCookie === "function") {
        return response.headers.getSetCookie();
    }
    const single = response.headers.get("set-cookie");
    return single ? [single] : [];
}

function updateCookieJar(cookieJar, setCookies) {
    for (const setCookie of setCookies) {
        const [pair] = setCookie.split(";", 1);
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!name) continue;
        cookieJar[name] = value;
    }
}

function jarToCookieHeader(cookieJar) {
    return Object.entries(cookieJar)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const bounded = Math.max(0, Math.min(index, sorted.length - 1));
    return sorted[bounded];
}

function average(values) {
    if (values.length === 0) return 0;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function maxDateIso(conversations) {
    let latest = null;
    for (const conversation of conversations) {
        const raw = conversation?.updatedAt ?? conversation?.lastMessageTime;
        if (!raw) continue;
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) continue;
        if (!latest || date.getTime() > latest.getTime()) {
            latest = date;
        }
    }
    return latest ? latest.toISOString() : null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginWithCredentials({ baseUrl, email, password }) {
    const cookieJar = {};

    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, {
        method: "GET",
        redirect: "manual",
    });
    updateCookieJar(cookieJar, getSetCookies(csrfResponse));
    if (!csrfResponse.ok) {
        throw new Error(`CSRF request failed with status ${csrfResponse.status}`);
    }
    const csrfPayload = await csrfResponse.json();
    if (!csrfPayload?.csrfToken) {
        throw new Error("Unable to obtain CSRF token");
    }

    const loginBody = new URLSearchParams({
        csrfToken: csrfPayload.csrfToken,
        email,
        password,
        callbackUrl: `${baseUrl}/dashboard/inbox`,
        json: "true",
    });

    const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
        method: "POST",
        redirect: "manual",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: jarToCookieHeader(cookieJar),
        },
        body: loginBody.toString(),
    });
    updateCookieJar(cookieJar, getSetCookies(loginResponse));

    if (!(loginResponse.status >= 200 && loginResponse.status < 400)) {
        throw new Error(`Login request failed with status ${loginResponse.status}`);
    }

    const cookieHeader = jarToCookieHeader(cookieJar);
    const hasSessionCookie =
        /authjs\.session-token=|__Secure-authjs\.session-token=|next-auth\.session-token=|__Secure-next-auth\.session-token=/.test(cookieHeader);
    if (!hasSessionCookie) {
        throw new Error("Login failed: session cookie not found");
    }

    return cookieJar;
}

async function monitor({
    baseUrl,
    cookieJar,
    limit,
    intervalMs,
    durationMinutes,
}) {
    const durationMs = durationMinutes * 60 * 1000;
    const endAt = Date.now() + durationMs;
    const latencies = [];
    const payloadBytes = [];
    const refreshStalenessSeconds = [];
    let okCount = 0;
    let errorCount = 0;
    let sampleIndex = 0;

    while (Date.now() < endAt) {
        sampleIndex += 1;
        const startedAt = Date.now();
        const startedPerf = performance.now();

        try {
            const response = await fetch(`${baseUrl}/api/chat?limit=${limit}`, {
                method: "GET",
                headers: {
                    cookie: jarToCookieHeader(cookieJar),
                    "cache-control": "no-cache",
                },
            });
            const bodyText = await response.text();
            const elapsedMs = performance.now() - startedPerf;
            latencies.push(elapsedMs);
            payloadBytes.push(Buffer.byteLength(bodyText, "utf8"));

            if (!response.ok) {
                errorCount += 1;
                console.log(`[${new Date().toISOString()}] sample=${sampleIndex} status=${response.status} latency_ms=${elapsedMs.toFixed(1)}`);
            } else {
                okCount += 1;
                try {
                    const data = JSON.parse(bodyText);
                    if (Array.isArray(data)) {
                        const latestIso = maxDateIso(data);
                        if (latestIso) {
                            const stalenessSec = (Date.now() - new Date(latestIso).getTime()) / 1000;
                            if (Number.isFinite(stalenessSec)) {
                                refreshStalenessSeconds.push(stalenessSec);
                            }
                        }
                    }
                } catch {
                    // Ignore JSON parse errors for summary purposes.
                }
            }
        } catch (error) {
            errorCount += 1;
            const elapsedMs = performance.now() - startedPerf;
            latencies.push(elapsedMs);
            payloadBytes.push(0);
            const message = error instanceof Error ? error.message : "Unknown error";
            console.log(`[${new Date().toISOString()}] sample=${sampleIndex} request_error latency_ms=${elapsedMs.toFixed(1)} detail="${message}"`);
        }

        if (sampleIndex % Math.max(1, Math.floor(60_000 / intervalMs)) === 0) {
            const p95 = percentile(latencies, 95);
            console.log(
                `[${new Date().toISOString()}] progress samples=${sampleIndex} ok=${okCount} err=${errorCount} p95_ms=${p95.toFixed(1)}`,
            );
        }

        const cycleElapsed = Date.now() - startedAt;
        const waitMs = Math.max(0, intervalMs - cycleElapsed);
        if (waitMs > 0) {
            await sleep(waitMs);
        }
    }

    const total = okCount + errorCount;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const avg = average(latencies);
    const maxLatency = latencies.length ? Math.max(...latencies) : 0;
    const avgPayloadBytes = average(payloadBytes);
    const p95PayloadBytes = percentile(payloadBytes, 95);
    const refreshStalenessP95 = percentile(refreshStalenessSeconds, 95);

    const inboxRefreshP95Sec = (3000 + p95) / 1000;
    const notifierRefreshP95Sec = (4000 + p95) / 1000;

    return {
        totalSamples: total,
        okCount,
        errorCount,
        errorRatePct: total > 0 ? (errorCount / total) * 100 : 0,
        latency: {
            p50,
            p95,
            p99,
            avg,
            max: maxLatency,
        },
        payload: {
            avgBytes: avgPayloadBytes,
            p95Bytes: p95PayloadBytes,
        },
        freshness: {
            p95StalenessSeconds: refreshStalenessP95,
        },
        estimatedUiRefresh: {
            inboxP95Seconds: inboxRefreshP95Sec,
            notifierP95Seconds: notifierRefreshP95Sec,
        },
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === "true") {
        console.log(
            "Usage: node scripts/monitor-chat-api.mjs --base-url <url> --email <email> --password <password> [--duration-minutes 30] [--interval-ms 3000] [--limit 300]",
        );
        process.exit(0);
    }

    const baseUrl = requireArg(args, "base-url").replace(/\/+$/, "");
    const email = requireArg(args, "email");
    const password = requireArg(args, "password");
    const durationMinutes = numberArg(args, "duration-minutes", 30);
    const intervalMs = numberArg(args, "interval-ms", 3000);
    const limit = numberArg(args, "limit", 300);

    console.log(
        `Starting monitor for ${baseUrl} duration=${durationMinutes}min interval=${intervalMs}ms limit=${limit}`,
    );

    const cookieJar = await loginWithCredentials({ baseUrl, email, password });
    const result = await monitor({
        baseUrl,
        cookieJar,
        limit,
        intervalMs,
        durationMinutes,
    });

    console.log("\n=== CHAT API MONITOR SUMMARY ===");
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Monitor failed: ${message}`);
    process.exit(1);
});
