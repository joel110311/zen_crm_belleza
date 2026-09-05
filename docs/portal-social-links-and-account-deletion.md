# Redes del portal y revisión de eliminación de cuenta

Revisión: 5 de septiembre de 2026. Cambios locales, pendientes de despliegue.

## Redes sociales

Mi Negocio → Portal permite guardar Instagram, TikTok, página de Facebook, YouTube, LinkedIn, X, sitio web y otro enlace. Cada uno tiene una casilla de visibilidad. Guardar portal aplica los cambios. Desmarcar conserva el enlace en configuración, pero lo excluye de los datos públicos. Los enlaces solo admiten HTTP/HTTPS sin credenciales y se abren en otra pestaña.

La columna nullable `SystemSettings.portalSocialLinks` almacena la lista por base de negocio. Los negocios existentes empiezan sin enlaces públicos. No requiere seed ni borra datos.

Antes de arrancar una imagen con este cambio, aplicar `20260905120000_portal_social_links` en **cada base tenant existente** mediante el procedimiento de migraciones del provisionador: `node scripts/migrate-tenant.mjs` con `DATABASE_URL` de esa base y las credenciales de migración. Los nuevos negocios la reciben al provisionarse. El servidor web no migra las bases al arrancar. Para la instalación legacy existe la misma migración aditiva en `prisma/migrations`; aplicar su procedimiento habitual. No basta redesplegar únicamente el servicio web.

Prueba de validación y filtrado: `node scripts/test-portal-social-links.mjs`.

## Eliminación definitiva de cuenta

La ruta pública `/delete-account`, enlazada desde Configuración y el aviso de privacidad, implementa la baja del SaaS. Exige sesión de control, contraseña actual y la frase exacta `ELIMINAR MI CUENTA`. Si la persona es la única propietaria de un negocio, debe transferirlo a otra cuenta activa o cerrar también el negocio. La confirmación revoca inmediatamente contraseña, sesiones, membresías y trabajos futuros de los negocios cerrados.

La limpieza destructiva no ocurre en la petición web. `belleza-account-deletion-worker` procesa un registro idempotente bajo un advisory lock y reintenta fallos transitorios. Para un negocio cerrado cancela suscripciones, desconecta canales, revoca Google Calendar, retira objetos privados y archivos locales, elimina su base y roles PostgreSQL y finalmente borra el registro del control plane. En negocios que continúan, anonimiza la proyección local de la persona y desconecta Google si fue conectado con el mismo correo. Por último borra identidad, invitaciones, dispositivos, registros de correo y evidencia personal del control plane.

El navegador genera un comprobante aleatorio que permanece únicamente en el fragmento `#` del enlace. El servidor guarda solo su SHA-256; al finalizar conserva el comprobante anónimo y fechas, sin `userId`, correo ni nombre. Los comprobantes fiscales que un proveedor de pago deba retener no se recrean dentro del CRM.

### Despliegue

1. La imagen debe contener `scripts/account-deletion-worker.mjs` y `@aws-sdk/client-s3`.
2. `belleza-tenant-provisioner` ejecuta primero `migrate-control-plane.mjs`, que aplica `20260905160000_account_deletion`. Confirmar que el provisionador está sano antes de probar el formulario.
3. El stack crea `belleza-account-deletion-worker` con la URL administrativa de PostgreSQL, claves de canales/Google, credenciales de almacenamiento y, cuando correspondan, Stripe o Paddle. El servicio web no recibe la URL administrativa.
4. Mantener montado `belleza_crm_uploads` en `/app/public/uploads` tanto en web como en este worker. Nunca apuntar `TENANT_DELETION_UPLOADS_DIR` a una ruta amplia.
5. Probar con una cuenta y negocio desechables: acceso revocado al confirmar, estado `COMPLETED`, base `zencrm_t_<id>` inexistente, prefijo de almacenamiento vacío y ningún cambio en otro negocio.

### Alcance de tiendas e integraciones

- Apple: las apps con creación de cuentas deben permitir iniciar la eliminación desde la app. Desactivar no sustituye eliminar. Borrar datos asociados salvo retenciones legalmente necesarias y revocar tokens de Sign in with Apple si se incorpora. Fuente: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play: requiere un camino dentro de la app y un recurso web funcional para solicitar eliminación de cuenta y datos; describir las retenciones justificadas. Fuente: https://support.google.com/googleplay/android-developer/answer/13327111?hl=es
- Meta: la conexión de WhatsApp del CRM no se usa como inicio de sesión de la cuenta. Al cerrar un negocio se elimina la credencial y la ruta de webhook; las conexiones legacy con WABA conocido también cancelan `subscribed_apps`. Si en el futuro se añade Facebook Login, habrá que configurar además el callback de eliminación de Meta y validarlo en el panel de la aplicación. Referencia: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/

Las copias de respaldo requieren una política operativa de caducidad y restauraciones que vuelvan a aplicar los comprobantes de baja. Esta implementación elimina datos activos; no afirma borrar instantáneamente copias administradas fuera de la aplicación.
