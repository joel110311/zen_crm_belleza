# Decimotercera entrega: navegación, permisos y búsqueda

17 de octubre de 2026. Sin migraciones ni tablas nuevas. Joel redespliega esta entrega.

## Cambios

Se aplica Taste Skill, Redesign Existing Projects, conservando los temas, superficies neutras, tipografía e iconos aprobados. La búsqueda global conservaba textos en inglés, abría el listado con un parámetro que no seleccionaba al cliente y podía sustituir resultados recientes con una respuesta atrasada.

Ahora abre la ficha real dentro del negocio actual, muestra instrucciones y estados en español, distingue fallo de conexión de ausencia de resultados y permite reintentar. Descarta respuestas posteriores al cierre o a otra búsqueda. El servidor comprueba permisos de clientes antes de consultar y limita el texto a 160 caracteres. Se conserva el máximo existente de cinco coincidencias y el filtro por nombre, apellidos, teléfono, correo y empresa. Se desactiva el segundo filtro local de cmdk: antes podía ocultar coincidencias correctas por teléfono o empresa.

El diálogo conserva el campo de 16 px, resultados de al menos 44 px, nombres largos con salto de línea y una lista con desplazamiento vertical. No se añaden dependencias ni se modifican chats, facturación, modelos de datos o proveedores.

## Validación

- Compilación de producción, TypeScript y ESLint de archivos afectados correctos.
- Suite completa: **370 pruebas, 368 aprobadas, 2 omitidas, 0 fallidas**. Las dos omisiones existentes corresponden a la integración opcional del router Gemini.
- Cuatro regresiones nuevas: 50 combinaciones de permisos de menú y layouts reales de diez módulos; autorización y contrato del servidor; respuestas atrasadas/cierre y destino de ficha; fallo/reintento, búsqueda corta y ausencia de sesión.
- Navegador con base local aislada: carga de los doce destinos vigentes del menú como propietario, sin error de aplicación ni desbordamiento horizontal en la comprobación de escritorio. Esta comprobación de carga no certifica todas las operaciones internas de cada módulo.
- Usuario profesional local: los cuatro destinos restringidos Asistente IA, Mi negocio, Servicios y Especialistas redirigen a Hoy cuando se visita la URL directamente; tampoco aparecen en su menú.
- Búsqueda real de nombre y teléfono como propietario/personal, selección por teclado y apertura de la ficha correcta. No se escribieron datos de clientes ni se enviaron mensajes.
- Capturas de búsqueda a **320, 375, 390, 768, 1024 y 1440 px CSS**; sin desbordamiento horizontal. A **320 × 500**, tres nombres largos permanecen legibles y accesibles. Evidencia en `output/integral-review/` (ignorada por Git): `qa-layout.json`, `qa-modules.json`, `qa-staff.json`, capturas y registros de comprobaciones.

## Proveedores reales y límites de esta entrega

El botón de Google de producción abre el selector y el consentimiento de Zen CRM con nombre, foto y correo, sin permisos de Calendar. Tras autorización explícita de Joel se completó el consentimiento: el callback volvió al CRM con `google_account_not_ready`, explicando que la cuenta de pruebas debe registrarse y verificarse primero. Esto confirma el recorrido hasta el callback y la protección de cuentas no activas; todavía no certifica una sesión completa de una cuenta verificada ni la sincronización de Calendar.

Cloudflare Turnstile devolvió `300030` en la sesión automatizada. La [documentación de Cloudflare](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/) clasifica `300*` como fallo del desafío, asociado a detección de automatización. No se desactivó ni se eludió la verificación. Joel completó manualmente la solicitud de recuperación y el formulario mostró la respuesta genérica esperada. Esa respuesta es intencionalmente igual para cuentas existentes e inexistentes y **no demuestra entrega de correo**.

La cuenta de pruebas todavía no estaba activa cuando se comprobó Google. Se dejó preparado el registro para que Joel introduzca su contraseña, revise términos y complete CAPTCHA y verificación de correo. No se incorporan direcciones personales, tokens ni contraseñas a este documento. El envío/recepción real de verificación, recuperación e invitación, el acceso completo por Google y la prueba física de Android/Chrome e iPhone/Safari quedan sujetos a completar esos recorridos. Las pruebas de interfaz en Edge con distintos tamaños no sustituyen Safari, teclado virtual o dispositivos físicos.

## Lista de cierre

| Bloque | Estado |
| --- | --- |
| Reservas públicas y seguimiento | Entrega 11, incluida en la versión desplegada previamente |
| Invitaciones y pantallas legales | Entrega 12, incluida en la versión desplegada previamente |
| Navegación, permisos y consistencia | Revisión ejecutada; correcciones y regresiones de búsqueda en esta entrega |
| Google, correos, CAPTCHA y dispositivos | Recorrido parcial real documentado; pendientes los resultados finales indicados arriba |
| Producción | Versión previa `dca70a8` desplegada; esta entrega requiere el redespliegue habitual de Joel |

Para cerrar la validación externa: registrar/verificar la cuenta de pruebas, confirmar llegada de correo, entrar con Google, solicitar y abrir recuperación sin exponer el enlace y probar una invitación en un negocio de pruebas. Crear contraseñas, aceptar términos y conceder permisos se revisan con Joel en sus pasos respectivos. En teléfonos físicos, repetir acceso, navegación, agenda, ficha, chat, reserva pública y diálogos con teclado abierto y orientación horizontal.
