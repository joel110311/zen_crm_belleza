"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export async function loginAction(
    prevState: string | undefined,
    formData: FormData
): Promise<string | undefined> {
    try {
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
