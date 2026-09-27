import Link from "next/link";

export default function PrivacyPage() {
    return <main className="mx-auto max-w-3xl px-5 py-12"><h1 className="text-3xl font-semibold">Aviso de privacidad</h1><p className="mt-6 text-sm leading-7 text-muted-foreground">Versión vigente: {process.env.LEGAL_PRIVACY_VERSION || "2026-09-05"}. Usamos los datos de cuenta para proporcionar el servicio, proteger el acceso y enviar comunicaciones transaccionales. No vendemos datos personales. Al utilizar una prueba se conserva una huella criptográfica no legible del correo, limitada a prevenir el uso repetido de promociones incluso después de eliminar la cuenta. No se usa para publicidad ni permite recuperar el correo original. Puedes iniciar la eliminación definitiva desde <Link className="underline" href="/delete-account">Eliminar mi cuenta</Link> o escribir al responsable indicado en la plataforma.</p></main>;
}
