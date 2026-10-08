import "server-only";
import { PlatformAdminAccessError } from "@/lib/platform-admin";

export class ControlValidationError extends Error {}

/** Only deliberate validation/access messages may reach the browser. */
export function controlApiError(error: unknown) {
    if (error instanceof PlatformAdminAccessError) return { status: error.status, message: error.message };
    if (error instanceof ControlValidationError) return { status: 400, message: error.message };
    const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
    if (["P1000", "P1001", "P1002", "P1008", "P1017", "P2024", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P02", "57P03", "53300"].includes(code)) {
        return { status: 503, message: "El servicio no está disponible temporalmente. Intenta nuevamente." };
    }
    if (code === "P2002") return { status: 409, message: "Ya existe un registro con esos datos." };
    return { status: 500, message: "No fue posible guardar el cambio. Intenta nuevamente." };
}
