import { notFound } from "next/navigation";
import { InvitationAcceptanceForm } from "@/components/tenant/invitation-acceptance-form";
import { isMultitenantInvitationsEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isMultitenantInvitationsEnabled() || !/^[A-Za-z0-9_-]{32,200}$/.test(token)) notFound();
    return <InvitationAcceptanceForm token={token} />;
}
