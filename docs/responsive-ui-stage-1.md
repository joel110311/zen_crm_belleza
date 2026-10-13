# Primera entrega del rediseño adaptable

Inicio autorizado el 13 de octubre de 2026. Diseño aprobado a partir del prototipo local. Esta entrega inicia la auditoría y la base compartida; no completa el rediseño de todos los módulos.

## Alcance implementado

- Navegación móvil: Hoy, Agenda, Chats, Clientes y Más. El menú completo usa un diálogo con foco controlado, cierre con Escape, contenido desplazable y opciones filtradas por permisos. Facturación sólo se muestra al propietario; el centro de mando sigue reservado al administrador de plataforma.
- Escritorio: menú lateral desplegado con nombres, opción de plegar, marca del negocio y acceso a la cuenta. Se conserva el buscador existente.
- Contenedor: altura dinámica de la ventana, espacio reservado para navegación y área segura inferior; la barra se oculta al detectar el teclado en navegadores que informan el cambio de altura mediante `visualViewport`.
- Hoy: una sola composición para móvil, tableta y escritorio. Incluye citas de hoy, confirmaciones pendientes de hoy, próximas citas, equipo, actividad mensual, Asistente IA y consumo real del chatbot. No se incluyen cifras financieras simuladas.
- Próxima cita y siguientes citas abren el calendario existente. Nueva cita abre directamente su formulario. Se corrigió la marca de inicialización del enlace para que la limpieza de un efecto no cancele la apertura definitiva.
- Búsqueda, filtros, acciones de citas y calendario mensual permanecen disponibles en secciones expandibles. Los parámetros de búsqueda abren la sección correspondiente. Los nuevos enlaces y formularios de inicio mantienen la ruta del negocio.
- En una cuenta vencida, Hoy oculta crear citas, acciones de escritura y el interruptor del autopiloto; ofrece seleccionar un plan al propietario. La autorización definitiva continúa en el servidor.
- Se eliminó la consulta adicional de próxima cita por cada fila, cuyo resultado ya no se utilizaba en la vista. El contador pendiente se obtiene de la base existente, sin tablas nuevas.

## Inventario inicial y siguientes entregas

| Área / rutas | Estado de esta entrega | Trabajo siguiente |
|---|---|---|
| `/dashboard`, `/t/[tenantSlug]/dashboard` | Inicio unificado y conectado a datos reales | Afinar con uso del negocio y datos extensos |
| Shell compartido de `/dashboard/*` y `/t/[tenantSlug]/*` | Navegación, dimensiones y permisos | Revisar cada módulo al sustituir su contenido |
| Agenda y formulario de cita | Se conserva la implementación; funcionan los accesos directos desde Hoy | Vista móvil por día/lista, formulario por pasos, conflictos y revisión |
| Clientes y ficha | Se conserva; comprobado el acceso con la nueva navegación | Lista móvil, ficha y acciones progresivas |
| Chats y mensajes | Se conserva; comprobado el acceso con la nueva navegación | Lista/conversación/detalle y teclado en teléfonos reales |
| Asistente IA / FAQs | Se conserva configuración y entrenamiento; resumen y consumo en Hoy | Reorganización de secciones y editor móvil |
| Recepción, negocio, servicios, especialistas y plantillas | Accesibles desde el menú según permiso | Adaptación específica de cada tarea |
| Pipeline y reportes | Rutas existentes inventariadas; sin cambios de contenido ni nuevas entradas de menú | Validar vigencia, permisos y recorrido antes de diseñar |
| Plan y facturación | Enlace del propietario conservado; contratación continúa web | Revisión completa de estados y comparación móvil |
| Ajustes, acceso, reservas públicas e invitaciones | Sin cambios de contenido | Fase final de diseño, estados y revisión integral |

Hallazgos para Agenda: comprobar citas importadas que sólo tienen contacto, sin ficha vinculada, y horas que no coinciden con intervalos del selector. El formulario existente puede pedir seleccionar cliente y ajustar la hora al editar esos casos; esta entrega no modifica esa lógica. Deben cubrirse al rediseñar el flujo, antes de dar por cerrada Agenda.

## Validación

- `npm test`: 278 pruebas aprobadas, dos omitidas, ninguna fallida. Incluye tres pruebas nuevas para rutas por negocio, permisos, carga y selección de módulos.
- TypeScript y ESLint de los archivos modificados: aprobados.
- Compilación de producción: aprobada; revisión visual en esa compilación local con una base desechable, sin conexiones de mensajería o cobros.
- Hoy revisado en Edge a 320, 375, 390, 768, 1024 y 1440 píxeles CSS efectivos. Sin desbordamiento horizontal del contenido ni de la página. Botón inferior y navegación dentro del espacio disponible. Escritorio comprobado con menú abierto y plegado.
- Revisión adicional a 390 × 500: menú completo desplazable, barras accesibles y aviso de vencimiento dentro de la ventana con desplazamiento vertical.
- Navegación comprobada hacia Agenda, creación de cita, detalle de una cita, Clientes y Chats. No se enviaron mensajes ni se hicieron pagos. La comprobación de apertura del formulario no equivale a validar toda la lógica de agenda.
- Cuenta vencida comprobada: ningún enlace Nueva cita ni interruptor del autopiloto en Hoy; botón inferior de selección de plan.
- Evidencia local: `output/responsive-ui-stage-1/`, capturas, `qa-layout.json`, registros de pruebas y compilación. Los teléfonos físicos y su teclado/gestos quedan pendientes; redimensionar Edge no sustituye esa revisión.

## Pruebas locales y despliegue

`scripts/setup-responsive-ui-local.mjs` sólo acepta las bases desechables `crm_training` y `crm_retention_control` en `127.0.0.1:5446`. Requiere el entorno de pruebas local ya inicializado. Genera tres citas, servicios y profesionales ficticios; `--expired` simula vencimiento y sin ese argumento simula prueba activa. No aplica migraciones ni cambia archivos de entorno.

**No hay migraciones ni tablas nuevas. Joel redespliega.** La primera entrega se conserva en un commit independiente. Si hiciera falta revertir la presentación, se puede revertir ese commit y redesplegar la versión anterior; los datos no requieren conversión.

El siguiente bloque autorizado del plan es Agenda y creación/edición de citas. Antes de extender el patrón al resto se revisarán los casos de cliente sin vínculo, permisos profesionales, ausencia de servicios, conflictos de horario, errores de guardado y cuenta vencida.
