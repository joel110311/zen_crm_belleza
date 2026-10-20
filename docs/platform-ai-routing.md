# Proveedores de IA desde el panel de control

La configuración de texto se administra en **/control → Proveedores de IA de la plataforma**. Se aplica a los negocios existentes y a los nuevos en sus próximas solicitudes; no se copia a sus bases ni aparece como ajuste en el CRM del cliente.

## Uso

1. Seleccionar el modelo oficial principal. El catálogo incluido incorpora Gemini 3.5 Flash-Lite, 3.6 Flash, 3.8 Flash y 3.1 Pro Preview, además de opciones existentes. **Actualizar modelos Gemini** consulta la API de la cuenta oficial; conserva opciones locales si esa consulta falla. No existe una opción inventada «3.6 Flash-Lite».
2. Agregar Groq, una cuenta adicional de Gemini u otro proveedor compatible con OpenAI. Capturar nombre, base URL y API Key. Al salir de los campos completos se consulta el catálogo; también puede usarse **Consultar modelos**.
3. Elegir un modelo de la lista devuelta por ese endpoint. Si no ofrece catálogo, puede escribirse el identificador manualmente.
4. Pulsar **Probar conexión**. Envía únicamente un mensaje sintético breve, sin datos de clientes. Verifica que el modelo devuelva texto y muestra la duración; puede consumir tokens. Consultar o probar no guarda ni activa el proveedor.
5. Activar los proveedores deseados, subirlos o bajarlos y habilitar **Usar prioridad y respaldos**. Guardar. Con esta opción apagada permanece el flujo anterior del modelo oficial principal.

Las plantillas reproducen los endpoints y nombres de modelos de la referencia zen_crm_go; la disponibilidad final depende de cada cuenta. Las claves ocultas de la captura no pueden recuperarse de la imagen ni del repositorio y deben capturarse en el panel. Las claves oficiales existentes siguen en los secretos del despliegue. Audio, imágenes y embeddings conservan su implementación actual.

## Persistencia y protección

- Se reutiliza PlatformRuntimeSetting con la clave ai.runtime. **No requiere migraciones ni tablas nuevas.**
- Las claves adicionales se cifran con AES-256-GCM y un dominio criptográfico exclusivo derivado de TENANT_CREDENTIALS_ENCRYPTION_KEY. Se conserva la versión de llave y una revisión para detectar formularios antiguos.
- La UI recibe únicamente metadatos y apiKeyConfigured. Una clave vacía conserva la existente; cambiar la URL requiere capturarla de nuevo. Cambiar de modelo en el mismo endpoint conserva la cuenta.
- Sólo administradores de plataforma pueden consultar, probar o modificar la configuración. Las mutaciones comprueban el origen; las pruebas tienen un límite por administrador.
- Sólo se admiten endpoints HTTPS públicos. El transporte comprueba y fija la dirección DNS del request, rechaza direcciones internas, no sigue redirecciones y limita la respuesta.
- Las auditorías registran modelo, activación y cantidad de proveedores, sin claves ni conversaciones. Los errores de proveedores no exponen sus cuerpos al navegador ni a los logs del router.

## Prioridad y respaldos

El router conserva el contexto y prueba únicamente proveedores habilitados, en el orden guardado. Una respuesta correcta evita llamadas a los siguientes. Fallos HTTP, de conexión o respuestas vacías permiten continuar. El máximo por proveedor es configurable entre 1.5 y 10 segundos, con un máximo total de 20 segundos por solicitud cuando el router está activo. Fallos de cuota, autenticación o conectividad producen una pausa de 30 segundos en ese proceso; errores de payload 400/422 no bloquean las siguientes solicitudes del proveedor.

El catálogo y los respaldos no cambian el cupo de respuestas al cliente, la cantidad de chats ni las reglas de entrenamiento. Un fallo al leer la configuración central no elige silenciosamente otro proveedor.

## Referencias

- Implementación adaptada de joel110311/zen_crm_go, revisión e085621, router-config.ts, openai-compatible.ts y openai.ts. Su configuración por negocio se reemplazó por configuración central cifrada.
- [Catálogo oficial de Gemini](https://ai.google.dev/gemini-api/docs/models?hl=en), [compatibilidad OpenAI de Gemini](https://ai.google.dev/gemini-api/docs/openai) y [API de Groq](https://console.groq.com/docs/api-reference), consultados el 20 de octubre de 2026.

La revisión de navegador local y los tests no certifican la cuota, disponibilidad o calidad de todas las cuentas externas; las credenciales reales deben comprobarse mediante el botón del panel después del redespliegue.

## Validación de esta entrega

- Compilación de producción correcta; 448 pruebas: 446 aprobadas y dos opcionales omitidas. Lint de los archivos afectados correcto.
- Pruebas de orden, respuesta vacía, 400 frente a 429, pausa temporal, proveedor desactivado, ausencia de respaldo implícito, errores seguros, cifrado, preservación de claves, formularios obsoletos, cambio de endpoint y modelos recientes.
- Pruebas del transporte con DNS fijado, bloqueo de IP privadas, redirecciones, cancelación, desconexión y consulta GET /models. Diagnósticos protegidos por administrador/origen y con un prompt sintético fijo, sin eco de secretos.
- Navegador real local: agregar Groq y Gemini, ordenar, guardar claves ficticias cifradas, campos vacíos tras guardar y selección persistente de Gemini 3.5 Flash-Lite tras recargar.
- Consulta y prueba contra Groq con credencial ficticia: HTTP 401 mostrado como fallo, sin afirmación de éxito. Los casos de catálogo y respuesta correctos se cubrieron con transporte simulado; falta comprobarlos con claves reales de las cuentas elegidas.
- Anchos efectivos de 320, 375, 390, 768, 1024 y 1440 píxeles CSS: sin controles fuera del viewport, campos de 16 px y botones de al menos 44 px. Guardado alcanzable a 320 × 500. Capturas y mediciones en output/platform-ai, excluido de Git.
