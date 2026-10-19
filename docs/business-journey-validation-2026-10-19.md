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

## Pendiente después del redespliegue

Esta entrega no requiere migraciones ni tablas. Joel realiza el redespliegue.

1. Repetir las correcciones anteriores en producción y confirmar la cita real del recorrido.
2. Enviar y aceptar una invitación controlada; comprobar correo, acceso y límites de Recepción. El envío que concede acceso requiere confirmación en el momento de hacerlo.
3. Validar respuesta entrante de WhatsApp desde el número autorizado y, si corresponde, la respuesta automática del asistente.
4. Pruebas físicas en Android/Chrome e iPhone/Safari. La revisión adaptable de escritorio no sustituye esa validación.
5. Cobro real y renovación los valida Joel con las cuentas vencidas, según su decisión. El cupón no acredita el funcionamiento de un cargo real.

Las pruebas aprobadas cubren los casos descritos; no certifican todas las combinaciones posibles ni respuestas futuras de un modelo.
