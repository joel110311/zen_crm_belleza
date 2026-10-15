import { AccountDeletionPanel } from "@/components/settings/account-deletion-panel";
import { DocumentShell } from "@/components/public/document-shell";
export const metadata = { title: "Eliminar cuenta | SynapseLogik CRM", robots: { index: false, follow: false } };
export default function DeleteAccountPage() {
    return <DocumentShell title="Eliminar mi cuenta" active="deletion"><AccountDeletionPanel /></DocumentShell>;
}
