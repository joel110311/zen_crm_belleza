# Quinta entrega: Plantillas y Asistente IA

Fecha: 14 de octubre de 2026. Implementada en la web actual. No requiere migraciones ni tablas nuevas. Joel realiza el redespliegue.

## Resultado

- Plantillas tiene tres destinos según los permisos existentes: Guardadas, WhatsApp API y Campañas. Conserva la identidad visual del negocio y elimina el encabezado global duplicado en estos módulos.
- Respuestas guardadas: biblioteca y editor en paralelo desde 1024 px; en celular/tableta el editor abre en un diálogo, con campos desplazables y acciones al pie. Los nombres pueden ocupar varias líneas. Mantiene variables, atajos, tipos de archivo, adjuntos, favoritos, activación, orden y vista previa.
- Volver del editor conserva el borrador mientras el panel permanece montado. Elegir otra plantilla o crear una nueva pide descartar los cambios; salir de la página con cambios advierte mediante el aviso del navegador. No se guarda un borrador persistente al cambiar de módulo o recargar.
- Después de crear, editar o duplicar, se recarga la biblioteca completa y la búsqueda se aplica sobre esa biblioteca. Limpiar la búsqueda vuelve a mostrar todos los registros, incluso si una operación ocurrió con un filtro activo.
- WhatsApp API: filtros se distribuyen sin columnas fuera de pantalla; la tabla tiene presentación de fichas en celular. La biblioteca de ejemplos ofrece filtros plegables y vista previa en diálogo en tamaños compactos; en escritorio utiliza paneles según el espacio. El editor admite varias líneas en las barras de herramientas. Sin WABA conectado, el envío a revisión aparece deshabilitado y explicado.
- Asistente IA: Ajustes, Fuentes, Probar y FAQs, con consumo mensual discreto. Bienvenida, atención humana, seguimiento y horarios son secciones desplegables. La barra de cambios pendientes queda sobre la navegación móvil.
- Fuentes: consulta, estados y errores, respaldo TXT, confirmación antes de eliminar y formulario compacto de nueva fuente. Las acciones al pie siguen accesibles en poca altura; los estados temporales se muestran en español.
- FAQs: preguntas y respuestas, búsqueda, controles táctiles para editar/pausar/eliminar y hoja aprobada. Se conserva el motor, la prioridad de correcciones, los límites y la protección de revisiones existentes.
- Simulador: historial desplazable, avance hasta la respuesta reciente y error visible. Una petición fallida conserva el mensaje para reintentar y restaura el historial anterior completo; la petición sigue enviando únicamente las últimas 12 entradas, como antes.
- Cuenta vencida: consultar queda disponible; crear, editar, subir archivos, operar campañas y probar IA se bloquean en la interfaz. La descarga TXT se mantiene disponible. Las validaciones de servidor existentes siguen vigentes.

## Comprobaciones

Compilación de producción, TypeScript, ESLint de los archivos afectados y `git diff --check` correctos. Suite existente: **303 pruebas aprobadas, 2 omitidas y 0 fallidas**.

Revisión en Edge con anchos CSS efectivos de **320, 375, 390, 768, 1024 y 1440 px**. Configuración de IA, horarios abiertos, FAQs, fuentes, simulador, biblioteca/editor de respuestas guardadas, página Meta, campañas y biblioteca/editor de ejemplos Meta. También diálogos de entrenamiento, nueva fuente y vista previa, y editor a 320 × 500 y 390 × 500. Registro final: **88 comprobaciones de geometría, sin desbordamientos detectados**. La captura y las mediciones de geometría no equivalen a una auditoría de accesibilidad ni a todas las posibles combinaciones de datos.

Recorridos realizados con datos ficticios en la base dedicada local:

| Recorrido | Resultado observado |
|---|---|
| Editar respuesta guardada → volver → continuar borrador → guardar | Conserva el texto y actualiza la biblioteca |
| Descartar borrador y cancelar confirmaciones de eliminación | Ventanas accesibles a 320 × 500; cancelar no borra registros |
| Crear una respuesta y duplicar con búsqueda activa | Registros visibles; limpiar búsqueda recupera biblioteca completa |
| Cambiar nombre de agente → cancelar; cambiar → guardar → restaurar | Cancela o confirma los cambios, según la acción |
| Buscar FAQ → pausar → reactivar → abrir entrenamiento | Actualiza el estado y abre pregunta/respuesta correctas |
| Nueva fuente incompleta | Valida sin indexar una fuente; muestra error y conserva el formulario |
| Elegir ejemplo Meta → vista previa → usar como base | Carga el contenido en el editor sin enviarlo |
| Cuenta vencida | Escritura deshabilitada; consulta y respaldo TXT disponibles |
| Cuenta local de personal PROFESIONAL | Plantillas disponibles según sus permisos; Campañas oculta; acceso directo a IA vuelve al dashboard |
| Simulador con petición fallida | Error legible y pregunta conservada para reintentar |

Evidencia: `output/responsive-ui-stage-5/qa-layout.json`, capturas y registros de pruebas/compilación en esa carpeta. La carpeta de salida se mantiene local y está ignorada por Git. `scripts/setup-responsive-assistant-local.mjs` genera sólo fixtures en las dos bases dedicadas de localhost:5446; rechaza otras URLs y producción. No indexa fuentes, envía mensajes ni realiza migraciones.

## Límites y siguiente bloque

La configuración local del modelo impidió generar la respuesta del simulador. Se verificaron su presentación y recuperación del error; **no se verificó una respuesta real nueva del modelo en esta entrega**. Tampoco se enviaron plantillas a Meta, mensajes de WhatsApp ni campañas. Revisar esos recorridos con canales autorizados y conectados antes de una aceptación completa. El motor de FAQs no se modificó en esta fase.

Pendiente la revisión en teléfonos físicos Android/Chrome e iPhone/Safari, incluyendo teclado, gestos y áreas seguras. El siguiente bloque del plan es **Mi negocio, Servicios y Especialistas**, seguido de Recepción, Pipeline, reportes y facturación; luego configuración y pantallas públicas.
