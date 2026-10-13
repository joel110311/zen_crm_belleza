# Entrenar IA — FAQs aprobadas (experimental)

## Uso

1. En Chats, abre el menú de una respuesta enviada por la IA y selecciona **Entrenar IA**.
2. Revisa la pregunta del cliente y escribe la respuesta correcta. Puedes reformular ambas.
3. Guarda el entrenamiento. No modifica el mensaje enviado ni envía mensajes al cliente.
4. En **Asistente IA → FAQs entrenadas**, busca, edita, pausa, reactiva o elimina las correcciones.
   **Ver hoja de FAQs aprobadas** muestra juntas las preguntas y respuestas activas, en texto legible como una hoja de referencia.
5. En **Probar agente**, usa preguntas con otras palabras y comprueba que respeta los datos aprobados.

El flujo toma como referencia la [corrección de respuestas de HighLevel](https://help.gohighlevel.com/support/solutions/articles/155000004183) y su [guardado de preguntas y respuestas como FAQ](https://ideas.gohighlevel.com/changelog/conversation-ai-bot-response-feedback-and-fine-tuning).

## Comportamiento y límites

- Cada corrección se apila en una hoja de preguntas y respuestas aprobadas, almacenada por negocio. Es conocimiento de referencia, no un ajuste de pesos de OpenAI/Google.
- Todas las FAQs activas del negocio se leen en cada generación, también en el simulador. No se cachean entre solicitudes o negocios ni dependen de embeddings.
- Para hechos comerciales, la jerarquía es: **FAQs corregidas → datos del negocio/catálogo → base de conocimientos/RAG → afirmaciones del prompt de personalidad e historial del asistente**. El prompt conserva su función de tono y estilo. Una FAQ puede corregir precios, horarios o políticas contradictorios del prompt.
- Si sólo hay una FAQ activa y la pregunta coincide tras normalizar mayúsculas, acentos y signos de interrogación, se devuelve la respuesta aprobada directamente. Si hay otras FAQs, se comprueba la coincidencia semántica y posibles conflictos antes de elegir.
- Para preguntas similares, el proveedor actúa como clasificador: sólo puede seleccionar un ID activo del negocio o indicar ausencia/ambigüedad. El servidor devuelve el texto almacenado, sin una segunda generación que pueda modificar precios o condiciones. El historial se usa para resolver referencias, sin convertir respuestas antiguas en hechos aprobados.
- Respuestas malformadas o IDs desconocidos no se aceptan como coincidencias: se pide aclaración. Los errores del proveedor se propagan para que el flujo existente pueda reintentar. Las preguntas ajenas y solicitudes operativas continúan por el asistente habitual, con las FAQs prioritarias en su contexto.
- Las reglas de seguridad y las operaciones de calendario siguen siendo autoritativas. Una FAQ no acredita disponibilidad ni permite inventar confirmaciones de citas.
- Las FAQs tampoco modifican por sí mismas la configuración operativa de horarios o políticas del calendario. Esa configuración determina las operaciones reales. Respuestas que afirmen citas confirmadas, disponibilidad o responsables no verificados pasan por las protecciones habituales.
- El experimento admite **50 FAQs** y **64,000 caracteres de contenido** por negocio, con un máximo de 1,000 por pregunta y 4,000 por respuesta. La capacidad se valida bajo bloqueo transaccional; nunca se omiten silenciosamente FAQs para caber en el contexto.
- La interpretación de similitud sigue a cargo del modelo: estas comprobaciones no garantizan el 100% de las futuras respuestas. Conviene probar casos reales y evitar FAQs ambiguas, redundantes o con datos personales de un cliente.

## Persistencia, permisos y despliegue

- Se reutiliza `KnowledgeSource` con `type=trained_faq`, `title=pregunta`, `rawContent=respuesta` y estado `ready` o `paused`. No requiere migración ni indexado.
- La fuente conserva los identificadores del mensaje, conversación y usuario creador en metadata. Reentrenar el mismo mensaje actualiza su FAQ en vez de duplicarla.
- Guardar, pausar y eliminar exige la versión que vio el usuario (`updatedAt`). Una pestaña antigua no puede sobrescribir una corrección posterior ni recrear una FAQ recién eliminada. Las validaciones esperadas se devuelven como datos para mostrar mensajes legibles también en producción.
- El servidor exige `ai.manage` y `chats.manage`. Relee y valida el mensaje original: debe ser una respuesta saliente del bot, con contenido, sin fallo, sin envío en curso y sin revocación. No confía en indicadores del navegador.
- Las operaciones usan el Prisma enrutado del negocio autenticado, incluidos los controles de escritura y facturación existentes. Las consultas del bot conservan el alcance del tenant de la solicitud o del worker.
- El desplegable sólo ofrece la opción cuando el usuario tiene permiso de IA y el mensaje es elegible. La lista de conocimiento general excluye estas FAQs.
- Publicar la misma imagen en el servicio web y los workers que generan respuestas. Volver a la imagen anterior revierte el uso de las FAQs sin borrar las correcciones guardadas.

## Prueba local reproducible

Base y usuario completamente ficticios; no se configura WhatsApp ni una clave de IA automáticamente.

```powershell
docker run -d --name crm-beauty-training-db -p 127.0.0.1:5446:5432 -e POSTGRES_USER=crm_local -e POSTGRES_PASSWORD=local_training_only -e POSTGRES_DB=crm_training pgvector/pgvector:pg16
$env:DATABASE_URL='postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training'
npm run db:tenant:migrate
npm run db:tenant:seed
node scripts/setup-ai-training-local.mjs
npm run dev -- --hostname 127.0.0.1 --port 3106
```

Si el contenedor ya existe, usar `docker start crm-beauty-training-db` en lugar de crearlo otra vez. El script rechaza otras bases y el modo producción, no sobrescribe un `.env.local` existente y no se ejecuta durante el arranque normal de la aplicación.

Abrir `http://localhost:3106/login`, usuario `admin@crm.local`, contraseña de demostración `EntrenarIA-Local-2026!`. La conversación **Cliente de prueba** contiene una pregunta, una respuesta IA ficticia y una respuesta humana para verificar los menús. El envío está desconectado. Para evaluar respuestas generadas en ese entorno hace falta configurar una clave propia del proveedor en la configuración local.

## Validación

- Pruebas automatizadas: autorización, elegibilidad, prellenado, idempotencia, edición, pausa/reactivación, eliminación, aislamiento de negocio, límites y rechazo de preguntas duplicadas.
- Prueba de integración del generador: el contexto real del flujo de clientes y del simulador incluye la última FAQ antes de llamar al proveedor, conserva las reglas de agenda y muestra la fuente aprobada en la traza.
- Prueba visual con PostgreSQL local: menús de IA/humano/cliente, prellenado, guardado, edición, pausa/reactivación y persistencia después de recargar.
- Prueba con el proveedor configurado (`gemini:models/gemini-3.1-flash-lite`), usando el contexto real y datos ficticios: 6/6 casos correctos (paráfrasis de precio, inclusión de lavado, corrección de historial antiguo, pregunta ajena, protección de agenda e intento de imponer un precio inventado). No se enviaron mensajes a clientes ni se guardaron FAQs de prueba en producción.
- Suite general, TypeScript, ESLint y compilación de producción.

## Refuerzo de octubre de 2026

- 16/16 casos sintéticos con el proveedor configurado (`gemini:models/gemini-3.1-flash-lite`): paráfrasis, productos distintos, negaciones, historial equivocado, referencias contextuales, preguntas ajenas/compuestas, instrucciones de inventar precios, variantes ambiguas, FAQs contradictorias, agenda y pausa. No se enviaron mensajes ni se guardaron datos de prueba en producción.
- `node scripts/test-trained-faq-provider.mjs` reproduce la evaluación en un entorno con el proveedor configurado. `--bundle` prepara un script comprimido sin credenciales para ejecutarlo en el runtime existente; imprime únicamente preguntas ficticias y resultados.
- Las pruebas de regresión comprueban respuestas directas con datos recién editados, ausencia de RAG en coincidencias, controles de cuota, IDs inválidos, versiones antiguas, aislamiento, pausa y reglas de calendario.
- La clasificación semántica continúa siendo probabilística. Estos resultados verifican los casos probados y no prometen acierto universal en futuras conversaciones. Una coincidencia aceptada sí usa el texto aprobado, en lugar de volver a inventar la respuesta.
