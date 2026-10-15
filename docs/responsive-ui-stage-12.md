# Duodécima entrega: invitaciones y páginas legales

15 de octubre de 2026. Sin migraciones ni tablas nuevas; Joel redespliega. Se sube junto con la entrega de reservas tras verificar ambas, como pidió Joel.

## Revisión con Taste Skill

Se aplica Redesign Existing Projects a las pantallas existentes. La invitación usaba una tarjeta y párrafo densos, sin separación clara entre cuentas nuevas y existentes. Ahora comparte el shell de acceso aprobado, con indicaciones breves, campos de 16 px, etiquetas persistentes, mostrar/ocultar contraseña, estado pendiente y error junto a la acción. Los campos siguen siendo opcionales para una cuenta existente; el servidor conserva la validación de cuentas nuevas.

Privacidad y términos generales, y los avisos específicos de Google Calendar, comparten una lectura de ancho limitado, navegación con página actual, salida al acceso y salto al contenido. En celular la navegación pasa encima del documento; en escritorio queda al lado. Se conservan fuente, iconos y colores por tema. Los textos legales, versiones y enlaces existentes permanecen iguales; no es una revisión jurídica. Cada ruta tiene un título identificable.

Eliminar cuenta mantiene sus advertencias y verificaciones. La información adicional se despliega en línea. Cada negocio muestra las opciones completas de transferir o cerrar, sin una selección predeterminada ni un select que recorte frases largas. Contraseña y confirmación escrita siguen siendo obligatorias; la decisión explícita también se verifica antes del envío. Los controles se bloquean durante la petición y una referencia evita envíos duplicados antes del siguiente render.

Si se interrumpe la respuesta de eliminación, la interfaz conserva el comprobante privado en el fragmento de URL y ofrece consultar el estado, evitando solicitar otra eliminación automáticamente. Un rechazo explícito del servidor conserva el formulario y retira el comprobante no utilizado. El estado desconocido no se presenta como eliminación completada. No se altera la política del servidor, permisos, sucesión, revocación, retención ni el proceso de limpieza.

No se añade eliminación de cuenta a la landing ni al pie general de navegación. El destino existente desde facturación continúa disponible. Se mantiene el enlace ya existente en privacidad.

## Verificación

- Compilación de producción, TypeScript, ESLint de archivos afectados y diff correctos.
- Suite completa: **329 aprobadas, 2 omitidas, 0 fallidas**, de 331 en la comprobación final conjunta. Siete regresiones nuevas ejecutan los componentes con I/O simulado: contratos de invitación nueva/existente, envío duplicado/error/reintento, decisión explícita y transferencia, eliminación con respuesta interrumpida, rechazo, comprobante inexistente y acceso sin sesión.
- **54 combinaciones** de nueve vistas/estados por seis anchos CSS efectivos: **320, 375, 390, 768, 1024 y 1440**. Sin desbordamiento horizontal detectado; botones de al menos 44 px y campos de 16 px. Evidencia `output/responsive-ui-stage-12/qa-layout.json` y capturas por tamaño.
- Vistas: invitación, error de invitación inexistente, privacidad, términos, privacidad y términos de Google, eliminación con negocios, información de eliminación ampliada y comprobante inexistente.
- A **320 × 500**, se puede desplazar hasta Aceptar invitación y hasta el botón deshabilitado de eliminación. Evidencia `qa-low-height.json`, `invitation-low-height.png` y `deletion-low-height.png`. También se alcanza el final del documento largo de Google.
- El navegador consultó la cuenta ficticia local existente, un enlace de invitación inexistente y un comprobante inexistente. No se crearon cuentas, aceptaron invitaciones válidas, introdujeron credenciales nuevas, transfirieron negocios ni eliminaron datos. Los resultados satisfactorios de esas acciones se cubren con servicios simulados, no con acciones reales destructivas o de permisos.

Las opciones de invitaciones y correo se habilitaron sólo en el proceso local con credenciales ficticias; no se editó configuración de producción ni se enviaron correos. La revisión física de Android/Chrome e iPhone/Safari y proveedores de producción sigue pendiente. Próximo bloque: revisión integral de los módulos vigentes, estados y regresiones, sin restaurar Pipeline, Reportes ni la antigua Caja.
