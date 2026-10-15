import { AuthShell } from "@/components/public/auth-shell";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "./reset-password-form";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
    if (!isPublicTenantSignupEnabled()) redirect("/login");
    return <AuthShell title="Nueva contraseña" description="Usa al menos 12 caracteres para proteger tu cuenta."><ResetPasswordForm /></AuthShell>;
}
