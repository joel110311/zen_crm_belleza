import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, LockKeyhole, RefreshCw } from "lucide-react";
import { GoogleOAuthPublicShell } from "@/components/public/google-oauth-public-shell";

export const metadata: Metadata = {
    title: "Zen CRM",
    description:
        "Zen CRM es una plataforma de gestión de clientes y citas que integra Google Calendar para consultar disponibilidad y sincronizar eventos.",
};

export default function GoogleCalendarIntegrationPage() {
    return (
        <GoogleOAuthPublicShell
            title="Zen CRM"
            description="Zen CRM es una plataforma de gestión de clientes, conversaciones y citas para negocios. Su integración con Google Calendar permite consultar la disponibilidad real del equipo y sincronizar las citas administradas en el CRM."
        >
            <section>
                <h2 className="text-xl font-semibold">Integración con Google Calendar</h2>
                <p className="mt-2 text-muted-foreground">
                    Cuando el administrador conecta voluntariamente la cuenta Google del negocio, Zen CRM utiliza el acceso autorizado exclusivamente para estas funciones:
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    {[
                        [CalendarDays, "Sincroniza citas", "Crea y actualiza eventos de las citas administradas en Zen CRM."],
                        [RefreshCw, "Mantiene disponibilidad", "Lee los calendarios elegidos para reflejar horarios ocupados."],
                        [LockKeyhole, "Acceso controlado", "Solicita solo permisos de eventos y lectura de la lista de calendarios."],
                    ].map(([Icon, title, text]) => {
                        const ItemIcon = Icon as typeof CalendarDays;
                        return (
                            <div key={String(title)} className="rounded-2xl border bg-muted/25 p-4">
                                <ItemIcon className="h-5 w-5 text-primary" />
                                <h3 className="mt-3 font-semibold">{String(title)}</h3>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">{String(text)}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Tú controlas la conexión</h2>
                <p className="mt-2 text-muted-foreground">
                    Zen CRM no solicita la contraseña de Google. La autorización se realiza directamente en Google y el administrador elige la cuenta que desea enlazar. El acceso puede retirarse en cualquier momento desde Zen CRM o desde la configuración de seguridad de la cuenta de Google.
                </p>
            </section>

            <div className="flex flex-wrap gap-3 border-t pt-6">
                <Link href="/legal/privacy" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
                    Aviso de privacidad <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/legal/terms" className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
                    Terminos del servicio <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </GoogleOAuthPublicShell>
    );
}
