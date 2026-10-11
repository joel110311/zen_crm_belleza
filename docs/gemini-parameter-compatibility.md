# Compatibilidad de parámetros de Gemini — octubre de 2026

Las solicitudes directas a Google pasan por `prepareGeminiPayload` antes de serializarse.
Se eliminan `temperature`, `topP/top_p`, `topK/top_k`, `candidateCount/candidate_count`
y el antiguo `thinkingBudget/thinking_budget`. Los mensajes, archivos, límites de salida,
esquemas JSON y ajustes de seguridad se conservan.

Los niveles de razonamiento se validan por modelo:
- Gemini 3.1/3.5 Flash-Lite: `minimal` por defecto.
- Gemini 3.6 Flash y Gemini 3 Flash Preview: `low` por defecto.
- Gemini 3.7/3.8 Flash: `low` por defecto; no se envía `minimal`.
- Modelos no reconocidos: se omite el nivel para usar el predeterminado de Google.

Cuando existe el router de proveedores compatibles, las solicitudes a modelos Gemini,
incluidos los que pasan por un proxy, o al host oficial de Google omiten los parámetros
de muestreo. Groq, OpenAI y los demás proveedores mantienen su configuración.

Gemini 2.5 Flash no puede ejecutarse: las selecciones antiguas del proveedor integrado
se normalizan a Gemini 3.1 Flash-Lite y las solicitudes personalizadas a 2.5 Flash se
rechazan antes de enviarse. No hay un respaldo oculto a modelos Gemini anteriores.

## Validación y despliegue

`node --experimental-strip-types --test tests/gemini-config.test.mts tests/gemini-request.test.mts`
comprueba la configuración y ejecuta las rutas reales de chat/OCR con respuestas HTTP
simuladas. El simulador responde HTTP 400 si recibe parámetros obsoletos. Las pruebas
no envían datos ni consumen tokens de una cuenta real.

El cambio requiere construir y desplegar una nueva imagen de la aplicación y actualizar
los workers que utilicen la misma imagen. No requiere migraciones de base de datos,
cambios de claves ni cambios de orden del router. La versión anterior desplegada continúa
enviando sus parámetros hasta que se actualice.

Tras desplegar, verificar una conversación de prueba y una imagen sintética con los
proveedores configurados. Confirmar que no hay errores INVALID_ARGUMENT de Google y que
el respaldo respeta el orden guardado. La compatibilidad comprobada corresponde a los
cambios anunciados, no a posibles cambios futuros ajenos a esos parámetros.

## Referencias oficiales

- https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6
- https://ai.google.dev/gemini-api/docs/generate-content/thinking
