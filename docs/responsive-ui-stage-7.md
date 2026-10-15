# Séptima entrega: Recepción

Fecha: 15 de octubre de 2026. Implementada en la web actual. No requiere migraciones ni tablas nuevas. Joel realiza el redespliegue.

## Alcance y resultado

Pipeline sigue retirado por decisión de Joel. Se eliminó del alcance pendiente del rediseño y se documentó esta preferencia en AGENTS.md; no se cambió su redirección ni se agregó una entrada al menú. Una prueba protege su exclusión de la navegación.

- Recepción conserva sus datos, estados y acciones del servidor. Se elimina el encabezado global duplicado y se mantiene el color del negocio.
- Navegación por fecha con anterior/siguiente/Hoy y selector. Se conserva la fecha en la URL del negocio y se respeta su zona horaria. Una respuesta anterior de carga no sustituye una petición posterior.
- Resumen compacto: agendadas, en espera, en atención y completadas. Cada indicador filtra la lista. Búsqueda por cliente, servicio, teléfono y especialista, tolerante a acentos; filtros por estado/especialista y restablecimiento explícito.
- En móvil, los filtros secundarios se despliegan bajo Filtros. En escritorio permanecen visibles. La lista muestra nombres completos, servicio, especialista, duración, estados y recordatorios sin cortar los títulos esenciales.
- Acción principal por cita: confirmar → en espera → iniciar → finalizar. Las acciones restantes se conservan en Más acciones, incluyendo ausente y notificación manual; finalizar solicita confirmación. Las opciones originales de cambio de estado siguen disponibles, incluso para corregir estados ya marcados.
- Notificar prepara el borrador existente en Chats, conservando la ruta del negocio. El envío sigue siendo una acción separada del usuario. Se conserva el bloqueo de notificación manual después del inicio o cierre de la cita.
- Recordatorios: fecha/estado, contadores, errores, intentos y reintento existente. Todo el cuerpo se desplaza; encabezado y cierre quedan accesibles en ventanas de poca altura.
- Cargas fallidas muestran error y opción de reintento; los datos de otra carga no quedan presentados como resultado de la fecha actual. Los indicadores muestran — cuando los datos no están disponibles.
- Cuenta vencida: consulta y filtros disponibles; cambios de estado, finalización, notificación y reenvío bloqueados en la interfaz. Las validaciones del servidor no se modifican.
- El aviso flotante de clientes en espera se omite también en la ruta de Recepción del negocio; evita duplicar el aviso sobre el módulo que ya muestra la espera.

## Verificación

Compilación de producción y TypeScript correctos; ESLint de los archivos afectados y git diff --check sin errores. Suite: **304 pruebas aprobadas, 2 omitidas y 0 fallidas** (306 en total).

Revisión en Edge con anchos CSS efectivos de **320, 375, 390, 768, 1024 y 1440 px**: lista, filtros, acciones adicionales, finalización y recordatorios. También **320 × 500 y 390 × 320** para comprobar desplazamiento y acciones al pie. Sin desbordamientos horizontales detectados. Capturas en `output/responsive-ui-stage-7/`; el registro `qa-layout.json` conserva las mediciones de la última sesión de revisión. La geometría no equivale a una auditoría de accesibilidad ni cubre todos los datos posibles.

Recorridos con datos ficticios en las bases dedicadas de localhost:5446:

| Recorrido | Resultado observado |
|---|---|
| Buscar coloracion sin acento | Recupera las citas de Coloración y su tratamiento asociado |
| Filtrar espera y especialista | Muestra los registros correspondientes; limpiar recupera la lista |
| Confirmar → espera → iniciar → cancelar cierre → finalizar | Estado y acción principal actualizados; cancelar conserva En atención |
| Marcar ausente desde Más acciones | Estado actualizado en la lista |
| Dos cambios rápidos de día → Hoy | Fecha y resultados corresponden al último día elegido; vacío legible cuando no hay citas |
| Notificar una cita futura | Abre el borrador correcto en Chats del mismo negocio; no se envió el mensaje |
| Filtrar enviados y con atención | Recupera los recordatorios de cada estado, incluido texto largo de error |
| Cuenta vencida | Consulta disponible; acción principal y reintento de recordatorio deshabilitados |
| Interrupción de conexión de la base local → reintentar | Error visible en agenda/recordatorios y recuperación de ambas listas al restablecer la conexión |

`scripts/setup-responsive-reception-local.mjs` crea datos de demostración únicamente si ambas URLs coinciden con las bases dedicadas de localhost:5446 y NODE_ENV no es production. No hace migraciones ni llamadas externas. Los fixtures usan recordatorios desactivados para las citas de prueba; sus estados de ejemplo sirven para revisar la presentación. El entorno se deja con la prueba activa.

## Límites y siguiente bloque

No se enviaron ni reenviaron mensajes reales a WhatsApp; el canal local no está conectado. No se abrió una reunión de Meet ni se comprobaron integraciones externas en esta entrega. Pendiente la revisión en teléfonos físicos Android/Chrome e iPhone/Safari, con teclado, gestos y áreas seguras.

Siguiente bloque: **reportes y Plan/facturación**, después configuración, accesos, pantallas públicas y revisión integral. Pipeline permanece fuera del producto.
