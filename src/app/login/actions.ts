"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { isLegacyApplicationRequest, trustedRequestOrigin } from "@/lib/application-host";
import { isGoogleSignInEnabled } from "@/lib/google-signin";
import { redirect } from "next/navigation";

export async function loginAction(
    prevState: string | undefined,
    formData: FormData
): Promise<string | undefined> {
    try {
        const requestHeaders = await headers();
        const legacyRequest = isLegacyApplicationRequest(requestHeaders);
        const requestedRedirect = String(formData.get("redirectTo") || "");
        if (process.env.MULTITENANT_AUTH_ENABLED === "true" && !legacyRequest) {
            formData.set("redirectTo", /^\/(?:onboarding|t|tenants)(?:\/|$)/.test(requestedRedirect) ? requestedRedirect : "/tenants");
        } else if (legacyRequest) {
            const safePath = requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
                ? requestedRedirect
                : "/dashboard";
            formData.set("redirectTo", `${trustedRequestOrigin(requestHeaders)}${safePath}`);
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

export async function googleLoginAction(formData: FormData) {
    const requestHeaders = await headers();
    if (isLegacyApplicationRequest(requestHeaders) || !isGoogleSignInEnabled()) {
        redirect("/login?error=google_not_configured");
    }

    const requestedRedirect = String(formData.get("redirectTo") || "");
    const redirectTo = /^\/(?:onboarding|t|tenants)(?:\/|$)/.test(requestedRedirect)
        ? requestedRedirect
        : "/tenants";
    await signIn("google", { redirectTo });
}
