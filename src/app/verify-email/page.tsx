import { AuthShell } from "@/components/public/auth-shell";
import { redirect } from "next/navigation";
import { EmailVerification } from "./verification";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
    if (!isPublicTenantSignupEnabled()) redirect("/login");
    return <AuthShell title="Confirma tu correo" description="Verifica tu cuenta para continuar con el registro."><EmailVerification /></AuthShell>;
}
