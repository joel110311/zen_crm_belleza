import { GoogleOAuthPublicShell } from "@/components/public/google-oauth-public-shell";

export default function PrivacyPage() {
    const supportEmail = process.env.PUBLIC_SUPPORT_EMAIL?.trim();

    return (
        <GoogleOAuthPublicShell
            title="Aviso de privacidad"
            description="Este aviso explica como Zen CRM trata la informacion cuando un negocio conecta Google Calendar. Ultima actualizacion: 16 de agosto de 2026."
        >
            <section>
                <h2 className="text-xl font-semibold">Datos de Google que utilizamos</h2>
                <p className="mt-2 text-muted-foreground">
                    Con autorizacion del usuario, Zen CRM accede al correo de la cuenta conectada, a la lista de calendarios y a los eventos de los calendarios seleccionados. No solicitamos la contrasena de Google ni permiso para crear o eliminar calendarios completos.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Finalidad</h2>
                <p className="mt-2 text-muted-foreground">
                    Usamos esos datos exclusivamente para mostrar calendarios disponibles, sincronizar citas, crear o actualizar eventos y bloquear horarios ocupados dentro del negocio que autorizo la conexion.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Almacenamiento y seguridad</h2>
                <p className="mt-2 text-muted-foreground">
                    Los tokens de autorizacion se cifran antes de almacenarse. Aplicamos controles de acceso por permisos y no mostramos credenciales ni tokens en el navegador. Conservamos la autorizacion mientras la integracion permanezca conectada y eliminamos las credenciales locales al desconectarla.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Uso limitado y divulgacion</h2>
                <p className="mt-2 text-muted-foreground">
                    Zen CRM cumple la Politica de datos de usuario de los servicios API de Google, incluidos sus requisitos de Uso limitado. No vendemos datos de Google, no los utilizamos para publicidad ni para entrenar modelos generales. No permitimos acceso humano salvo cuando sea necesario por seguridad, cumplimiento legal o soporte solicitado y autorizado por el cliente.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Control del usuario</h2>
                <p className="mt-2 text-muted-foreground">
                    El administrador puede desconectar Google Calendar desde Zen CRM. Tambien puede revocar el acceso desde la pagina de conexiones de terceros de su cuenta de Google. Las citas del CRM se conservan de acuerdo con las necesidades operativas del negocio y pueden eliminarse mediante sus herramientas administrativas.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">Contacto</h2>
                <p className="mt-2 text-muted-foreground">
                    Para dudas de privacidad o solicitudes relacionadas con sus datos, utiliza el canal de soporte de tu cuenta de Zen CRM
                    {supportEmail ? <> o escribe a <a className="font-medium text-primary hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a></> : null}.
                </p>
            </section>
        </GoogleOAuthPublicShell>
    );
}
