# Segunda entrega: Agenda y formulario de citas

13 de octubre de 2026. Continúa el diseño aprobado y la primera entrega de navegación/Hoy. No hay migraciones ni tablas nuevas; Joel realiza el redespliegue.

## Cambios

- Agenda presenta la lista del día en celular y tableta, con selector de fecha, semana, profesional y estado. En escritorio amplio inicia con el calendario, conservando mes/semana/día y cambio a lista. Ambos usan las mismas citas y zona horaria del negocio.
- Los estados se muestran tal como están guardados. Una cita pasada no se etiqueta automáticamente como completada sin una acción que lo confirme.
- Crear y editar siguen tres pasos: cliente/servicio/profesional, fecha/horario y revisión. Volver atrás conserva los campos. Los errores permanecen junto al formulario; un conflicto de horario no cierra ni vacía la captura.
- En celular, el diálogo ocupa la pantalla; encabezado y pie permanecen visibles y sólo los campos/resumen se desplazan. En escritorio se presenta una ventana centrada. Se eliminó el desplazamiento de centrado heredado que recortaba la ventana móvil.
- El selector permite buscar contactos del CRM y fichas existentes sin crear fichas al abrir/buscar. El servidor resuelve y valida la asociación antes de guardar; rechaza combinaciones de contacto/ficha que pertenezcan a clientes distintos.
- Los accesos desde Clientes pueden precargar también un contacto sin ficha. Las fichas existentes fuera de los primeros resultados siguen recuperándose al editar.
- Abrir una cita importada conserva su hora exacta, segundos y duración, aunque no coincidan con intervalos de 15 minutos. Si sólo cambian notas o cliente, no se vuelve a enviar el horario como una reprogramación. Los cambios efectivos de horario/profesional siguen pasando por la validación del servidor.
- Se mantienen creación de cliente desde el formulario, recordatorios, sobreturnos autorizados por las políticas, servicios personalizados de citas existentes, eliminación y las integraciones existentes. Abrir el formulario no envía mensajes ni cobra.
- En solo lectura desaparece Nueva cita; el detalle muestra únicamente consulta y cierre. No se permite seleccionar espacios, arrastrar ni redimensionar citas. El modo procede del acceso real del negocio, también cuando no existe un aviso de vencimiento. Crear/editar/eliminar comprueban acceso de escritura antes de sincronizar o guardar.
- El profesional se reconoce por el usuario local o su vínculo con la cuenta de control. La interfaz conserva el filtro de su agenda, bloquea la selección de otros profesionales y no habilita crear citas sin un profesional vinculado.

## Comprobaciones

- `npm test`: 287 pruebas aprobadas y dos omitidas, sin fallos. Nueve pruebas nuevas cubren fechas imposibles, cambio explícito de hora, preservación de segundos/duración importados, zona horaria al cruzar medianoche y asociaciones de clientes ausentes/incompatibles.
- TypeScript, ESLint de los componentes y acciones modificadas, y compilación de producción aprobados.
- Revisados Agenda/calendario y los tres pasos a 320, 375, 390, 768, 1024 y 1440 píxeles CSS. También a 390 × 500. Sin desbordamiento horizontal de página/formulario; pie del diálogo dentro de la ventana. El calendario semanal puede desplazarse dentro de su contenedor cuando se elige expresamente en una pantalla estrecha.
- Recorrido local completo: contacto existente sin ficha → servicio → horario del 14 de octubre a las 10:17 → revisión → guardado. La base registró 10:17–11:02 con el contacto correcto y ninguna ficha duplicada.
- Edición local de notas sobre una cita importada a las 21:02:25.295: conservó hora, segundos, duración y contacto sin ficha.
- Intento de mover esa cita al horario ocupado de las 10:17: el servidor devolvió «Ya existe otra cita ocupando ese horario», conservó los campos y no modificó la cita original.
- Cuenta vencida: no aparece Nueva cita y el detalle sólo permite consultar/cerrar. Revisado también con 500 px de altura.
- Evidencia en `output/responsive-ui-stage-2/`: capturas, `qa-layout.json`, verificación de la base local y registros de pruebas/compilación. Se utilizó exclusivamente la base desechable local, sin pagos ni mensajería externa.

Estas comprobaciones no son pruebas en dispositivos físicos ni garantizan todas las combinaciones de permisos e integraciones. Quedan previstas la revisión en Android/Chrome e iPhone/Safari, teclado real, calendarios Google conectados y pruebas del negocio durante el despliegue gradual.

## Siguiente bloque

Clientes y ficha: búsqueda y filas adaptables, resumen del cliente, historial/citas y acceso a conversación. Después, Chats con lista/conversación/detalle y adaptación al teclado. Se mantiene el plan global en `docs/responsive-ui-redesign-plan.md`.
