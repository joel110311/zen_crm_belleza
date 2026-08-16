import Link from "next/link";
import { ArrowRight, CalendarDays, LockKeyhole, RefreshCw } from "lucide-react";
import { GoogleOAuthPublicShell } from "@/components/public/google-oauth-public-shell";

export default function GoogleCalendarIntegrationPage() {
    return (
        <GoogleOAuthPublicShell
            title="Google Calendar en Zen CRM"
            description="Conecta la agenda de tu negocio para sincronizar citas, consultar disponibilidad y evitar cruces de horario desde un solo lugar."
        >
            <section>
                <h2 className="text-xl font-semibold">Que hace la integracion</h2>
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
                <h2 className="text-xl font-semibold">Tu decides cuando conectar o desconectar</h2>
                <p className="mt-2 text-muted-foreground">
                    La autorizacion se realiza en Google. Puedes retirar el acceso desde Zen CRM o desde la configuracion de seguridad de tu cuenta de Google.
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
