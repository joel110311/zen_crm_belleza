# Rediseño adaptable del CRM — propuesta para revisión

Fecha inicial: 13 de octubre de 2026. Actualización: 14 de octubre. Estado: diseño aprobado; implementadas navegación/Hoy, Agenda/citas, Clientes/ficha y Chats/mensajes/entrenamiento. El resto de las fases sigue pendiente. Seguimiento: [primera entrega](responsive-ui-stage-1.md), [Agenda y citas](responsive-ui-stage-2.md), [Clientes y ficha](responsive-ui-stage-3.md) y [Chats y entrenamiento](responsive-ui-stage-4.md). El siguiente bloque es Plantillas y Asistente IA.

## Objetivo y criterio de diseño

Rediseñar la experiencia visual y la organización de cada tarea desde cero, conservando los servicios, autenticación, permisos, facturación, aislamiento de negocios y acciones existentes. Una experiencia web adaptable puede sentirse diseñada para celular sin sacrificar la productividad de escritorio. Esto no convierte la web en una app nativa de Expo.

Referencia aportada: https://dribbble.com/shots/24098236-Credit-Card-Checkout y captura del usuario. Se toma su jerarquía, separación de secciones, formularios legibles y acción principal clara; se conserva la identidad del CRM. No se asume que una captura estática demuestra accesibilidad o comportamiento real.

La inspección del código actual encontró tarjetas del dashboard con alturas mínimas de 218/340/384 px y encabezados con `truncate`. `DashboardShell` ya distingue módulos, pero sus márgenes y contenedores no bastan para cambiar la prioridad del contenido. Estos hallazgos son de una revisión inicial, no una auditoría completa de todos los flujos.

## Reglas del nuevo sistema

- En celular: una tarea principal por pantalla, contenido en una columna, navegación inferior de Hoy/Agenda/Chats/Clientes/Más y acciones secundarias dentro del detalle. Barra inferior sólo cuando no cubra contenido o teclado. `safe-area-inset-bottom` para dispositivos que lo necesiten.
- En escritorio: menú lateral con nombres, búsqueda, tablas con columnas pertinentes y panel de detalle. Las acciones frecuentes deben seguir accesibles con teclado. En tableta: navegación y columnas según el espacio disponible, no por una etiqueta de dispositivo.
- Tipografía base de 16 px, campos legibles, etiquetas persistentes, títulos completos, objetivos táctiles de aproximadamente 44–48 px y espaciado consistente de 4/8/12/16/24/32 px. La densidad de escritorio no se consigue reduciendo las letras del celular.
- Blanco y fondos suaves, color principal del negocio, contornos discretos y contraste comprobado. Se elimina la acumulación de tarjetas decorativas. Estados siempre con texto, además del color.
- Componentes compartidos: encabezado de página, acción principal, búsqueda/filtros, filas, indicadores, estados vacíos/error/carga, ficha de detalle, pasos de formulario y aviso de suscripción. En celular, formularios complejos en pantalla completa; en escritorio, diálogo amplio o panel lateral.
- Política de contenido: mostrar primero los datos necesarios para decidir. Información avanzada en secciones expandibles. No ocultar funciones críticas ni duplicar la misma información en varias tarjetas.
- Permisos y modo de solo lectura afectan también a la interfaz, conservando siempre la validación en servidor. El propietario ve facturación/exportación; el personal sólo lo autorizado. No inventar acciones disponibles.

## Mapa de pantallas

