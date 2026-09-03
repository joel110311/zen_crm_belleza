import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "./forgot-password-form";
import { getTurnstileSiteKey, isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
    if (!isPublicTenantSignupEnabled()) redirect("/login");
    return <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5 py-12"><ForgotPasswordForm turnstileSiteKey={getTurnstileSiteKey()} /></main>;
}
