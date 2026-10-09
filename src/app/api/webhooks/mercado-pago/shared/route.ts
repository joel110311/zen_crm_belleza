import { NextRequest, NextResponse } from "next/server";
import {
    getMercadoPagoPayment,
    getMercadoPagoWebhookRuntimeConfigurations,
    verifyMercadoPagoWebhookSignature,
} from "@/lib/billing/mercado-pago";
import { resolveMercadoPagoWebhookPayment } from "@/lib/billing/mercado-pago-runtime-helpers";
import { POST as receiveCrmNotification } from "../route";

export const runtime = "nodejs";

/** One application, two products. Never trust the notification's claimed owner. */
export async function POST(request: NextRequest) {
    try {
        // Keep the original stream available for the CRM's signed, idempotent handler.
        const rawPayload = await request.clone().text();
        const payload = JSON.parse(rawPayload) as Record<string, unknown>;
        const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
        const dataId = request.nextUrl.searchParams.get("data.id") || String(data.id ?? "");
        const eventType = request.nextUrl.searchParams.get("type")
            || request.nextUrl.searchParams.get("topic") || String(payload.type ?? "");
        const xSignature = request.headers.get("x-signature");
        const xRequestId = request.headers.get("x-request-id");
        if (!dataId || !eventType || !xSignature || !xRequestId) {
            return NextResponse.json({ error: "Notificación incompleta." }, { status: 400 });
        }
        const runtimes = getMercadoPagoWebhookRuntimeConfigurations().filter(candidate =>
            verifyMercadoPagoWebhookSignature({ xSignature, xRequestId, dataId, secret: candidate.webhookSecret }));
        if (!runtimes.length) return NextResponse.json({ error: "Firma inválida." }, { status: 401 });

        // Eventiia uses Checkout Pro only. Subscription events stay in the CRM.
        if (eventType !== "payment") return receiveCrmNotification(request);
        const { payment, runtime: configuration } = await resolveMercadoPagoWebhookPayment(
            dataId, runtimes, candidate => getMercadoPagoPayment(dataId, candidate));
        if (String(payment.application_id ?? "") !== configuration.applicationId) {
            return NextResponse.json({ error: "Aplicación del pago no válida." }, { status: 422 });
        }
        if (!payment.external_reference?.startsWith("eventiia:")) return receiveCrmNotification(request);

        // Fixed upstream prevents SSRF. Preserve signature/body/query, never cookies or tokens.
        const target = new URL("https://eventiia.mx/api/webhooks/mercado-pago");
        target.search = request.nextUrl.search;
        const delivered = await fetch(target, {
            method: "POST",
            body: rawPayload,
            headers: { "content-type": "application/json", "x-signature": xSignature, "x-request-id": xRequestId },
            redirect: "manual",
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
        });
        if (!delivered.ok) {
            console.error("[webhooks.mercado-pago.shared] Eventiia delivery failed", delivered.status);
            return NextResponse.json({ error: "Entrega pendiente de reintento." }, { status: 502 });
        }
        return NextResponse.json({ received: true, destination: "eventiia" });
    } catch (error) {
        if (error instanceof SyntaxError) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
        // Do not expose provider responses, credential values, or customer payloads.
        console.error("[webhooks.mercado-pago.shared] Verification or delivery unavailable");
        return NextResponse.json({ error: "No fue posible entregar la notificación." }, { status: 503 });
    }
}
