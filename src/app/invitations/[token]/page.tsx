import { notFound } from "next/navigation";
import { InvitationAcceptanceForm } from "@/components/tenant/invitation-acceptance-form";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";
import { getInvitationAcceptanceDetails } from "@/lib/tenant-invitations";

export const metadata = { title: "Invitación de equipo | SynapseLogik CRM", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isMultitenantInvitationsEnabled() || !/^[A-Za-z0-9_-]{32,200}$/.test(token)) notFound();
    const details = await getInvitationAcceptanceDetails(token);
    if (!details) notFound();
    return <InvitationAcceptanceForm token={token} {...details} />;
}
