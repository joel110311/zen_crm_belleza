import type { Metadata } from "next";
import Link from "next/link";
import { publicLegalDetails } from "@/lib/public-legal-details";

export const metadata: Metadata = {
    title: "Aviso de privacidad | SynapseLogik CRM",
    description: "Aviso de privacidad de SynapseLogik CRM para cuentas, negocios y datos tratados en la plataforma.",
};

const privacyVersion = process.env.LEGAL_PRIVACY_VERSION?.trim() || "2026-09-26.2";
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="mt-8"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-muted-foreground">{children}</div></section>;
}

export default function PrivacyPage() {
    return (
        <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
            <Link href="/signup" className="text-sm font-medium text-primary hover:underline">← Volver al registro</Link>
            <header className="mt-7 border-b pb-6">
                <p className="text-sm font-medium text-primary">SynapseLogik CRM</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Aviso de privacidad integral</h1>
                <p className="mt-3 text-sm text-muted-foreground">Última actualización: 26 de septiembre de 2026 · Versión {privacyVersion}</p>
            </header>

            <p className="mt-6 text-sm leading-7 text-muted-foreground">Este aviso explica cómo se tratan los datos personales cuando una persona crea una cuenta, usa el sitio o contrata y administra un espacio de negocio en SynapseLogik CRM. También describe qué ocurre con los datos de clientes que el negocio carga en su propio espacio.</p>

            <Section title="1. Responsable y contacto">
                <p>El responsable del tratamiento para la cuenta, facturación, seguridad y operación general de la plataforma es <strong className="text-foreground">{publicLegalDetails.name}</strong>, con domicilio en <strong className="text-foreground">{publicLegalDetails.address}</strong>.</p>
                <p>Teléfono de contacto: <strong className="text-foreground">{publicLegalDetails.phone}</strong>. Para dudas de privacidad o solicitudes de derechos ARCO, escribe a <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${publicLegalDetails.privacyEmail}`}>{publicLegalDetails.privacyEmail}</a>. El canal general de soporte es <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${publicLegalDetails.supportEmail}`}>{publicLegalDetails.supportEmail}</a>.</p>
            </Section>

            <Section title="2. Datos que podemos tratar">
                <ul className="list-disc space-y-2 pl-5">
                    <li>Datos de la cuenta: nombre, correo, credenciales protegidas, nombre y configuración del negocio, zona horaria y preferencias.</li>
                    <li>Datos de uso y seguridad: dirección IP o su huella criptográfica, identificadores de sesión o de intentos de registro, navegador, registros técnicos y resultados de verificación antiautomatización de Cloudflare Turnstile.</li>
                    <li>Datos que el negocio decide guardar: nombres, teléfonos, correos, citas, servicios, notas, personal, conversaciones y archivos de sus clientes. El contenido depende de cómo configure y use el CRM.</li>
                    <li>Datos de pagos y suscripciones, como plan, estado, importes, identificadores de la transacción y comprobantes del proveedor de pago. SynapseLogik CRM no recibe ni almacena directamente el número completo de tarjeta cuando el pago se realiza en la página alojada del proveedor.</li>
                    <li>Datos de integraciones que el negocio conecte, por ejemplo WhatsApp/Meta, Google Calendar o servicios de inteligencia artificial habilitados por el propio negocio.</li>
                </ul>
                <p>No solicitamos deliberadamente datos personales sensibles para el registro. El negocio debe evitar guardar en notas o expedientes información sensible —por ejemplo, datos de salud— salvo que tenga una finalidad legítima, base jurídica y consentimiento expreso cuando la ley lo requiera.</p>
            </Section>

            <Section title="3. Finalidades">
                <p>Las finalidades necesarias son: crear y administrar cuentas y espacios de negocio; prestar las funciones del CRM; autenticar usuarios y enviar enlaces de verificación; atender solicitudes de soporte; operar integraciones solicitadas por el negocio; procesar pruebas, planes y pagos; prevenir abuso, fraude y registros automatizados; proteger la plataforma; mantener respaldos y registros; y cumplir obligaciones legales.</p>
                <p>Los avisos sobre cambios del servicio, seguridad, cuenta o pago son comunicaciones operativas. No usamos los datos de registro para enviar publicidad promocional no relacionada con el servicio. Si en el futuro ofrecemos comunicaciones de marketing, solicitaremos una elección separada y ofreceremos un medio sencillo para dejar de recibirlas.</p>
            </Section>

            <Section title="4. Datos de clientes cargados por cada negocio">
                <p>En los datos de clientes que una empresa usuaria incorpora a su espacio, normalmente esa empresa decide para qué y cómo se usan; por ello, generalmente actúa como responsable y SynapseLogik CRM los trata siguiendo sus instrucciones para alojar y operar el servicio. La empresa usuaria debe contar con su propio aviso de privacidad, informar a sus clientes, obtener los consentimientos necesarios y atender sus derechos. SynapseLogik podrá actuar como responsable cuando trate datos para sus propios fines de seguridad, soporte o cumplimiento legal.</p>
                <p>Los datos de un negocio se mantienen separados de los demás espacios mediante controles de acceso. El personal de soporte sólo debe acceder a ellos cuando sea necesario para prestar asistencia, mantener el servicio o atender un incidente autorizado.</p>
            </Section>

            <Section title="5. Encargados, integraciones y transferencias">
                <p>Para operar el servicio podemos apoyarnos en proveedores de infraestructura y almacenamiento, envío de correo, protección antiautomatización, pagos, mensajería y calendarios. La integración y el proveedor concreto dependen de las funciones que el negocio active. Estos proveedores reciben sólo los datos necesarios para su función y deben tratarlos conforme a sus propias condiciones y a las instrucciones aplicables.</p>
                <p>Cloudflare Turnstile recibe información técnica del navegador y de la solicitud para detectar automatizaciones; el registro se rechaza si la verificación del servidor falla. Los conectores de WhatsApp/Meta, Google, Stripe o Mercado Pago y los proveedores de IA sólo intervienen cuando la función correspondiente está configurada o se realiza una operación con ellos. Es posible que algunos proveedores procesen datos fuera de México. No vendemos datos personales.</p>
                <p>Cuando una transferencia distinta de la prestación por un encargado requiera consentimiento, se solicitará conforme a la ley. También podremos comunicar datos cuando una autoridad competente lo requiera legalmente.</p>
            </Section>

            <Section title="6. Conservación y eliminación">
                <p>Conservamos los datos mientras la cuenta y el espacio estén activos y durante el tiempo adicional necesario para atender obligaciones legales, disputas, seguridad y respaldos. Los datos sujetos a una obligación de conservación pueden permanecer bloqueados y sin otros usos hasta que venza el plazo aplicable.</p>
                <p>Para solicitar la eliminación definitiva de tu cuenta, puedes usar <Link className="font-medium text-primary underline underline-offset-4" href="/delete-account">Eliminar mi cuenta</Link>. Como medida limitada contra el uso repetido de promociones de prueba, se conserva una huella criptográfica no reversible del correo asociado a la prueba. No sirve para recuperar el correo original ni se usa para publicidad.</p>
            </Section>

            <Section title="7. Derechos ARCO, revocación y límites">
                <p>Puedes solicitar acceso, rectificación, cancelación u oposición, así como revocar consentimientos o limitar el uso o divulgación cuando proceda, escribiendo a contacto@synapselogik.com con el asunto “Privacidad / derechos ARCO”. Incluye tu nombre, el correo de tu cuenta, el derecho que deseas ejercer y una descripción que permita localizar los datos. Si hace falta verificar identidad o representación, te pediremos información adicional razonable por un canal seguro.</p>
                <p>Responderemos dentro de los plazos previstos por la legislación aplicable. La cancelación puede estar sujeta a obligaciones legales, respaldos en rotación o responsabilidades pendientes; cuando corresponda, bloquearemos los datos antes de su supresión. Si los datos están dentro del CRM de una empresa usuaria, dirige primero la solicitud a esa empresa, que es quien administra ese espacio y la relación con sus clientes.</p>
            </Section>

            <Section title="8. Seguridad y cambios a este aviso">
                <p>Aplicamos controles técnicos y organizativos para reducir riesgos de acceso, pérdida, alteración o divulgación no autorizados. Ningún servicio conectado a Internet puede garantizar riesgo cero. Si cambiamos este aviso, publicaremos aquí la nueva versión y fecha; si el cambio afecta de forma relevante los fines o condiciones del tratamiento, usaremos los medios de contacto disponibles.</p>
            </Section>

            <footer className="mt-10 border-t pt-5 text-sm text-muted-foreground"><Link className="font-medium text-primary hover:underline" href="/terms">Consultar términos de servicio</Link><span className="px-2">·</span><Link className="font-medium text-primary hover:underline" href="/signup">Registro</Link></footer>
        </main>
    );
}
