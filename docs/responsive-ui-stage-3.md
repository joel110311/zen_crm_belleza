# Tercera entrega: Clientes y ficha

14 de octubre de 2026. Continúa la navegación/Hoy y la entrega de Agenda. Web adaptable con los colores del negocio; sin migraciones ni nuevas tablas. Joel redespliega después de publicarse la imagen en GitHub.

## Resultado

- Clientes presenta filas compactas en celular y tableta, y tabla en escritorio amplio. Nombre completo enlazado a la ficha, teléfono, última visita completada, etiquetas y atenciones. Se conservan búsqueda por nombre/número, actualización, exportación CSV, selección múltiple y paginación 20/50/100.
- Chat y nueva cita permanecen accesibles. Confirmar, marcar atendido, reagendar y eliminar cita se conservan en el menú; las acciones frecuentes también aparecen en escritorio. Las rutas mantienen explícitamente el negocio activo.
- Ficha: Resumen, Citas y Actividad como secciones en celular; perfil e historial simultáneos en escritorio. Las citas incluyen las asociadas directamente al contacto y las vinculadas a sus expedientes, sin duplicar visitas. Abren la cita y fecha correctas en Agenda, usando la zona horaria del negocio.
- Nombre y teléfono se guardan automáticamente tras editar o salir del campo, con estado de guardado y error visible. No se envían escrituras por montar el formulario. Etiquetas informan errores, respetan permisos y admiten texto largo sin desbordar.
- Actividad usa fechas y cantidad de mensajes de las conversaciones reales. No carga sus cuerpos. Se retiraron los controles decorativos de notas/tareas que no tenían persistencia; crear un módulo de notas no forma parte de esta entrega.
- Cuenta vencida: consulta, selección y exportación disponibles; nuevo cliente, campañas, eliminación masiva, cambios de datos, etiquetas y operaciones de citas quedan bloqueados en la interfaz. Se mantienen las validaciones de acceso y escrituras del servidor.
- Nuevo cliente conserva nombre y teléfono si falla el guardado. Formulario y revisión de eliminación permiten desplazarse en alturas pequeñas. No se ejecutó ninguna eliminación de clientes en las pruebas.

## Verificación

- `npm test`: 294 pruebas, **292 aprobadas, 2 omitidas, 0 fallos**. Cinco casos nuevos comprueban historial sin duplicados, última visita real, próxima cita válida, etiquetas derivadas sin modificar datos y cliente sin citas.
- Se corrigió el entorno de una prueba previa de calendario: su módulo VM usaba otra clase `Date`, de modo que una fecha recibida se sustituía accidentalmente por hoy. El ensayo de conservación de horarios ahora utiliza la misma clase y deja de depender del día de ejecución. No cambió la lógica productiva del calendario.
- TypeScript, ESLint de los archivos modificados y compilación de producción aprobados. Navegador local sobre `next start`, base dedicada con datos ficticios y proveedores externos desconectados.
- Recorridos comprobados: crear cliente, rechazar teléfono duplicado conservando valores, editar nombre y comprobar guardado, agregar/quitar etiqueta, buscar por nombre y teléfono con espacios, seleccionar y exportar un único cliente, ficha sin citas, historial real y apertura de una cita desde la ficha.
- **40 comprobaciones finales de layout sin desbordamientos horizontales ni diálogos fuera de la ventana**. Anchos efectivos 320, 375, 390, 768, 1024 y 1440 px CSS. Se revisaron lista, formulario, ficha, búsqueda vacía y ventana de revisión de eliminación; también alturas 320/500, cuenta vencida y etiqueta larga. Se corrigieron los problemas encontrados en el estado vacío, las etiquetas y el espacio de la lista cuando aparece el aviso vencido.
- Evidencia en `output/responsive-ui-stage-3/`: `qa-layout.json` contiene la última comprobación por caso; `qa-layout-history.json` conserva iteraciones anteriores. Capturas por tamaño, logs de build/tests y `clientes-seleccionados.csv` de la descarga real.

La revisión en navegador redimensionado no sustituye pruebas físicas de Android/Chrome e iPhone/Safari, teclado y áreas seguras. Los recorridos de esta entrega se hicieron con propietario local, activo y vencido; se reutilizan los permisos existentes. No se enviaron campañas o mensajes ni se hicieron pagos reales.

## Siguiente bloque

Chats: lista → conversación → ficha en celular; paneles simultáneos cuando haya espacio en escritorio. Conservar búsqueda, selección, mensajes y estados al navegar; revisar menú de mensajes, adjuntos y Entrenar IA. Después continúan Asistente IA y los módulos administrativos del plan.
