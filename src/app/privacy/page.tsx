import Link from "next/link";
import { DocumentShell } from "@/components/public/document-shell";

export const metadata = { title: "Aviso de privacidad | SynapseLogik CRM" };

export default function PrivacyPage() {
    return <DocumentShell title="Aviso de privacidad" active="privacy"><p>Versión vigente: {process.env.LEGAL_PRIVACY_VERSION || "2026-09-05"}. Usamos los datos de cuenta para proporcionar el servicio, proteger el acceso y enviar comunicaciones transaccionales. No vendemos datos personales. Al utilizar una prueba se conserva una huella criptográfica no legible del correo, limitada a prevenir el uso repetido de promociones incluso después de eliminar la cuenta. No se usa para publicidad ni permite recuperar el correo original. Puedes iniciar la eliminación definitiva desde <Link className="underline" href="/delete-account">Eliminar mi cuenta</Link> o escribir al responsable indicado en la plataforma.</p></DocumentShell>;
}
