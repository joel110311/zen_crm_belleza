# Entrega 14: recuperación de acceso y reintentos de verificación

17 de octubre de 2026. Sin migraciones ni tablas nuevas. Joel redespliega esta corrección.

## Diagnóstico real de producción

Se confirmó que GitHub terminó correctamente la imagen del commit anterior `0edfc99`. Producción respondió a readiness con base principal y plano de control sanos; la búsqueda en español está activa. Los servicios de la stack se observaron en 1/1.

Para investigar el correo ausente se consultaron únicamente conteos y estados mediante la consola del contenedor web. El correo de pruebas autorizado no tenía usuario en el plano de control, usuario en la base anterior, intento de registro pendiente ni registros de envío de recuperación. Por tanto, esa solicitud no podía generar un enlace de recuperación. No se crearon usuarios, cambiaron contraseñas o modificaron permisos para alterar este resultado.

Se envió **un solo mensaje de diagnóstico** desde el contenedor de producción, con el remitente y la credencial existentes de Resend, al destinatario de pruebas autorizado. Resend respondió HTTP 200 y el mensaje **Prueba de entrega de Zen CRM** se encontró y abrió en Gmail, en Recibidos. Esto comprueba transporte y entrega a ese buzón; no equivale a una recuperación completa, ya que no existía la cuenta. No se cambiaron la configuración del proveedor ni sus claves. La consola se desconectó después de las consultas.

Evidencia privada e ignorada por Git: `output/auth-validation/mail-received.png`, `mail-diagnostic.png`, `mail-compatibility.png`. No se incluyen direcciones personales, credenciales ni enlaces de recuperación en este documento.

## Errores corregidos

- Registro y solicitud de recuperación limpiaban el token tras un error de envío, pero mantenían montado el widget que ya lo había emitido. Ahora montan una verificación nueva para el siguiente intento, conservando los campos del formulario.
- Un fallo al cargar/verificar Turnstile sólo ofrecía recargar toda la página. Ahora ofrece **Reintentar verificación**. Si falló la descarga del script, se carga de nuevo; si ya existe la API, se retira y vuelve a crear el widget. Los callbacks de un widget retirado no pueden restaurar tokens viejos. Un éxito posterior limpia el error. El contenedor vacío se oculta en el estado fallido.
- Registro, solicitud de recuperación y cambio de contraseña bloquean un segundo envío inmediatamente con una referencia, incluso antes del siguiente render de React.
- Recuperación indicaba **Revisa tu correo** de forma que podía interpretarse como un envío confirmado. Ahora indica **Solicitud recibida** y **Si este correo está registrado, recibirás un enlace para restablecer tu contraseña**. Incluye salida a registro para quien no tiene cuenta. El servidor conserva la misma respuesta pública para una cuenta existente, inexistente o con fallo del proveedor; no se expone la existencia de usuarios.

Se aplicó Taste Skill, Redesign Existing Projects: cambios concretos sobre los componentes existentes, con los mismos colores neutros, acentos, tipografía e iconos. No se sustituyeron los controles de seguridad ni se añadió un modo de pruebas al código desplegable.

La renovación del widget sigue la [gestión de ciclo de vida de Turnstile](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/); sus tokens son [de un solo uso](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). Para la revisión de error en local se usaron las [claves oficiales de prueba que siempre fallan](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), únicamente en el proceso local con bases aisladas y credencial ficticia de correo. Producción conserva sus claves reales.

## Validación

- **380 pruebas: 378 aprobadas, 2 omitidas existentes, 0 fallidas**. Las omisiones corresponden al módulo opcional de router Gemini.
- Compilación de producción, TypeScript incluido en la compilación, ESLint de los archivos afectados y comprobación del diff correctos.
- Diez regresiones nuevas y ampliación de la prueba de recuperación: reinicio del widget/script, rechazo de callbacks retirados, error y desconexión en ambos formularios, doble envío antes del render, token nuevo para reintentar, cuenta inexistente sin correo, enlace HTTPS y hash persistido para cuenta registrada, registro FAILED cuando el proveedor rechaza el envío y respuesta pública uniforme.
- Navegador en **320, 375, 390, 768, 1024 y 1440 px CSS**, para registro y solicitud de recuperación, incluyendo el error de verificación. Sin desbordamiento horizontal; campos de 16 px y botones de acción de al menos 44 px. Capturas y mediciones en `output/auth-validation/qa-layout.json` y `signup-*.png` / `recovery-*.png`.
- A **320 × 500** se comprobó desplazamiento hasta el botón de registro, el reintento y el enlace de acceso. Captura `signup-low-height.png`. No se introdujeron contraseñas nuevas, aceptaron términos o enviaron registros mediante el navegador.

## Pendientes externos

Para probar un enlace real de recuperación con ese correo hace falta crear y verificar primero su cuenta, o usar otra cuenta de pruebas ya registrada. La entrada de una contraseña nueva debe completarla Joel, conforme a la política del control del navegador. También queda la comprobación final de Google con la cuenta activa, una invitación real en un espacio de pruebas y los recorridos físicos en Android/Chrome e iPhone/Safari. Las pruebas simuladas de envío y las capturas de Edge no certifican esos recorridos externos.
