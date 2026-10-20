# Recorrido de un negocio nuevo · 19 de octubre de 2026

## Evidencia de producción

- Registro, correo de verificación y acceso completados con intervención humana en la contraseña y el CAPTCHA.
- Negocio configurado y portal publicado con servicio, profesional, horarios y precio.
- Solicitud de cita creada desde el portal; visible en Recepción. Los horarios ocupados no vuelven a ofrecerse.
- Cupón del 100 % aplicado a Crecimiento para un mes adicional; la prueba original se conserva, sin cargo ni renovación automática.
- Línea de WhatsApp vinculada por QR por Joel. Un mensaje manual de seguimiento al único número autorizado figura como **Enviado a WhatsApp**. Esto no acredita lectura en el teléfono ni recepción entrante.
- Dirección ficticia y seis enlaces ilustrativos configurados por autorización de Joel. Los enlaces usan example.com; no representan perfiles reales. La promoción utiliza el mensaje de bienvenida existente, no un nuevo motor de descuentos.

## Correcciones incluidas en esta entrega

- Nuevo chat reutiliza el contacto de una reserva y su conversación del mismo canal; conserva su identidad y no mezcla canales.
- Ir al chat desde Clientes crea o reutiliza la conversación antes de abrirla.
- Usuarios muestra las invitaciones existentes por correo para negocios, con límites, permisos y modo de solo lectura. La edición de permisos individuales permanece disponible.
- Avisos de solicitudes muestran cliente, profesional y fecha completa del negocio. La única acción es Revisar solicitud, dirigida al negocio, día y solicitud correctos. En Chats aparecen arriba para no cubrir el compositor.
- Una solicitud pendiente del portal se revisa con Confirmar o Rechazar. Las acciones de atención de citas ya confirmadas se mantienen fuera de esa revisión puntual.
- La reserva pide nombre y teléfono, sin correo. Los correos de acceso e invitación permanecen.
- La dirección genérica de inicialización deja de mostrarse como una ubicación real; el mensaje de bienvenida admite una promoción con saltos de línea.
- Los cambios de citas invalidan también Hoy, Agenda, Recepción y Clientes del negocio activo, además de las rutas antiguas.

## Verificación local

- Compilación de producción correcta. ESLint de todos los archivos afectados correcto.
- 419 pruebas: 417 aprobadas, dos opcionales omitidas, ninguna fallida.
- Navegador real: iniciar chat dos veces conserva un solo contacto del canal y su nombre; Ir al chat abre la conversación correcta.
- Navegador real: confirmar una solicitud cambia la tarjeta de Hoy de Por confirmar a Confirmada al regresar sin recarga manual. Rechazarla la retira de Próxima cita.
- Confirmación programa recordatorios; rechazo los cancela en la base local.
- Portal, datos de reserva, equipo, revisión de solicitudes y tarjeta de próxima cita revisados a 320, 375, 390, 768, 1024 y 1440 píxeles CSS, sin desbordamiento horizontal. Aviso de Chats y revisión accesibles también a 320 × 500. Capturas y mediciones en output/business-journey, excluido de Git.
- Los proveedores del entorno local están aislados; las pruebas locales no envían correos ni WhatsApp reales ni efectúan cargos.

## Segunda pasada en producción

Joel redesplegó la entrega y activó la variable de invitaciones del stack.

- La cita original se confirmó desde Recepción y Hoy mostró Confirmada al regresar, sin recarga manual.
- Nuevo chat abrió el contacto existente y mantuvo dos conversaciones en ese momento, sin duplicarlo. Después llegaron otros contactos de la línea; no se usaron para pruebas ni se les enviaron mensajes.
- Se envió la confirmación al número autorizado. Ambos mensajes manuales figuran como Enviado a WhatsApp. También apareció el recordatorio automático de la cita confirmada.
- El portal publicado pide nombre y teléfono, sin correo; muestra dirección, promoción y enlaces configurados. El horario confirmado no aparece disponible.
- Otra solicitud independiente del día siguiente se rechazó con los dos botones previstos. Su enlace público mostró Cita cancelada y el motivo del negocio. La cita original se conserva.
- La invitación se creó sin duplicarse, llegó al buzón controlado y Joel creó la contraseña y la aceptó. El equipo muestra una membresía de Recepción con ocho permisos efectivos.
- Inicio de sesión real con Google como la persona invitada correcto. El menú y Configuración muestran sus secciones permitidas. Acceso directo a Mi negocio redirige a Hoy; facturación no expone la página; la API de invitaciones responde FORBIDDEN.

## Corrección del formulario de invitación

La indicación genérica de dejar los campos vacíos confundía a quien aún no tenía cuenta en el acceso nuevo. Ahora una invitación privada válida determina el formulario: nombre y contraseña obligatorios para una cuenta nueva; solo aceptar para una existente. Un enlace ya aceptado muestra la confirmación, incluso al recargar. La consulta no entrega el correo ni credenciales al navegador y rechaza tokens inválidos, revocados o vencidos.

Se traducen los estados de invitación al español. Además, el menú de un mensaje enviado sin autor visible deja de etiquetarlo como mensaje del cliente.

Validación de esta corrección: compilación correcta, 425 pruebas (423 aprobadas, dos opcionales omitidas), lint de código afectado y pruebas nuevas correcto. Tres estados del formulario revisados en los seis anchos CSS previstos, campos de 16 px y botón de 48 px; a 320 × 500 el formulario completo se alcanza con desplazamiento vertical. Evidencia local en output/business-journey.

## Pendiente

Esta entrega no requiere migraciones ni tablas. Joel realiza el redespliegue.

1. Redesplegar la corrección del formulario de invitación y repetir su presentación en producción.
2. Validar respuesta entrante de WhatsApp desde el número autorizado y, si corresponde, la respuesta automática del asistente. El chat controlado y el autopiloto siguen pausados; no se activaron respuestas a contactos ajenos a la validación.
3. Pruebas físicas en Android/Chrome e iPhone/Safari. La revisión adaptable de escritorio no sustituye esa validación.
4. Cobro real y renovación los valida Joel con las cuentas vencidas, según su decisión. El cupón no acredita el funcionamiento de un cargo real.

Las pruebas aprobadas cubren los casos descritos; no certifican todas las combinaciones posibles ni respuestas futuras de un modelo.
