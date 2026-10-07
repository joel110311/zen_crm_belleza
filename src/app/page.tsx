import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isPublicTenantSignupEnabled } from "@/lib/multitenant-features";
import { CrmLanding } from "@/components/marketing/crm-landing";
import { getPublicLandingOffer } from "@/lib/billing/public-offer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Zen CRM Cuidado Personal | Tu negocio, ahora inteligente",
    description: "Agenda, clientes, portal de reservas y WhatsApp en un solo CRM para barberías, peluquerías, salones y spas.",
};

export default async function Home() {
    if (!isPublicTenantSignupEnabled()) {
        redirect("/login");
    }

    return <CrmLanding offer={await getPublicLandingOffer()} />;
}
