import { redirect } from "next/navigation";
import { EmailVerification } from "./verification";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
    if (!isPublicTenantSignupEnabled()) redirect("/login");
    return <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5 py-12"><EmailVerification /></main>;
}
