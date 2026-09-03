# Prueba de alta multitenant beta

## Propósito

Certificar el recorrido real de una cuenta nueva sin mezclar datos de clientes ni reutilizar una cuenta existente. El resultado esperado es una cuenta propietaria, una base PostgreSQL aislada y un CRM funcional para un único negocio de prueba.

## Antes de empezar

- Usar un correo que controle la persona que hará la prueba.
- Elegir un nombre de negocio de prueba y un slug distinto; no usar el nombre de un cliente real.
- Tener abierta la bandeja de entrada de ese correo.
- Registrar hora de inicio y conservar capturas de cada error, si aparece alguno.

## Recorrido

1. Abrir `https://app.synapselogik.com/signup`.
2. Completar nombre, negocio, correo, contraseña de al menos 12 caracteres y la aceptación legal.
3. Resolver Turnstile personalmente y enviar una sola vez. Debe aparecer el aviso de revisar el correo.
4. Abrir el correo de `soporte@synapselogik.com` y usar el enlace antes de 20 minutos. Debe mostrarse **Correo confirmado**.
5. Iniciar sesión con la misma cuenta. Mientras la base se prepara, el acceso puede mostrar la preparación del espacio; no volver a registrarse ni cambiar el slug.
6. Completar el wizard: negocio, horario, servicio y profesional inicial. Al terminar debe abrir `/t/{slug}/dashboard`.
7. Crear un servicio, un contacto, un paciente y una cita de prueba. Confirmar que aparecen en la agenda y que una recarga no duplica el registro.
8. Abrir una ventana privada, iniciar sesión con la misma cuenta y confirmar que se ve el mismo negocio. No se debe usar una cuenta de otro tenant en esta primera prueba.

## Evidencia de aceptación

- El correo llega una vez y el enlace no funciona por segunda vez.
- La misma cuenta inicia sesión y llega a su tenant, no al dashboard legacy.
- El tenant termina con estado `READY` y trial de siete días una vez que su base queda preparada.
- El health check `https://app.synapselogik.com/api/health?scope=ready` responde `ok: true` con `database` y `controlPlane` correctos.
- No aparece una contraseña, URL de base de datos ni token de proveedor en interfaz o correo.

## Si algo falla

- Capturar la URL, hora aproximada, texto exacto del error y una captura de pantalla.
- No reenviar el mismo formulario repetidamente: el registro limita intentos por seguridad.
- Si vence el enlace, comenzar un nuevo registro; los enlaces son de un solo uso por diseño.
- No activar todavía Stripe, portal público, invitaciones, canales ni almacenamiento privado: se prueban uno por uno después de certificar este flujo base.
