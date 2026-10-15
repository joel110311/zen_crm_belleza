# Novena entrega: Configuración e integraciones

15 de octubre de 2026. Interfaz web existente. Sin migraciones ni tablas nuevas; Joel realiza el redespliegue.

## Revisión con Taste Skill

Se aplica Redesign Existing Projects, instalada desde https://github.com/Leonxlnx/taste-skill. La guía principal design-taste-frontend excluye dashboards y pantallas internas; corresponde usar la guía de rediseño para este módulo.

La auditoría encontró tarjetas de navegación demasiado altas antes de llegar al contenido, campos sin etiquetas persistentes, botones anidados en los sonidos y estados de error que podían parecer una cuenta sin configurar. Algunos controles ofrecían modificaciones en cuentas de solo lectura. Se conservan los colores, fuente, iconos y contratos existentes; no se añaden recursos decorativos ni dependencias.

| Hallazgo | Mejora aplicada |
|---|---|
| Navegación extensa en celular | Selector de sección; menú lateral compacto cuando el contenedor tiene espacio suficiente |
| Formularios comprimidos por el ancho de la ventana | Columnas según el espacio real del panel; texto y botones completos, campos de 16 px |
| Usuarios sin etiquetas persistentes | Nombre, correo, contraseña y rol asociados a sus controles; carga, error y vacío diferenciados |
| Estado inicial de Google confundido con un fallo de consulta | Carga y error con reintento; se muestra el estado de conexión después de consultarlo |
| Controles activos en solo lectura | Bloqueo de acciones y guardas en usuarios, Google y WhatsApp; no se inicia descubrimiento automático de Google en solo lectura |
| Preferencias de apariencia y sonidos poco accesibles | Botones Claro/Oscuro/Sistema con estado seleccionado; selección de sonido y reproducción como botones separados; nombre accesible del volumen y del tamaño del logo |
| Instrucciones extensas de WhatsApp | Ayuda de coexistencia desplegable, conservando los pasos y advertencias existentes |

Las secciones respetan permisos también al abrir su URL directamente. Una sección no autorizada vuelve a Apariencia. Las preferencias locales de tema y notificaciones siguen disponibles en solo lectura. La autorización del servidor permanece como control definitivo.

## Alcance conservado

Se mantienen conexión oficial y QR de WhatsApp, configuración de Google Calendar, recordatorios, roles y permisos existentes. No cambian endpoints, payloads, credenciales, trabajadores ni modelos de datos. Mi negocio comparte el componente de configuración: se comprobó que mantiene sus pestañas, perfil y barra de guardado. Pipeline permanece retirado.

## Verificación

- Compilación de producción, TypeScript y ESLint de archivos afectados correctos; diff sin errores de espacios.
- Suite completa: **308 aprobadas, 2 omitidas, 0 fallidas**, sobre 310 pruebas. Tres regresiones nuevas cubren Google en solo lectura, descubrimiento/sincronización de una cuenta activa y error de carga con reintento. Las llamadas externas están simuladas.
- Edge: Apariencia, Usuarios, WhatsApp, Calendario y Notificaciones en anchos CSS efectivos **320, 375, 390, 768, 1024 y 1440 px**, sin desbordamiento horizontal detectado. Se midió también el formulario abierto de usuarios en los seis anchos.
- Altura reducida de **320 × 500**: el desplegable de frecuencia queda dentro del área visible, sus opciones caben y se puede cerrar con Escape. El contenido de la página continúa desplazándose.
- Preferencias locales: Claro/Oscuro y colores; cancelar cambios de sonido, guardar, recargar y restaurar el sonido original. Selección de proveedor de recordatorios sin guardar.
- Cuenta vencida local: agregar usuarios, guardar recordatorios y conectar WhatsApp deshabilitados. Personal local: URL directa de Usuarios muestra Apariencia y sólo las secciones autorizadas. No se crearon ni eliminaron cuentas ni se guardaron credenciales o permisos durante la revisión visual.
- Capturas finales: `output/responsive-ui-stage-9/settings-mobile-final.png`, `calendar-desktop-final.png`, `notifications-desktop-final.png`, `calendar-low-height-final.png`, `readonly-mobile-final.png` y `staff-permissions-final.png`. Mediciones: `qa-layout.json`, `qa-user-form.json` y `qa-readonly.json`. Las capturas iniciales por sección pueden corresponder al cuadro anterior durante la navegación; usar las identificadas como finales.

El entorno de pruebas queda con la prueba activa y las preferencias originales restauradas. No se hicieron conexiones, desconexiones, autorizaciones OAuth ni sincronizaciones reales con Google, Meta o WhatsApp. No se declara una comprobación de esas integraciones de extremo a extremo. Sigue pendiente la revisión en teléfonos físicos Android/Chrome e iPhone/Safari y la auditoría integral de accesibilidad.

Siguiente entrega: accesos y pantallas públicas, seguida de revisión integral de los módulos vigentes.
