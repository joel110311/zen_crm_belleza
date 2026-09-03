import "server-only";

type TurnstileResponse = {
    success?: boolean;
    action?: string;
    hostname?: string;
};

/** Validates a Cloudflare Turnstile token on the server; browser-side success is never trusted. */
export async function verifySignupCaptcha(
    token: unknown,
    remoteIp: string,
    expectedAction: "signup" | "password_reset",
): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    const responseToken = typeof token === "string" ? token.trim() : "";
    if (!secret || !responseToken) return false;

    try {
        const body = new URLSearchParams({ secret, response: responseToken });
        if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            cache: "no-store",
        });
        if (!response.ok) return false;
        const result = await response.json() as TurnstileResponse;
        const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
        return result.success === true
            && result.action === expectedAction
            && (!expectedHostname || result.hostname?.toLowerCase() === expectedHostname);
    } catch {
        return false;
    }
}
