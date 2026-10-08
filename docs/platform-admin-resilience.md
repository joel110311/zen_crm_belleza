# Acceso administrativo y contención de fallos

## Diagnóstico del 8 de octubre de 2026

El `/control` anterior devolvía `notFound()` ante cualquier excepción durante la
autorización, incluyendo una cuenta sin privilegios y errores de infraestructura.
Producción tenía nueve servicios activos. La cuenta de prueba del propietario no
era administradora de plataforma; existía otra cuenta administrativa por correo.
No se modificaron permisos ni contraseñas de esas cuentas para resolverlo.

## Acceso dedicado, estilo Eventiia

- URL: `/control/login`.
- `ADMIN_USERNAME=adminjoel`.
- `ADMIN_PASSWORD`: secreto exclusivo del CRM, de 20 a 128 caracteres. Nunca
  reutilizar el de otro desarrollo ni escribirlo en Git, imágenes Docker o logs.
- Las variables se pasan únicamente al servicio web, no a los workers ni a los tenants.
- Sin contraseña válida configurada, este acceso está desactivado. El acceso previo
  por correo continúa disponible.
- Auth.js gestiona CSRF y la sesión cifrada/HttpOnly. El proveedor dedicado valida
  la contraseña en el servidor con comparación de tiempo constante y límite de intentos
  tanto local como compartido entre réplicas (tabla de seguridad del plano de control).
- La identidad interna reservada se inicializa de manera transaccional y auditada
  únicamente después de validar las credenciales. No requiere crear un negocio,
  aceptar invitaciones ni registrar otro correo.
- La identidad no tiene contraseña por correo ni acceso Google. No obtiene acceso
  operativo a las APIs de negocios o legacy. El proxy también bloquea esos accesos.
- Cambiar usuario/contraseña o vaciar la contraseña invalida las sesiones de este
  acceso en la siguiente comprobación de autenticación. Una revocación explícita
  del permiso en la base de control no se deshace al iniciar sesión.
- El login del panel y el del CRM usan la misma sesión del navegador. Para operar
  un negocio después de entrar como `adminjoel`, inicia sesión con la cuenta de ese
  negocio, o utiliza otro perfil del navegador.

## Contención y recuperación

- Sin sesión: login administrativo. Cuenta sin permiso: aviso explícito, sin cargar
  datos protegidos. Error inesperado: recuperación de la sección, no un falso 404.
- El panel no hereda la base del negocio recordado en la cookie.
- Límites de conexión: `DATABASE_CONNECTION_TIMEOUT_MS` (5000 por defecto) y de
  sentencias: `DATABASE_STATEMENT_TIMEOUT_MS` (60000). Las migraciones no usan estos
  límites de runtime. Una sentencia interrumpida dentro de una transacción revierte
  esa transacción; no se reintentan escrituras automáticamente.
- Los errores de conexiones idle se atienden sin imprimir credenciales.
- Los clientes en creación cuentan para el límite de caché. No se desaloja un pool
  con conexiones prestadas o solicitudes esperando. Saturación: error temporal local,
  sin cerrar la transacción de otro negocio ni cambiar a la base legacy.
- Las tareas programadas recorren los demás negocios si uno falla; se registra el
  fallo para diagnóstico y se vuelve a recorrer en el siguiente ciclo del worker.
- Límites de recuperación de interfaz en `/control`, páginas y layouts de `/t`,
  aplicación y layout raíz; nunca muestran mensajes SQL o de proveedor sin filtrar.
- APIs administrativas distinguen validación (400), autorización (401/403), conflictos
  (409), indisponibilidad conocida (503) y error inesperado (500).

## Verificación y despliegue

Las pruebas simulan autorización, rotación, fallos de conexión, límites simultáneos,
transacciones activas y errores en tareas de un negocio. No provocan fallos en producción.
También se verifican los destinos de login y el bloqueo de acceso operativo de la
identidad dedicada. Ejecutar `npm test`, `npm run lint`, `npm run build`.

Este cambio no necesita nuevas migraciones. Desplegar una imagen identificada por
commit en web y tenant worker; mantener PostgreSQL, Redis y gateway QR sin cambios.
En Portainer también hay que agregar las dos variables administrativas al entorno
del servicio web. No activar una contraseña por defecto o tomada de Eventiia.

Estas defensas reducen la propagación de fallos de aplicación, pero no equivalen a
alta disponibilidad: los tenants comparten servidor PostgreSQL, infraestructura y
plano de control. Una caída de esas dependencias comunes puede afectar a todos.
Antes de escalar, calcular el presupuesto total de conexiones (caché × pool por
tenant × réplicas, más control, legacy y workers), probar una restauración real de
respaldo y planear redundancia. No prometer disponibilidad absoluta.
