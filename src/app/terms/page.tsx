import { DocumentShell } from "@/components/public/document-shell";

export const metadata = { title: "Términos de servicio | SynapseLogik CRM" };

export default function TermsPage() {
    return <DocumentShell title="Términos de servicio" active="terms"><p>Versión vigente: {process.env.LEGAL_TERMS_VERSION || "2026-09-03"}. El acceso anticipado se ofrece como software en evolución. Cada negocio conserva la responsabilidad sobre los datos que captura, sus comunicaciones y el cumplimiento de su normativa local.</p></DocumentShell>;
}
