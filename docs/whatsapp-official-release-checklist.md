# WhatsApp oficial y contactos separados por canal

## Cambios de esta entrega

- Un teléfono puede tener un contacto `wuzapi` y otro `meta`. No se fusionan entre canales.
- La migración conserva contactos API-only y QR-only, y copia el perfil cuando había un contacto compartido. Reenlaza sus conversaciones API y los destinatarios de campaña correspondientes; no borra mensajes ni copia citas o pagos.
- Clientes muestra el canal. Importación de historial QR, CSV, portal y apertura de chats respetan la identidad del canal.
- Plantillas, campañas y recordatorios usan el token cifrado del negocio y el número oficial correcto. El WABA queda asociado a la conexión, no a credenciales globales.
- Solo un mensaje del cliente abre la ventana de servicio. Plantillas salientes no la abren; webhooks tardíos no la reabren ni acortan una ventana más reciente.
- Envíos manuales y del bot comprueban ventana y confirmación nativa del proveedor.
- Estados tardíos no rebajan leído/entregado. Recibos y reacciones sin mensaje persistido se reintentan por la cola durable, con límite de intentos y dead letter.
- Archivos locales enviados por API se validan con los formatos/límites de Meta. OGG requiere Opus mono; los formatos adicionales de QR siguen disponibles en QR.
- Embedded Signup v4 permite elegir coexistencia o número exclusivo para API. Valida la pertenencia del número al WABA y confirma la suscripción. Solo el número exclusivo necesita PIN y `/register`; coexistencia confirma `is_on_biz_app` y `platform_type` y **no registra ni borra la cuenta del celular**.
- La finalización de coexistencia puede contener solo WABA ID. El servidor resuelve exactamente un número autorizado; si hay varios no adivina. El modo forma parte del estado firmado, con caducidad y uso único por tenant/usuario.
- Se solicitan `smb_app_state_sync` e `history` después de conectar. Cada solicitud tiene una reserva atómica persistente y un `request_id`; un error incierto no provoca repeticiones de un proceso de un solo uso. La API puede estar conectada aunque la sincronización falle: se muestra la advertencia por separado.
- Los ecos `smb_message_echoes` se guardan como humanos y pausan el bot del chat API. No se reenvían ni activan IA, no crean chat QR y no abren la ventana de servicio API.
- El historial se procesa por lotes, conserva fechas/dirección y marca mensajes históricos como ya procesados por el bot. Los archivos históricos suplementarios completan el mensaje original, sin duplicarlo ni resucitar mensajes revocados. Importar historial no abre la ventana ni responde al pasado.
- La sincronización de contactos afecta solo al perfil API. Eliminar una entrada de la agenda del celular no borra el contacto CRM, citas, pagos ni conversaciones. Cambios tardíos no reemplazan cambios más recientes.
- Ediciones, revocaciones, reacciones y avisos de desconexión se enlazan al número oficial y tenant correctos. No se reemplaza el webhook de otro número asociado a ese WABA.

## Configuración Meta revisada el 8 de octubre de 2026

- App `synapselogik agencia`, ID `2371760523311360`, activa; permisos avanzados de `whatsapp_business_messaging` y `whatsapp_business_management` comprobados en la interfaz. Configuración Embedded Signup `1389820886330747` (v4).
- Suscripciones verificadas: `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes` y `message_template_status_update`, en v25.0.
- `account_update` no estaba suscrito y se activó en **v25.0 con aprobación explícita del propietario**. Se verificó el estado “Suscritos”, conservando la URL compartida y los demás eventos. No activar el distinto evento `message_echoes` como sustituto de `smb_message_echoes`.
- No cambiar la URL global compartida de la app: apunta a otro CRM. Esta aplicación multitenant suscribe el WABA con `override_callback_uri` y token de ruta específico, mediante `/api/webhooks/tenant/meta/[routeToken]`.
- Tech Provider usa el token empresarial del cliente y su facturación con Meta. Aprobar permisos no garantiza que todos los números sean elegibles para coexistencia: lo determina Meta durante el registro.
- El único cambio externo fue esa suscripción autorizada. No se aplicaron migraciones en producción, no se reconectó ningún número ni se realizaron envíos reales.

## Despliegue (no ejecutado por estas pruebas)

1. Obtener respaldo verificable de control plane y bases tenant antes de aplicar migraciones. Las bases contienen datos de clientes; no probar migraciones directamente en producción.
2. Con la nueva imagen, ejecutar `node migrate-control-plane.mjs` en el entorno administrativo del provisioner. Este script aplica las migraciones de WABA/coexistencia y migra los tenants existentes cuando tiene `TENANT_POSTGRES_ADMIN_URL`.
3. Confirmar `20261008000000_meta_waba_identity` y `20261008001000_meta_coexistence` en control plane, y `20261008000000_contacts_by_channel` y `20261008001000_meta_contact_sync` en cada base tenant antes de arrancar el web/worker nuevo. Para una instalación legacy, ejecutar `node migrate-legacy.mjs` contra su base usando el rol administrativo, no el runtime web. Las migraciones agregan columnas sin borrar filas.
4. Actualizar web, tenant-worker y provisioner al mismo commit. No dejar clientes Prisma nuevos sirviendo bases sin la nueva columna.
5. Conexiones oficiales anteriores sin `wabaId` muestran “Volver a conectar oficialmente”. El propietario debe reconectarlas para administrar plantillas. En coexistencia debe seleccionar mantener la cuenta del celular y decidir en Meta si comparte historial. No pedir PIN ni borrar/recrear su cuenta; para un número exclusivo de API el PIN es el de verificación en dos pasos, no el código SMS.
6. Completar las suscripciones de app requeridas antes de iniciar el registro. Solicitar contactos/historial dentro del plazo de 24 horas de Meta y mantener la app del celular abierta. Una reconexión no garantiza una nueva sincronización; no automatizar offboarding ni solicitudes repetidas para forzarla.

