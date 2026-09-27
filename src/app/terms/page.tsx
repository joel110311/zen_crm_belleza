import type { Metadata } from "next";
import Link from "next/link";
import { publicLegalDetails } from "@/lib/public-legal-details";

export const metadata: Metadata = {
    title: "Términos de servicio | SynapseLogik CRM",
    description: "Condiciones de acceso y uso de SynapseLogik CRM.",
};

const termsVersion = process.env.LEGAL_TERMS_VERSION?.trim() || "2026-09-26.2";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="mt-8"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">{children}</div></section>;
}

export default function TermsPage() {
    return (
        <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
            <Link href="/signup" className="text-sm font-medium text-primary hover:underline">← Volver al registro</Link>
            <header className="mt-7 border-b pb-6">
                <p className="text-sm font-medium text-primary">SynapseLogik CRM</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Términos de servicio</h1>
                <p className="mt-3 text-sm text-muted-foreground">Última actualización: 26 de septiembre de 2026 · Versión {termsVersion}</p>
            </header>
            <p className="mt-6 text-sm leading-7 text-muted-foreground">Estos términos regulan el registro y uso de SynapseLogik CRM, un servicio de software para negocios. Al crear un espacio, la persona que lo registra declara que puede aceptar estas condiciones por sí misma o en representación del negocio. El aviso de privacidad describe el tratamiento de datos personales y forma parte de la información que debes leer antes de registrarte.</p>

            <section className="mt-8 rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground"><h2 className="font-semibold text-foreground">Proveedor y contacto</h2><p className="mt-2">Responsable del servicio: <strong className="text-foreground">{publicLegalDetails.name}</strong>. Domicilio: {publicLegalDetails.address}. Teléfono: <a className="font-medium text-primary underline underline-offset-4" href={`tel:${publicLegalDetails.phone.replace(/[^+\d]/g, "")}`}>{publicLegalDetails.phone}</a>. Soporte: <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${publicLegalDetails.supportEmail}`}>{publicLegalDetails.supportEmail}</a>. Privacidad y derechos ARCO: <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${publicLegalDetails.privacyEmail}`}>{publicLegalDetails.privacyEmail}</a>.</p></section>

            <Section title="1. Registro y acceso">
                <p>Debes proporcionar datos correctos, usar una dirección de correo bajo tu control y proteger la contraseña. Eres responsable de la actividad realizada desde tu cuenta y de administrar de forma segura a las personas a quienes invites. Notifícanos pronto si detectas un acceso no autorizado.</p>
                <p>El alta puede requerir verificación de correo y controles de seguridad, incluido Cloudflare Turnstile. Podemos rechazar solicitudes automatizadas, incompletas o que incumplan estos términos.</p>
            </Section>

            <Section title="2. Acceso anticipado, prueba y pagos">
                <p>Algunas cuentas pueden ofrecerse en acceso anticipado o prueba. Las funciones y disponibilidad pueden cambiar mientras el producto evoluciona. La prueba no implica una promesa de que una función concreta estará disponible indefinidamente.</p>
                <p>Antes de iniciar un plan de pago se mostrarán su precio, periodicidad, impuestos aplicables, duración de la prueba y condiciones de cobro. Los pagos podrán procesarse por el proveedor que se indique en el checkout. Durante el acceso anticipado, si el checkout lo informa, el comprobante digital emitido por la plataforma de pago no es un CFDI mexicano. No afirmamos emitir CFDI mientras esa función no esté disponible.</p>
                <p>Si se habilita una suscripción recurrente, el checkout informará el cargo y su periodicidad, y la cuenta contará con un mecanismo visible para consultar y cancelar la renovación. La cancelación evita los cargos futuros en los términos mostrados; no elimina importes ya devengados ni derechos de reembolso que resulten aplicables. Estos términos no limitan derechos irrenunciables de consumidores.</p>
            </Section>

            <Section title="3. Uso permitido y responsabilidades del negocio">
                <p>Usa la plataforma conforme a la ley, estos términos y las instrucciones de tu negocio. No intentes vulnerar controles de acceso, interferir con el servicio, enviar malware, realizar envíos masivos no autorizados ni usar datos de terceros sin una base legal válida.</p>
                <p>Tu negocio controla el contenido que captura y las comunicaciones que realiza. Te corresponde tener autorización para cargar nombres, teléfonos, correos, notas, citas, archivos y conversaciones; mantenerlos exactos y actualizados; mostrar a tus clientes tu propio aviso de privacidad; obtener consentimientos requeridos; definir quién del personal accede a cada dato; y atender sus solicitudes. No subas datos sensibles salvo que sean indispensables, cuentes con la base jurídica y consentimiento expreso que procedan, y hayas informado claramente a la persona.</p>
                <p>Al conectar WhatsApp/Meta, Google Calendar u otro servicio, también aplican los términos del proveedor correspondiente. Tú eliges y autorizas la conexión y eres responsable de las cuentas, permisos, mensajes y contenidos enviados desde tu negocio.</p>
            </Section>

            <Section title="4. Contenido y propiedad intelectual">
                <p>Conservas los derechos sobre los datos y archivos que incorporas. Nos autorizas a alojarlos, procesarlos, respaldarlos y transmitirlos a proveedores necesarios únicamente para prestarte las funciones que solicitas. Esta autorización termina cuando esos datos se eliminan, salvo copias sujetas a conservación legal o rotación de respaldos.</p>
                <p>La plataforma, su software, marca, documentación y diseño pertenecen a sus titulares y se ofrecen bajo una licencia limitada, no exclusiva, revocable y no transferible para el uso contratado. No adquieres derechos de propiedad sobre el software.</p>
            </Section>

            <Section title="5. Disponibilidad, soporte y cambios">
                <p>Trabajamos para mantener el servicio disponible y proteger la información, pero puede haber interrupciones por mantenimiento, fallas de conectividad, proveedores externos o incidentes. Informaremos cambios relevantes por la plataforma o por correo cuando sea razonablemente posible.</p>
                <p>Podemos modificar funciones o estos términos para reflejar cambios legales, de seguridad o del servicio. Publicaremos la nueva versión y fecha. Si un cambio material requiere aceptación adicional, la solicitaremos antes de aplicarlo a tu cuenta.</p>
            </Section>

            <Section title="6. Suspensión y terminación">
                <p>Puedes dejar de utilizar el servicio y solicitar el cierre de la cuenta. La ruta <Link className="font-medium text-primary underline underline-offset-4" href="/delete-account">Eliminar mi cuenta</Link> explica el proceso y sus efectos sobre espacios de negocio compartidos. Podemos restringir temporalmente el acceso ante riesgo de seguridad, falta de pago o uso ilícito, procurando comunicar la causa y ofrecer un canal para aclararla cuando la ley lo permita.</p>
                <p>Al terminar, eliminaremos los datos de acuerdo con el aviso de privacidad y los plazos de conservación aplicables. Descarga lo que necesites antes de cerrar el espacio.</p>
            </Section>

            <Section title="7. Contacto y derechos legales">
                <p>Para soporte escribe a <a className="font-medium text-primary underline underline-offset-4" href="mailto:soporte@synapselogik.com">soporte@synapselogik.com</a>. Para asuntos de privacidad: <a className="font-medium text-primary underline underline-offset-4" href="mailto:contacto@synapselogik.com">contacto@synapselogik.com</a>.</p>
                <p>Las partes se sujetan a las leyes aplicables en México y a las autoridades competentes, sin limitar los derechos que la legislación de protección al consumidor concede a las personas consumidoras. Ninguna cláusula excluye responsabilidades que legalmente no puedan excluirse.</p>
            </Section>

            <footer className="mt-10 border-t pt-5 text-sm text-muted-foreground"><Link className="font-medium text-primary hover:underline" href="/privacy">Consultar aviso de privacidad</Link><span className="px-2">·</span><Link className="font-medium text-primary hover:underline" href="/signup">Registro</Link></footer>
        </main>
    );
}
