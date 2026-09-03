export default function PrivacyPage() {
    return <main className="mx-auto max-w-3xl px-5 py-12"><h1 className="text-3xl font-semibold">Aviso de privacidad</h1><p className="mt-6 text-sm leading-7 text-muted-foreground">Versión vigente: {process.env.LEGAL_PRIVACY_VERSION || "2026-09-03"}. Usamos los datos de cuenta para proporcionar el servicio, proteger el acceso y enviar comunicaciones transaccionales. No vendemos datos personales. Para ejercer derechos sobre tu cuenta, contacta al responsable indicado en la plataforma.</p></main>;
}