| Módulo | Celular | Escritorio |
|---|---|---|
| Hoy / dashboard | Fecha breve, 3 indicadores compactos, próxima cita, agenda inmediata y pendientes | Agenda, resumen financiero según permiso, equipo y pendientes en columnas |
| Agenda | Día y lista de citas; cambiar fecha/profesional con controles sencillos | Día/semana y equipo en paralelo, filtros persistentes, detalle lateral |
| Crear / editar cita | Datos → revisión; cliente, servicio, profesional y horario; errores junto al campo | Formulario agrupado y resumen visible; mismos datos y validaciones |
| Recepción | Llegadas, en atención y finalizadas; siguiente acción por cita | Columnas o tabla operativa con contexto del cliente |
| Clientes | Búsqueda y filas con nombre, última visita y acción de abrir | Tabla con filtros, selección múltiple y exportación según permiso |
| Ficha de cliente | Resumen → citas → conversación → notas, con navegación clara | Ficha y actividad en dos paneles |
| Chats | Lista → conversación completa → ficha; volver conserva posición y búsqueda | Lista, conversación y ficha simultáneas cuando haya espacio |
| Mensajes y Entrenar IA | Menú táctil; corrección en pantalla amplia y revisión clara | Menú contextual y diálogo con pregunta/respuesta |
| Asistente IA | Resumen, configuración por secciones, FAQs y simulador como destinos claros | Menú de secciones y zona de trabajo; evitar filas de pestañas comprimidas |
| Servicios | Lista por categoría y ficha de edición | Catálogo o tabla con filtros y edición lateral |
| Especialistas / equipo | Personas y ficha de disponibilidad/servicios | Personas, asignaciones y horarios comparables |
| Mi negocio | Perfil, ubicación, horarios y políticas en secciones | Formulario organizado con vista previa cuando sea útil |
| Plantillas | Lista, buscar, editar y previsualizar | Biblioteca y editor en paralelo |
| Pipeline | Lista filtrada por etapa y cambiar etapa desde detalle | Tablero con arrastre, alternativa mediante botones y detalle |
| Reportes / caja | Resumen por periodo y desglose progresivo; oculto sin permiso | Comparaciones, tablas y filtros de periodo |
| Plan y facturación | Plan actual → elegir plan → condiciones; 299/499/799 MXN y cupos existentes | Comparación de planes y movimientos en una misma vista |
| Cuenta vencida | Aviso compacto persistente; ventana inicial breve; consulta/exportación y fecha de retención | Mismos estados y plazos con presentación horizontal |
| Configuración e integraciones | Índice de secciones y formularios independientes | Navegación lateral por categorías y contenido amplio |
| Acceso, registro y recuperación | Un objetivo por pantalla, teclado adecuado y errores claros | Formularios centrados, sin decoración que oculte el objetivo |
| Reservas públicas / invitaciones / legales | Flujo de reserva por pasos y lectura accesible | Mismo proceso, con resumen adicional si cabe |

## Secuencia propuesta

| Fase | Trabajo | Entregable y salida | Estimación orientativa |
|---|---|---|---|
| 1. Auditoría de tareas | Inventario de rutas, acciones y estados; recorridos de dueño/personal; revisar datos largos y roles | Matriz de cobertura y prioridades; nada se pierde en el rediseño | 2–3 días |
| 2. Sistema visual y prototipo | Tokens, navegación, densidad, campos, formularios y estados; validar Hoy/Agenda/Chats/Clientes | Prototipo aprobado en móvil y web antes de conectar pantallas | 3–5 días |
| 3. Base y primera entrega | Nuevo shell adaptable; Hoy, Agenda y creación/edición de cita | Primer conjunto usable con las acciones y permisos actuales | 5–7 días |
| 4. Atención al cliente | Clientes, ficha, Chats, mensajes, plantillas y entrenamiento | Recorrido completo de buscar cliente, conversar y corregir IA | 5–7 días |
| 5. Administración | Asistente IA, negocio, servicios, equipo, recepción, reportes, pipeline y facturación | Cobertura de todos los módulos internos y estados de suscripción | 7–10 días |
| 6. Accesos y cierre | Pantallas públicas, reservas, acceso y configuración; revisión integral y regresiones | Lista de aceptación cumplida y material para redespliegue | 4–6 días |

Total orientativo: **26–38 días laborables (aproximadamente 5–8 semanas)** para implementación, revisiones y comprobaciones, sujeto a la auditoría inicial. No es una fecha garantizada ni una estimación de la app nativa. Las entregas se revisan por conjunto de pantallas, sin esperar al final para validar el diseño.

## Implementación técnica

