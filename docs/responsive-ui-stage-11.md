# Undécima entrega: reservas públicas y seguimiento

15 de octubre de 2026. Sin migraciones ni tablas nuevas; Joel redespliega.

## Diseño y alcance

Se aplica Taste Skill, Redesign Existing Projects. La auditoría encontró servicios, calendario, resumen y datos de contacto compitiendo en una pantalla larga. Se organiza la reserva en Servicio → Horario → Tus datos, con resumen lateral en escritorio y resumen desplegable en celular. Se conservan fuente, iconos, escala del logotipo configurada y color del negocio; calendario y acciones comparten el mismo acento. Se añaden etiquetas persistentes, foco visible, campos de 16 px y acciones táctiles.

El seguimiento público y la confirmación clásica comparten una presentación legible. Cancelar exige revisar la intención en línea; Conservar cita no envía cambios. Un error conserva los detalles y permite reintentar. Disponibilidad distingue fallo de conexión y día sin horarios, y descarta respuestas tardías de otra fecha. La reserva evita bloqueos duplicados y reutiliza la clave de idempotencia tras una respuesta interrumpida.

## Contratos conservados

Se mantienen los endpoints y acciones de disponibilidad, bloqueo, reserva y cancelación, los permisos, validaciones, precios visibles, profesionales, duración y recordatorios existentes. El contrato público de consulta añade únicamente campos públicos de marca y zona horaria ya disponibles en configuración. No cambia el modelo de datos ni se alteran proveedores, procesos de mensajes o facturación.

## Verificación

- Build de producción, TypeScript, ESLint de archivos afectados y diff correctos.
- Comprobación conjunta final: **329 aprobadas, 2 omitidas, 0 fallidas**, de 331 pruebas. Ocho regresiones nuevas de reservas cubren errores y reintentos, respuesta tardía, bloqueo único, conservación del contacto/idempotencia, revisión de cancelación, compatibilidad clásica, portal deshabilitado y marca/contraste.
- 60 combinaciones de 10 vistas/estados por anchos CSS efectivos **320, 375, 390, 768, 1024 y 1440**. Sin desbordamientos detectados, botones de al menos 44 px y campos de 16 px. Se guardan capturas por ancho y `qa-layout-final.json` en `output/responsive-ui-stage-11`.
- Reserva ficticia creada en la base local dedicada, consultada, conservada durante la revisión y luego cancelada. La cancelación persiste tras recargar. La confirmación clásica se consulta y revisa sin ejecutar una cancelación real; su acción se prueba con I/O simulado.
- A **320 × 500**, la acción de envío y las dos acciones de cancelación siguen alcanzables mediante desplazamiento; evidencia `contact-low-height-final.png`, `qa-contact-low-height.json` y `cancel-low-height.png`.

`scripts/setup-responsive-portal-local.mjs` prepara únicamente las bases locales dedicadas, rechaza producción y URLs distintas, y no contacta proveedores. Se usan datos ficticios; no se enviaron correos ni WhatsApp ni se modificó producción. La revisión con ventanas de navegador no sustituye teléfonos físicos Android/Chrome e iPhone/Safari. No se declara garantía del 100% de futuras ejecuciones.

Siguiente entrega: invitaciones y páginas legales; después, revisión integral de módulos vigentes.
