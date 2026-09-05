import { AccountDeletionPanel } from "@/components/settings/account-deletion-panel";
export const metadata = { title: "Eliminar cuenta | SynapseLogik CRM", robots: { index: false, follow: false } };
export default function DeleteAccountPage() {
    return <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6"><h1 className="mb-2 text-2xl font-semibold">Eliminar mi cuenta</h1><p className="mb-6 text-sm text-muted-foreground">SynapseLogik CRM</p><AccountDeletionPanel /></main>;
}
