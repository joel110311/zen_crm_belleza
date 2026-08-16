import { GoogleOAuthPublicShell } from "@/components/public/google-oauth-public-shell";

export default function TermsPage() {
    return (
        <GoogleOAuthPublicShell
            title="Terminos del servicio"
            description="Condiciones aplicables al uso de Zen CRM y su integracion con Google Calendar. Ultima actualizacion: 16 de agosto de 2026."
        >
            <section>
                <h2 className="text-xl font-semibold">Uso autorizado</h2>
                <p className="mt-2 text-muted-foreground">
                    Zen CRM debe utilizarse para administrar la operacion legitima del negocio. El usuario es responsable de contar con autorizacion para registrar y tratar la informacion de sus clientes y colaboradores.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Google Calendar</h2>
                <p className="mt-2 text-muted-foreground">
                    La conexion es opcional y depende de los servicios de Google. El administrador elige que calendarios utilizar y puede revocar el acceso en cualquier momento. No se permite utilizar la integracion para acceder a calendarios sin autorizacion.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Disponibilidad y responsabilidad</h2>
                <p className="mt-2 text-muted-foreground">
                    Trabajamos para mantener el servicio disponible y la sincronizacion correcta, pero pueden existir interrupciones de red o de proveedores externos. El negocio debe revisar la agenda antes de tomar decisiones que dependan de informacion critica.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Suspension y terminacion</h2>
                <p className="mt-2 text-muted-foreground">
                    El acceso puede suspenderse ante uso abusivo, riesgo de seguridad o incumplimiento de estas condiciones. Al terminar el servicio, el cliente debe desconectar las integraciones y solicitar la eliminacion o exportacion de sus datos conforme a su contrato.
                </p>
            </section>
        </GoogleOAuthPublicShell>
    );
}
