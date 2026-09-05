# Redes del portal y revisión de eliminación de cuenta

Revisión: 5 de septiembre de 2026. Cambios locales, pendientes de despliegue.

## Redes sociales

Mi Negocio → Portal permite guardar Instagram, TikTok, página de Facebook, YouTube, LinkedIn, X, sitio web y otro enlace. Cada uno tiene una casilla de visibilidad. Guardar portal aplica los cambios. Desmarcar conserva el enlace en configuración, pero lo excluye de los datos públicos. Los enlaces solo admiten HTTP/HTTPS sin credenciales y se abren en otra pestaña.

La columna nullable `SystemSettings.portalSocialLinks` almacena la lista por base de negocio. Los negocios existentes empiezan sin enlaces públicos. No requiere seed ni borra datos.

Antes de arrancar una imagen con este cambio, aplicar `20260905120000_portal_social_links` en **cada base tenant existente** mediante el procedimiento de migraciones del provisionador: `node scripts/migrate-tenant.mjs` con `DATABASE_URL` de esa base y las credenciales de migración. Los nuevos negocios la reciben al provisionarse. El servidor web no migra las bases al arrancar. Para la instalación legacy existe la misma migración aditiva en `prisma/migrations`; aplicar su procedimiento habitual. No basta redesplegar únicamente el servicio web.

Prueba de validación y filtrado: `node scripts/test-portal-social-links.mjs`.

## Eliminación de cuenta: estado real

`src/app/actions/users.ts`, función `deleteUser`, impide borrar la propia cuenta. En modo multitenant impide borrar al propietario y solo pone `TenantMembership.isActive=false` para los demás usuarios. No borra la identidad global, bases, archivos ni datos de integraciones. No se encontró un flujo de autoeliminación completo. La acción legacy borra un usuario local, pero no resuelve la baja del SaaS.

Esta revisión no ejecuta bajas ni implementa borrados automáticos.

## Requisitos y trabajo pendiente

- Apple: las apps con creación de cuentas deben permitir iniciar la eliminación desde la app. Desactivar no sustituye eliminar. Borrar datos asociados salvo retenciones legalmente necesarias y revocar tokens de Sign in with Apple si se incorpora. Fuente: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play: requiere un camino dentro de la app y un recurso web funcional para solicitar eliminación de cuenta y datos; describir las retenciones justificadas. Fuente: https://support.google.com/googleplay/android-developer/answer/13327111?hl=es
- Meta: pendiente de confirmar el requisito exacto para los productos y permisos de la aplicación conectada. La documentación oficial de callbacks devolvió HTTP 429 durante esta revisión; no se certifica cumplimiento. Referencia: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/

Implementación necesaria antes de declarar lista la eliminación:

1. Separar cerrar la cuenta personal de cerrar un negocio. Si el propietario conserva el negocio, transferir propiedad; si lo cierra, explicar qué afecta al equipo y clientes. Considerar usuarios con varios negocios.
2. Añadir entrada visible en Configuración y página pública de solicitudes, verificación reciente de identidad y confirmación explícita.
3. Registrar y procesar la solicitud de forma idempotente: revocar sesiones y tokens, cancelar suscripciones/cobros futuros, detener mensajes y trabajos pendientes, retirar portal e integraciones.
4. Borrar o anonimizar identidad, referencias locales, datos asociados y archivos según el alcance confirmado. Conservar únicamente datos con fundamento y plazo documentados; establecer caducidad de backups y evitar reactivar datos borrados al restaurar.
5. Confirmar la finalización y probar que la cuenta ya no inicia sesión, que otros negocios no se afectan y que un fallo puede reintentarse sin dejar una baja parcial.
6. Configurar los enlaces reales en las tiendas y el mecanismo requerido por Meta, y probarlos una vez desplegados.
