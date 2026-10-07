import { notFound } from "next/navigation";
import { CrmLanding } from "@/components/marketing/crm-landing";
import { LANDING_PREVIEW_OFFER } from "@/lib/landing-offer";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default function LandingPreview() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <CrmLanding offer={LANDING_PREVIEW_OFFER} preview />;
}
