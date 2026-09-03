export default function TermsPage() {
    return <main className="mx-auto max-w-3xl px-5 py-12"><h1 className="text-3xl font-semibold">Términos de servicio</h1><p className="mt-6 text-sm leading-7 text-muted-foreground">Versión vigente: {process.env.LEGAL_TERMS_VERSION || "2026-09-03"}. El acceso anticipado se ofrece como software en evolución. Cada negocio conserva la responsabilidad sobre los datos que captura, sus comunicaciones y el cumplimiento de su normativa local.</p></main>;
}
