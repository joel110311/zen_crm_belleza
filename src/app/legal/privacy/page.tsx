import { GoogleOAuthPublicShell } from "@/components/public/google-oauth-public-shell";

export default function PrivacyPage() {
    const supportEmail = process.env.PUBLIC_SUPPORT_EMAIL?.trim();

    return (
        <GoogleOAuthPublicShell
            title="Aviso de privacidad"
            description="Este aviso explica cómo Zen CRM recopila, protege y utiliza la información cuando un negocio conecta su cuenta de Google Calendar. Última actualización: 17 de agosto de 2026."
        >
            <section>
                <h2 className="text-xl font-semibold">1. Datos de Google que utilizamos</h2>
                <p className="mt-2 text-muted-foreground">
                    Con la autorización explícita del usuario mediante el flujo de consentimiento OAuth 2.0 de Google, Zen CRM solicita acceso a:
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
                    <li><strong className="text-foreground">Identidad básica (openid, email):</strong> Dirección de correo electrónico para identificar y vincular la cuenta del especialista o negocio.</li>
                    <li><strong className="text-foreground">Lista de calendarios (calendarlist.readonly):</strong> Visualización de los calendarios disponibles del usuario para que seleccione a cuál sincronizar sus citas.</li>
                    <li><strong className="text-foreground">Gestión de eventos (calendar.events):</strong> Creación, lectura, actualización y sincronización de citas y eventos de consulta agendados en el CRM.</li>
                </ul>
                <p className="mt-2 text-muted-foreground">
                    No solicitamos ni almacenamos contraseñas de Google ni permisos para eliminar calendarios completos o acceder a otros servicios de Google no autorizados.
                </p>
            </section>

            <section>
                <h2 className="text-xl font-semibold">2. Finalidad del tratamiento</h2>
                <p className="mt-2 text-muted-foreground">
                    Los datos obtenidos se utilizan exclusivamente para:
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
                    <li>Permitir al usuario seleccionar el calendario de destino dentro de su cuenta de Google.</li>
                    <li>Sincronizar de forma bidireccional las citas creadas o modificadas en Zen CRM con el calendario de Google del especialista.</li>
                    <li>Bloquear horarios ocupados para evitar duplicidad de citas y garantizar la disponibilidad real de la agenda.</li>
                </ul>
            </section>

            <section>
                <h2 className="text-xl font-semibold">3. Mecanismos de protección y seguridad de datos sensibles</h2>
                <p className="mt-2 text-muted-foreground">
                    Implementamos estrictas salvaguardas técnicas, administrativas y operativas para proteger la confidencialidad e integridad de todos los datos sensibles y tokens de autenticación:
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
                    <li><strong className="text-foreground">Cifrado en reposo:</strong> Todos los tokens de acceso y actualización (OAuth Refresh Tokens) se cifran mediante algoritmos criptográficos robustos (AES-256 / GCM) antes de su almacenamiento en base de datos.</li>
                    <li><strong className="text-foreground">Cifrado en tránsito:</strong> Todas las comunicaciones entre el cliente, Zen CRM y los servidores de Google API se realizan estrictamente sobre canales seguros con HTTPS / TLS 1.3.</li>
                    <li><strong className="text-foreground">Control de acceso basado en roles (RBAC):</strong> El acceso a la integración está restringido únicamente a usuarios autenticados con permisos específicos dentro de la organización.</li>
                    <li><strong className="text-foreground">Aislamiento de credenciales:</strong> Los tokens y secretos de API nunca se exponen al navegador cliente ni se incluyen en registros de auditoría o logs públicos.</li>
                </ul>
            </section>

            <section>
                <h2 className="text-xl font-semibold">4. Cumplimiento de Uso Limitado y Declaración sobre Modelos de IA / ML</h2>
                <p className="mt-2 text-muted-foreground">
                    Zen CRM cumple de manera estricta con la <strong className="text-foreground">Política de Datos de Usuario de los Servicios de las APIs de Google</strong>, incluidos los requisitos de Uso Limitado (Limited Use Requirements):
                </p>
                <div className="mt-3 rounded-2xl border bg-muted/30 p-4 text-sm text-foreground space-y-2">
                    <p>
                        <strong>Declaración afirmativa:</strong> El uso y la transferencia a cualquier otra aplicación de la información recibida de las APIs de Google por parte de Zen CRM se adherirán a la <a className="text-primary underline font-medium" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Política de Datos de Usuario de los Servicios de las APIs de Google</a>, incluidos los requisitos de Uso Limitado.
                    </p>
                </div>
                <ul className="mt-3 list-disc pl-5 space-y-1 text-muted-foreground">
                    <li><strong className="text-foreground">Sin uso para entrenamiento de IA:</strong> Los datos de usuario en bruto, agregados o derivados obtenidos mediante las APIs de Google Workspace / Google Calendar <strong>NUNCA</strong> se transfieren a proveedores de Inteligencia Artificial de terceros, ni se utilizan para entrenar, reentrenar, ajustar o mejorar modelos generalizados o fundacionales de Aprendizaje Automático / Inteligencia Artificial (IA/ML).</li>
                    <li><strong className="text-foreground">Aislamiento de servicios de IA:</strong> Si Zen CRM utiliza funciones de IA para canales de mensajería (como chatbots de atención), dichos servicios operan en entornos estrictamente aislados y no tienen acceso a los datos ni a las credenciales de Google Calendar.</li>
                    <li><strong className="text-foreground">Sin venta ni publicidad:</strong> No vendemos datos de usuario de Google a terceros ni los utilizamos para fines publicitarios o de prospección comercial no solicitada.</li>
                    <li><strong className="text-foreground">Restricción de acceso humano:</strong> Ningún empleado o desarrollador tiene acceso humano a los datos de los eventos de Google, salvo consentimiento explícito del usuario para soporte técnico puntual, por requerimiento de seguridad o cumplimiento de una orden legal válida.</li>
                </ul>
            </section>

            <section>
                <h2 className="text-xl font-semibold">5. Control, retención y eliminación de datos</h2>
                <p className="mt-2 text-muted-foreground">
                    El usuario mantiene el control absoluto sobre sus datos y la integración en todo momento:
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
                    <li><strong className="text-foreground">Desconexión inmediata:</strong> El usuario puede desconectar la integración desde el panel de Configuración de Zen CRM, lo que elimina de forma irreversible los tokens de acceso locales.</li>
                    <li><strong className="text-foreground">Revocación en Google:</strong> El usuario puede revocar los permisos en cualquier momento desde la página de <a className="text-primary underline font-medium" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Seguridad y Permisos de su Cuenta de Google</a>.</li>
                    <li><strong className="text-foreground">Eliminación de datos:</strong> Al terminar la suscripción o solicitar la baja de la cuenta, todos los registros asociados se eliminan o anonimizan conforme a la legislación aplicable.</li>
                </ul>
            </section>

            <section>
                <h2 className="text-xl font-semibold">6. Contacto</h2>
                <p className="mt-2 text-muted-foreground">
                    Si tienes dudas sobre este aviso de privacidad, el tratamiento de tus datos o deseas ejercer tus derechos de acceso, rectificación o eliminación, contáctanos a través del canal de soporte de Zen CRM
                    {supportEmail ? <> o al correo: <a className="font-medium text-primary hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a></> : null}.
                </p>
            </section>
        </GoogleOAuthPublicShell>
    );
}
