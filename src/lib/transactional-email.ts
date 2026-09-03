import "server-only";

type SendEmailInput = {
    to: string;
    subject: string;
    text: string;
    html: string;
};

type SentEmail = {
    provider: "resend";
    externalId: string | null;
};

/** Sends transactional email without exposing provider responses or API keys to route handlers. */
export async function sendTransactionalEmail(input: SendEmailInput): Promise<SentEmail> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    const replyTo = process.env.EMAIL_REPLY_TO?.trim();
    if (!apiKey || !from) {
        throw new Error("El correo transaccional no está configurado.");
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
            ...(replyTo ? { reply_to: replyTo } : {}),
        }),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as { id?: unknown; message?: unknown };
    if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message.slice(0, 160) : "El proveedor de correo rechazó el envío.");
    }

    return { provider: "resend", externalId: typeof payload.id === "string" ? payload.id : null };
}
