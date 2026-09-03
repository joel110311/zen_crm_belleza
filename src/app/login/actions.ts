"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export async function loginAction(
    prevState: string | undefined,
    formData: FormData
): Promise<string | undefined> {
    try {
        if (process.env.MULTITENANT_AUTH_ENABLED === "true") {
            const requestedRedirect = String(formData.get("redirectTo") || "");
            formData.set("redirectTo", /^\/(?:onboarding|t|tenants)(?:\/|$)/.test(requestedRedirect) ? requestedRedirect : "/tenants");
        }
        await signIn("credentials", formData);
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case "CredentialsSignin":
                    return "Credenciales incorrectas. Verifica tu email y contraseña.";
                default:
                    return "Ocurrió un error inesperado.";
            }
        }
        // NEXT_REDIRECT errors must be re-thrown
        throw error;
    }
    return undefined;
}
