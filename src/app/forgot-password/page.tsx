import { AuthShell } from "@/components/public/auth-shell";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "./forgot-password-form";
import { getTurnstileSiteKey, isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
    if (!isPublicTenantSignupEnabled()) redirect("/login");
    return <AuthShell title="Recupera tu acceso" description="Te enviaremos un enlace si existe una cuenta asociada al correo."><ForgotPasswordForm turnstileSiteKey={getTurnstileSiteKey()} /></AuthShell>;
}
