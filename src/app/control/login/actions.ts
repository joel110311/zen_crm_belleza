"use server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function platformAdminLoginAction(_previous: string | undefined, form: FormData): Promise<string | undefined> {
    try {
        await signIn("platform-admin", {
            username: String(form.get("username") || ""),
            password: String(form.get("password") || ""),
            redirectTo: "/control",
        });
    } catch (error) {
        if (error instanceof AuthError) return error.type === "CredentialsSignin"
            ? "Usuario o contraseña incorrectos, o acceso administrativo no configurado."
            : "No fue posible iniciar sesión. Intenta nuevamente.";
        throw error;
    }
}