1. Mantener Next.js/React y los contratos y acciones existentes. Separar obtención/validación de datos de la presentación donde actualmente estén mezcladas.
2. Usar componentes comunes para compartir comportamiento; variar composición mediante CSS y componentes de vista cuando la interacción lo requiera. No mantener dos CRMs independientes.
3. Introducir la nueva presentación por módulos con una opción de reversión de interfaz; decidir el mecanismo después de la auditoría. No crear tablas sólo para activar un diseño.
4. Respetar el aislamiento de negocios y reutilizar permisos, datos del calendario, cuotas de IA y límites de suscripción. El prototipo no valida el acceso real al backend.
5. Evitar cargar conversaciones, gráficas y grandes catálogos cuando no se usan. Mantener paginación/virtualización donde corresponda. Medir carga antes y después en condiciones comparables.
6. Inicialmente no se anticipan migraciones de datos. Si aparece una necesidad real, se documentará aparte. Los cambios sin migraciones se prueban y suben a Git; **Joel redespliega**.
7. El sistema visual y los contratos podrán orientar Expo posteriormente; los componentes HTML de esta web no se reutilizan automáticamente como pantallas nativas.

## Aceptación y pruebas

- Anchos efectivos: 320, 375, 390, 430, 768, 1024 y 1440 px. Revisar también altura reducida, horizontal y teclado abierto en dispositivos reales.
- Sin scroll horizontal de la página, texto cortado en títulos esenciales, controles superpuestos ni pie que tape campos. Una tabla extensa sólo puede desplazarse dentro de su contenedor cuando sea indispensable; en celular se prefiere una lista.
- Revisar contenido largo, 0 datos, muchas filas, cargas lentas, errores, desconexión, respuesta pendiente, permisos insuficientes y cuenta vencida. Mantener los estados de prueba, activa, solo lectura, retención y suspensión.
- Tabulación y foco, nombres accesibles, contraste, texto ampliado y movimiento reducido. No declarar conformidad de accesibilidad sin una auditoría específica.
- Recorridos funcionales: nueva cita, cambio/cancelación, cliente, chat manual, entrenamiento de FAQ, pausa del bot, exportación y navegación a facturación. Ninguna captura demuestra por sí sola que esos flujos funcionen.
- Datos y permisos idénticos entre móvil y escritorio; las comprobaciones de negocio siguen en servidor. Conservar las pruebas de regresión y añadir pruebas sólo para comportamientos nuevos relevantes.
- Guardar capturas por tamaño y fase. Revisar físicamente al menos Android/Chrome e iPhone/Safari antes del cierre; una ventana redimensionada no comprueba el teclado, los gestos ni las áreas seguras del teléfono.

## Muestra de esta propuesta

`output/responsive-crm-prototype/index.html`: prototipo local con datos ficticios. Incluye Hoy, Agenda, Chats, Clientes, Asistente IA, Planes y el recorrido de crear una cita de ejemplo. Permite comparar móvil/web, cambiar el color principal y simular solo lectura. Los demás módulos muestran su alcance pendiente de diseño detallado. No consulta el CRM, no envía mensajes, no cobra y no escribe en la base de datos.

Primera decisión de diseño para revisar: jerarquía de Hoy, navegación inferior, composición de Agenda/Chats y pasos del formulario. Después de esa revisión se ajustan los patrones y se implementa la primera entrega.

### Ajustes de la segunda muestra y comprobación

- El contenedor ocupa el espacio restante de la ventana, sin una altura mínima que recorte el botón principal o la navegación inferior. Sólo el contenido central se desplaza.
- Entre 641 y 1050 px de ancho del contenedor, el dashboard presenta la agenda en una columna principal; caja y equipo quedan debajo. En escritorio amplio recupera las dos columnas. El área de trabajo tiene un máximo de 1600 px.
- En formularios muy estrechos, fecha y hora se apilan. El encabezado y las acciones permanecen visibles mientras los campos se desplazan verticalmente.
- Revisado en Edge a anchos efectivos de 320, 375, 390, 430, 768, 1024 y 1440 px: las siete vistas de la muestra no presentan desbordamiento horizontal y sus barras inferiores quedan dentro del contenedor. También se revisó Hoy a 1980 × 1080 y a 390 × 500, incluyendo solo lectura.
- El formulario a 390 × 500 mantiene el pie visible y el cuerpo desplazable. El recorrido de creación de ejemplo conserva cliente, servicio, profesional y hora al volver a editar; el manicure muestra 60 minutos y termina a las 16:30 al comenzar a las 15:30.
- Evidencia local: `output/responsive-crm-prototype/qa-layout.json` y capturas en esa misma carpeta. Estas comprobaciones corresponden al prototipo; no sustituyen las pruebas funcionales del CRM ni la revisión en teléfonos físicos.
