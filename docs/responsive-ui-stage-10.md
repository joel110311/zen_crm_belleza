# Décima entrega: acceso, registro y recuperación

15 de octubre de 2026. Interfaz web existente. Sin migraciones ni tablas nuevas; Joel realiza el redespliegue.

## Revisión con Taste Skill

Se aplica Redesign Existing Projects de https://github.com/Leonxlnx/taste-skill a los formularios existentes. Se conserva la identidad del CRM: colores por tema, fuente e iconos. Son pantallas de acceso al producto; no se rehace la landing ni se añaden fotografías o animaciones de marketing.

La auditoría encontró títulos y bienvenida repetidos en login, un formulario desplazado hacia abajo en celular, páginas de recuperación sin una salida constante y estilos distintos entre rutas. El widget de seguridad de tamaño normal necesita 300 px interiores y podía exceder el espacio disponible en celulares estrechos. La recuperación sin token presentaba campos que no podían completar la operación.

| Hallazgo | Mejora |
|---|---|
| Bienvenida y títulos duplicados | Un título por tarea y descripción breve, con el formulario primero en celular |
| Apariencia distinta entre rutas | Shell compartido para acceso, registro, solicitud de enlace, contraseña y verificación de correo |
| Formulario comprimido o decoración excesiva | Una columna en celular/tableta, introducción breve y formulario en escritorio; sin fondos de manchas ni sombras decorativas |
| Contraseña difícil de revisar | Campo compartido con control de mostrar/ocultar, nombre accesible y área de 44 px |
| Enlace de recuperación ausente | Aviso y acceso a solicitar otro enlace; no muestra un formulario inutilizable |
| Esperas y errores poco explicados | Estados pendientes y de resultado, campos bloqueados mientras se envía, error junto al formulario |
| Verificador demasiado ancho | Turnstile compacto de 150 × 140 px, con espacio reservado y estado de carga/error si falla el script |
| Salidas inconsistentes | Volver a iniciar sesión, inicio de marca y enlaces de privacidad/términos; salto al formulario y foco visible |

## Comportamiento conservado

Los contratos de login, Google, signup-intents, confirmación y recuperación permanecen iguales. Se conservan los límites de contraseña, aceptación legal inicialmente desmarcada, Turnstile, controles de habilitación, huella e idempotencia del registro y redirecciones comprobadas por el servidor. No cambian autenticación, permisos, tokens, plazos, correo, facturación ni aislamiento de negocios. El aviso sobre comprobante digital y CFDI permanece en registro.

El cliente añade guardas de envíos pendientes y de token ausente. La verificación de seguridad del servidor sigue siendo obligatoria. La limpieza del widget retira sus listeners y temporizador al desmontar; un fallo al cargar no queda como espacio sin explicación.

## Verificación

- Compilación de producción, TypeScript, ESLint de archivos afectados y diff sin errores.
- Suite completa: **314 aprobadas, 2 omitidas, 0 fallidas**, de 316 pruebas. Se añaden cuatro regresiones de recuperación y dos del widget: token ausente, contraseñas diferentes, contrato y bloqueo pendiente, respuesta de error, invalidación del token, carga fallida y limpieza. I/O externo simulado.
- **42 combinaciones** de siete rutas/estados por seis anchos CSS efectivos: **320, 375, 390, 768, 1024 y 1440 px**. Sin desbordamiento horizontal detectado; botones del formulario de al menos 44 px y campos de 16 px.
- Vistas: login, registro, solicitud de enlace, recuperación sin token, formulario con token ficticio, verificación inválida y error de acceso Google.
- **320 × 500**: se puede desplazar hasta el botón final del registro y de recuperación; se guardan capturas y geometría. El registro largo continúa en la página y no recorta la acción con un pie fijo.
- Se probó mostrar/ocultar contraseña, error con credenciales ficticias incorrectas y acceso correcto con el propietario local existente, que llega a su dashboard. Claro y oscuro revisados; se restaura Claro/Green.
- Evidencia: `output/responsive-ui-stage-10/qa-layout.json`, `qa-low-height.json`, `login-mobile-final.png`, `login-desktop-final.png`, `login-dark-final.png` y capturas por ruta/ancho. Algunas capturas del login contienen únicamente las credenciales ficticias de la cuenta local de pruebas; las muestras finales quedan vacías.

Para ver las rutas habilitadas se usaron únicamente variables del proceso local: claves oficiales de prueba de Turnstile y credenciales ficticias de correo, sin editar archivos de entorno ni configuración de producción. El widget de prueba se vio dentro del ancho disponible; el navegador registró un error 300030 de Cloudflare durante la revisión. No se declara validado el resultado de un desafío real. No se resolvieron CAPTCHAs, crearon cuentas, aceptaron términos, enviaron correos, autorizaron Google ni cambiaron contraseñas reales. Esas operaciones se cubren sólo con I/O simulado donde hay pruebas, no con una ejecución externa completa.

Pendientes: revisión física Android/Chrome e iPhone/Safari, correo/CAPTCHA de producción, reservas públicas, invitaciones, legales y revisión integral de los módulos vigentes.

## Consulta sobre la pestaña de Mercado Pago

La configuración local de Codex contiene `mcp_servers.mercadopago` ejecutando `npx -y mcp-remote@latest https://mcp.mercadopago.com/mcp`. El paquete instalado (0.15.1) llama a `openBrowser` al iniciar la autorización OAuth. Se encontró un proceso activo de ese conector. La búsqueda del endpoint de autorización y del endpoint MCP en `src`, `scripts` y `package.json` del CRM no encontró coincidencias.

La URL facilitada solicita autorización del conector MCP y vuelve a un callback local. Esto identifica su origen en el conector de herramientas, separado de la contratación del CRM. No se autorizó ni se cambió su configuración. La recurrencia exacta del aviso requiere observar cuándo se reinicia o intenta autenticarse el conector; no se atribuye a un cambio de interfaz.

Referencias: [MCP en Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [tamaños de Turnstile](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/) y [claves de prueba](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
