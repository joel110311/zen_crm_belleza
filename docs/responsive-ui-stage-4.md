# Cuarta entrega: Chats, mensajes y entrenamiento

14 de octubre de 2026. Continúa Clientes/ficha. Cambios de interfaz y comportamiento del cliente; sin migraciones ni tablas nuevas. Joel redespliega después de publicarse la imagen de GitHub.

## Resultado

- En celular y tableta pequeña, lista → conversación → ficha rápida. Volver conserva búsqueda y posición del listado. En escritorio se presentan lista y conversación; a partir de 1440 px también aparece la ficha lateral.
- La bandeja usa el espacio del shell del CRM, respetando avisos y navegación. En alturas pequeñas se ocultan las barras generales que restaban espacio a la conversación; el botón de volver sigue disponible. En la lista baja se conserva el menú del negocio.
- Nombres legibles y fechas compactas. Búsqueda por nombre sin exigir acentos, teléfono con espacios y contenido del último mensaje. Se mantienen filtros Todos/Míos/Sin asignar, paginación, contadores y sincronización existentes.
- Borradores de texto, archivo y respuesta citada separados por conversación dentro de la bandeja abierta. Se puede escribir un borrador con el canal desconectado; el envío y la carga de archivos siguen bloqueados. El borrador no se almacena de forma permanente al recargar o salir del módulo.
- Respuestas tardías de consultas y envíos no se aplican a otra conversación. Los fallos de envío recuperan el borrador sin reemplazar texto, archivos o intención de respuesta más recientes. Una carga que termina después de cambiar de cliente guarda el archivo en el borrador de su conversación de origen.
- Compositor con más espacio para escribir. En celular, Adjuntar también permite elegir imágenes; en escritorio se mantiene el acceso adicional de imagen. Se conservan plantillas, adjuntos y audio.
- Menú de mensajes visible en celular y accesible por teclado. Entrenar IA sólo aparece en respuestas válidas de IA y con permiso. El diálogo de entrenamiento mantiene pregunta/respuesta, revisión del servidor y carácter experimental; en celular ocupa una pantalla con cuerpo desplazable y acciones al pie.
- Ficha rápida, reacciones, reenvío y confirmaciones usan ventanas con foco y tamaño acotado. La ficha enlaza a Clientes dentro del negocio activo. El reenvío usa el canal de la conversación de destino y conserva la ventana si el servidor rechaza el envío.
- Asignación disponible desde el menú también en celular. La pausa/activación de IA se presenta en el menú móvil, dejando espacio al nombre; el interruptor permanece en escritorio. Los cambios de modo y responsable se muestran después de confirmarse en servidor, con error visible si fallan.
- Solo lectura conserva consulta, ficha y copia; bloquea composición, entrenamiento, reacciones, reenvío, asignación, cambios de modo y eliminación. Se conservan las validaciones de permisos y acceso del backend.

## Verificación

- `npm test`: **305 pruebas, 303 aprobadas, 2 omitidas, 0 fallos**. Once casos nuevos cubren borradores separados, retorno a la lista, borrador limpio, caches independientes, canal de destino, respuestas tardías, recuperación de envío fallido y búsqueda.
- Compilación de producción con TypeScript y ESLint de los archivos modificados aprobados. Navegador sobre `next start`, base dedicada local y canales desconectados.
- **61 comprobaciones finales de layout sin desbordamiento horizontal ni diálogos fuera de la ventana**. Lista, conversación, ficha, entrenamiento, reacción, reenvío, asignación y confirmación a 320, 375, 390, 768, 1024 y 1440 px CSS. También alturas 320/500, búsqueda vacía, nombre largo, ventana cerrada de WhatsApp API y cuenta vencida. La inspección visual detectó el nombre comprimido junto al interruptor; se corrigió y volvió a comprobar.
- Recorridos locales: borradores distintos para Ana/Lucía y restauración al volver, ficha rápida sin perder borrador, pregunta/respuesta correctas al entrenar IA y guardado de una corrección ficticia, ausencia de entrenamiento en mensaje humano, asignación al propietario local, pausa/reactivación de IA confirmadas, búsqueda sin acentos y por teléfono, conservación de búsqueda y posición al volver.
- Cuenta vencida comprobada: mensajes y ficha consultables, campo de envío ausente, entrenamiento ausente y acciones de modificación deshabilitadas; copia disponible.
- Evidencia en `output/responsive-ui-stage-4/`: `qa-layout.json`, capturas por caso/tamaño, logs de tests/build/lint. `scripts/setup-responsive-inbox-local.mjs` genera 24 conversaciones ficticias únicamente en la base local dedicada y no envía mensajes.

No se enviaron mensajes ni reacciones a WhatsApp, ni se ejecutaron eliminaciones. Envíos reales de texto, medios y audio requieren comprobarse con un canal conectado; las pruebas de recuperación y aislamiento son de la lógica local. Queda pendiente la revisión física de Android/Chrome e iPhone/Safari, teclado, áreas seguras y micrófono. La revisión de permisos en navegador usó propietario local activo y vencido; no constituye una auditoría completa de todos los roles.

## Siguiente bloque

Plantillas y Asistente IA: biblioteca/editor, navegación por secciones, FAQs, fuentes de conocimiento, configuración y simulador. Después continúa la administración del negocio según el plan general.
