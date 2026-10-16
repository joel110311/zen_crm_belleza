# Primera optimización de rendimiento verificada

16 de octubre de 2026. Comparación contra `2994f387ae2d93bc4a81ad31a65d63f6013f1c27`.

Joel condicionó la implementación a demostrar una mejora y conservar las funciones y la cantidad de chats. Se aceptan tres cambios medidos y acotados; las modificaciones más amplias del diagnóstico no forman parte de esta entrega.

## Cambios aceptados

1. **Una sola actualización en Chats.** El notificador global ya se desactivaba en `/dashboard/inbox`. Ahora reconoce también `/t/<negocio>/inbox`, donde la propia bandeja conserva sus consultas, sonidos y contadores. No cambia la frecuencia de llegada de mensajes ni las notificaciones de otras pantallas.
2. **Evitar escrituras sin cambios del actor local.** Después de leer la identidad global y el usuario local vigente, omite la transacción y el UPDATE si correo, nombre y rol coinciden. No introduce caché de permisos ni omite la validación de acceso. Los cambios, altas, vinculaciones, conflictos y la proyección pendiente de profesionales mantienen sus rutas originales.
3. **Procesamiento del historial con índice por ID.** Se extraen los mismos tipos y funciones de mensajes a `src/lib/inbox-messages.ts`. La deduplicación deja de recorrer todo el historial para cada mensaje persistido; mantiene las reglas anteriores para envíos pendientes, proveedores, remitentes, archivos y ventana de 15 segundos. Los límites de 300 conversaciones por carga, 5,000 acumuladas y páginas de 75 mensajes siguen intactos.

## Comparación reproducible

Comandos desde la raíz del repositorio:

```powershell
node --experimental-strip-types scripts/benchmark-inbox-performance.mts
node --experimental-strip-types scripts/benchmark-workspace-overhead.mts
```

El primer script carga las funciones reales del commit anterior y las actuales, con el mismo cierre de módulo, entradas y entorno. Antes de medir comprueba 1,200 resultados diferenciales con datos deterministas: pendientes, IDs repetidos, mensajes reales idénticos, medios y orden de llegada. Calienta cada operación y toma la mediana de 21 muestras por caso.

Última corrida aceptada en Node v24.13.0, sobre CPU local:

| Operación | Mensajes | Antes | Después |
|---|---:|---:|---:|
| Deduplicar | 75 | 0.208 ms | 0.040 ms |
| Deduplicar | 1,000 | 9.301 ms | 0.160 ms |
| Deduplicar | 5,000 | 153.488 ms | 0.802 ms |
| Unir una actualización al historial | 5,000 | 154.029 ms | 1.298 ms |

Esto mide funciones de mensajes, **no** la velocidad total de la aplicación, 5,000 conversaciones en navegador, ni latencia de producción. Los números varían con el equipo y la carga.

El segundo script ejecuta los servicios y efectos reales con I/O simulado y comprueba resultados iguales:

- Notificador adicional dentro de la ruta de Chats por negocio: 17 consultas en los primeros 60 segundos, incluido el arranque, → cero. Las consultas propias de la bandeja siguen activas. En Inicio: 17 → 17; en Chats legacy: cero → cero.
- Treinta resoluciones de un propietario sin cambios: 30 escrituras y 30 transacciones → cero; 60 lecturas → 60. El resultado y los permisos son iguales. No es una prueba de carga de PostgreSQL.

Solo se conservaron cambios con resultados favorables en estas comparaciones. Se descartaron las primeras mediciones que utilizaban un contexto de VM desigual o sin un cierre de módulo equivalente; la evidencia válida es `accepted-message-benchmark.json` y `overhead-benchmark.json`.

## Regresión y navegador

- Suite completa: 349 pruebas; 347 aprobadas, dos omitidas y cero fallos. Incluye 13 pruebas nuevas de reconciliación, notificaciones y actor local.
- Compilación de producción y TypeScript correctos. ESLint enfocado correcto; `git diff --check` correcto.
- La suite detectó una suposición preexistente en la prueba de factura recurrente histórica: usaba 30 días aunque producción utiliza meses de calendario. Se corrigió únicamente esa fixture, conservando los escenarios de prorrateo de 30 días. No cambia el código de facturación.
- Navegador local, negocio de prueba con 27 conversaciones y ocho mensajes en la conversación inspeccionada. Se verificaron cambio de cliente, borrador aislado y recuperado, búsqueda, menú de mensajes de IA y restricción de la ventana Meta cerrada.
- Anchos CSS 320, 375, 390, 768, 1024 y 1440: mismos chats/mensajes, sin desbordamiento horizontal. Sin cambios de JSX de la interfaz, estilos ni temas. No se enviaron mensajes, crearon citas o guardaron entrenamientos.
- Evidencia local: `output/performance-audit/`, con las comparaciones JSON, capturas, mediciones de geometría y registros de pruebas, lint y compilación.

No es una certificación de ausencia de errores futuros, ni una prueba física en iOS/Android o de entrega real por WhatsApp.

## Lo que sigue bajo evaluación

La virtualización del listado, separación del editor, reducción de cargas de Clientes/Agenda, medios bajo demanda y retirada completa de Pipeline requieren sus propias comparaciones y regresiones. En especial, Pipeline comparte lógica con captura de datos de IA, campañas y fichas: borrar sus dependencias sin separarlas incumpliría la condición de conservar las funciones. Borrar solamente sus componentes sin uso no demuestra una mejora de la carga de Chats.

No se cambian esas rutas en esta primera entrega ni se promete que los tres cambios resuelvan toda la pesadez percibida. La evaluación siguiente debe medir escritura, desplazamiento y navegación con volúmenes representativos, manteniendo los límites actuales.

## Publicación

Sin migraciones, tablas nuevas ni dependencias añadidas. Entrega mediante commit y push a `origin/main`; Joel realiza el redespliegue.