## Aceptación real pendiente

Las pruebas locales simulan Graph API y prueban SQL en PostgreSQL embebido. No prueban entrega real ni permisos/configuración de una cuenta Meta.

- Usar un negocio y un destinatario de prueba autorizados, con método de pago de Meta y plantilla aprobada.
- Enviar plantilla con ventana cerrada: el CRM debe seguir bloqueando texto libre hasta que responda el destinatario.
- Responder desde el teléfono y comprobar que aparecen el contacto y chat API, sin alterar sus equivalentes QR.
- Probar texto/emoji, imagen, video MP4, MP3, nota OGG Opus y PDF en ambas direcciones; reproducir/descargar archivos y confirmar recepción en WhatsApp, no solo en el CRM.
- Probar reacción y eliminación de reacción, recibos enviado/entregado/leído y repetición de webhook.
- Confirmar que un recibo tardío no cambia “Leído” a “Enviado” y que no quedan eventos en dead letter.
- Probar campañas/CSV/recordatorio en el canal seleccionado. API no debe usar los contactos QR como si fueran los mismos registros.
- Probar negocio distinto: no debe poder usar token, número, archivo ni historial de otro tenant.
- Conectar un número WhatsApp Business elegible mediante coexistencia, sin eliminar su cuenta. Comprobar que la cuenta del celular permanece utilizable; Meta puede desvincular dispositivos adicionales que deberán volver a enlazarse.
- Enviar desde el celular y comprobar eco humano, pausa del bot y chat API existente. El contacto/chat QR de ese teléfono debe permanecer independiente. Un eco de un mensaje ya reconocido como bot no debe convertirse en humano.
- Autorizar historial/contactos y comprobar progreso, fechas, dirección, archivos y ausencia de respuestas del bot al historial. El progreso recibido no prueba que todos los lotes hayan terminado: revisar también la cola durable y dead letter.
- Rechazar historial: el error Meta `2593109` se presenta como decisión del negocio; la API debe seguir conectada.
- Editar y eliminar mensajes desde el celular; reintentar eventos y recibir un archivo histórico tarde. Un mensaje eliminado no debe reaparecer.
- Quitar la conexión desde WhatsApp Business: `account_update` debe marcar la conexión desconectada y detener envíos API. No volver a activarla solo por un webhook ambiguo.
- El escalamiento a humano por API pausa el bot en el CRM; no envía una alerta libre al teléfono del personal usando indebidamente la ventana del cliente.

Limitaciones explícitas: el borrado de un mensaje API en el CRM no lo revoca en WhatsApp. Recibir stickers, contactos y ubicaciones no implica contar con un compositor para enviarlos. El flujo legacy procesa webhooks directamente; la cola durable por tenant corresponde al flujo multitenant. La validación local no acredita entrega real, elegibilidad de un número ni una importación completa de datos reales.

Referencias primarias: [medios de Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3), [registro del número](https://www.postman.com/meta/whatsapp-business-platform/request/zb2u18b/register-phone).

Coexistencia y Embedded Signup: [visión general oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview), [registro de usuarios de WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

## Cambio de UI de Meta confirmado el 9 de octubre de 2026

- La guía [flujo predeterminado v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow/) (actualizada el 3 de septiembre) indica que primero se ingresa el número. Si coexistencia está activada y el número pertenece a WhatsApp Business, Meta detecta la cuenta y entra al flujo automáticamente: ya no se requiere una opción separada de “usar la app existente”. “Crea uno nuevo” puede ser el formulario de captura, no la exigencia de comprar otro número. No elegir el número virtual ni borrar la cuenta para forzar la conexión.
- La [guía v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/) y [versiones](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions) establecen la versión por los productos de la configuración de Login for Business. No intentar forzarla con `extras.version="v4"`; conservar `featureType=whatsapp_business_app_onboarding` para coexistencia.
- La ventana productiva observada usaba app `2371760523311360`, configuración `1389820886330747`, Graph v26 y el selector de coexistencia correcto. Se comprobó que los dos permisos WhatsApp tienen acceso avanzado concedido. No se modificaron permisos, tokens ni el webhook compartido con otros CRMs.
- El cliente multitenant espera hasta el límite de la ceremonia firmada de diez minutos (menos margen), no solo tres; el servidor conserva caducidad y uso único. El panel legacy conserva el modo solicitado aunque v4 devuelva un evento genérico `FINISH`; la API verifica `is_on_biz_app`/`platform_type` antes de confirmar coexistencia.
- La conexión real queda pendiente de que el propietario capture su número y confirme el perfil/QR/condiciones en Meta. Inspeccionar el formulario no conecta ningún número ni acredita una sincronización real completa.
