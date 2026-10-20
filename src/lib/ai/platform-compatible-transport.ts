import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { compatibleChatEndpoint } from "@/lib/ai/platform-router-config";

export class PlatformAiHttpError extends Error {
    constructor(readonly status: number) { super(`Proveedor de IA: HTTP ${status}`); }
}

export function isPublicAiAddress(address: string) {
    if (isIP(address) === 4) {
        const [a, b] = address.split(".").map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
            || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
    }
    // Global unicast only; reject loopback, local, mapped IPv4 and transition ranges.
    const normalized = address.toLowerCase();
    return isIP(address) === 6 && /^[23]/.test(normalized) && !/^(2001:(?:db8|0|2|10|20):|2002:)/.test(normalized);
}

/** Pin DNS for this request, never follow redirects, and bound response size. */
async function requestProviderJson(url: URL, apiKey: string, method: "GET" | "POST", body: Record<string, unknown> | undefined, signal: AbortSignal): Promise<unknown> {
    const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        const aborted = () => reject(new Error("Tiempo de espera del proveedor agotado."));
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) { signal.removeEventListener("abort", aborted); aborted(); return; }
        lookup(url.hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    });
    if (!addresses.length || addresses.some(row => !isPublicAiAddress(row.address))) throw new Error("El proveedor debe usar una dirección pública.");
    const address = addresses[0];
    return new Promise<unknown>((resolve, reject) => {
        const req = request(url, {
            method, signal, family: address.family,
            lookup: (_host, options, callback) => {
                if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
            },
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        }, response => {
            response.on("error", () => reject(new Error("No se pudo leer la respuesta del proveedor.")));
            const status = response.statusCode || 500;
            if (status < 200 || status >= 300) { response.resume(); reject(new PlatformAiHttpError(status)); return; }
            let size = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > 512_000) { response.destroy(); reject(new Error("Respuesta del proveedor demasiado extensa.")); }
                else chunks.push(chunk);
            });
            response.on("end", () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                } catch { reject(new Error("El proveedor no devolvió texto utilizable.")); }
            });
        });
        req.on("error", () => reject(new Error("No se pudo contactar al proveedor de IA.")));
        req.end(JSON.stringify(body));
    });
}

export async function requestCompatibleAi(baseUrl: string, apiKey: string, body: Record<string, unknown>, signal: AbortSignal) {
    const data = await requestProviderJson(new URL(compatibleChatEndpoint(baseUrl)), apiKey, "POST", body, signal) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("El proveedor no devolvió texto utilizable.");
    return content.trim();
}

export async function requestCompatibleModels(baseUrl: string, apiKey: string, signal: AbortSignal) {
    const url = new URL(compatibleChatEndpoint(baseUrl));
    url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
    const data = await requestProviderJson(url, apiKey, "GET", undefined, signal) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(data?.data)) throw new Error("El endpoint no ofrece una lista compatible de modelos.");
    return [...new Set(data.data.flatMap(model => model && typeof model.id === "string" && /^[a-zA-Z0-9._:/-]{1,150}$/.test(model.id) ? [model.id] : []))].sort().slice(0, 300);
}
