# Segunda optimización de rendimiento

16 de octubre de 2026. Continúa la primera entrega `24a41110dd2d66c22db9f17769692392bd92effb`. Conserva los límites de Chats: 300 por carga, hasta 5,000 acumulados y páginas de 75 mensajes (máximo solicitado de 150).

## Cambios y evidencia

- **Escritura en Chats:** reutiliza los elementos de conversaciones y mensajes mientras el texto o adjunto del editor cambia. Búsqueda, selección, nuevos mensajes, reacciones, permisos, zona horaria y contadores invalidan sus respectivas dependencias. Las actualizaciones sin cambios conservan referencias y los contadores inalterados no producen otro estado. No se virtualiza ni recorta el historial.
- **Clientes:** la lista recibe métricas y las citas necesarias para actuar, en vez del historial completo. La ficha continúa consultando todo el historial. Conserva exportación, selección, edición de cita y recordatorios. Las métricas se calculan en una pasada; 1,200 historiales aleatorios dieron resultados idénticos al código anterior, incluidos empates. La lista se actualiza al llegar la hora de su próxima cita.
- **Agenda:** consulta un mes con semanas de margen, incluyendo citas que se solapan con el periodo. Un enlace directo añade la cita solicitada aunque esté fuera de esa ventana. Mantiene filtros, calendarios autorizados, zona horaria, DST y navegación a otros meses. Descarta respuestas de consultas antiguas y conserva la vista Mes/Semana/Día al cambiar de periodo.
- **Carga inicial:** formularios de cita, visor de imágenes, entrenamiento y cuadrícula de escritorio se cargan al necesitarlos. La lista móvil no monta la cuadrícula oculta; seleccionar Calendario explícitamente sigue disponible. Audios precargan metadatos en lugar del archivo completo. La configuración regional ya leída por el servidor se comparte dentro del negocio, evitando solicitudes repetidas por componente; legacy mantiene su consulta de respaldo.
- **Pipeline retirado:** elimina tablero, editores, drag-and-drop y tres dependencias de dnd-kit. Chats, búsqueda, campañas, enriquecimiento y Clientes dejan de crear, mover o consultar oportunidades. APIs antiguas responden 410 tras autorizar y las páginas antiguas redirigen a Clientes. La captura y puntuación de IA viven en `Contact.aiState`. No se borran tablas ni datos históricos; exportación, deduplicación y eliminación explícita de contactos conservan el tratamiento de esos registros.

### Comparación reproducible

```powershell
node --experimental-strip-types scripts/benchmark-workspace-final.mts
```

Misma CPU local, Node v24.13.0, mediana de 21 muestras tras calentamiento. El arnés ejecuta el JSX real de la página y controla el estado de hooks; no ejecuta efectos, red o componentes hijos.

| Trabajo al escribir una tecla | Antes | Después |
|---|---:|---:|
| Construir vista con 300 chats y 75 mensajes | 7.057 ms | 0.114 ms |
| Construir vista con 5,000 chats y 1,000 mensajes | 125.716 ms | 0.107 ms |
| Formateos de teléfono por tecla, segundo caso | 5,001 | 1 |
| Formateos de fecha por tecla, segundo caso | 6,999 | 0 |

Un cliente sintético con 120 citas: JSON de 172,823 a 2,794 bytes, **98.38% menos**, con las mismas métricas. Incluye duplicación del historial en la relación de pacientes como ocurre en la consulta anterior. La reducción depende de la cantidad real de citas y notas; no representa el porcentaje de mejora de toda la aplicación.

Estas mediciones cubren CPU de construcción y serialización, no pintura del navegador, latencia de red ni carga de PostgreSQL de producción. No se afirma que la aplicación completa sea 60 o 1,000 veces más rápida.

## Validación

- Pruebas de contratos de datos, invalidación de render, métricas, migración, captura de IA, rechazo de datos desde imágenes, enriquecimiento, STOP y deduplicación sin Pipeline.
- Pruebas de consultas por intervalo, solapamiento, permisos, calendarios visibles, citas enlazadas, DST, límites de año y configuración regional entre negocios.
- Compilación de producción, TypeScript y ESLint enfocado correctos. Suite completa: 366 pruebas, 364 aprobadas, dos omitidas, cero fallos. Registros locales en `output/performance-final/`.
- Navegador Edge con compilación de producción y bases locales aisladas: 27 chats y 35 clientes; búsqueda, borradores separados, acciones de IA, carga de entrenamiento, formulario desde Clientes, ficha con dos citas, cuadrícula al pasar a escritorio y navegación a noviembre conservando Mes.
- Capturas de Chats, Clientes y Agenda a 320, 375, 390, 768, 1024 y 1440 píxeles CSS. También entrenamiento y cita a 320 × 500, con desplazamiento y acciones accesibles. Se conserva el diseño aprobado de Taste y los temas neutros. No es una prueba física en iOS/Android.
- No se enviaron mensajes ni guardaron citas o entrenamientos durante estas pruebas de interfaz. El canal externo no estaba conectado en el entorno local; la entrega de WhatsApp no se certifica con estas pruebas.

## Migración y orden de publicación

**Esta entrega sí requiere migración antes de arrancar la nueva web o el nuevo worker.** Añade una columna JSONB, sin tablas nuevas. Copia la última captura/puntuación disponible y las etiquetas históricas al contacto. Es idempotente y no sobrescribe un `aiState` ya existente.

Archivos: `prisma/tenant-migrations/20261016000000_contact_ai_state/migration.sql`, espejo Prisma general y `prisma/legacy-runtime-migrations/20261016_contact_ai_state.sql`. Probada con PGlite y aplicada con Prisma a la base local `crm_training`.

1. Esperar imagen del commit en GitHub Actions. Conservar imágenes anteriores y respaldo de base conforme al procedimiento operativo.
2. Pausar el consumidor de trabajos de tenants y esperar que termine el turno en curso. Mantener recepción de webhooks en cola. Así el worker anterior no modifica la captura histórica mientras se copia.
3. Actualizar primero el provisioner a esa imagen. Su comando debe ejecutar `node migrate-control-plane.mjs` antes del bucle de provisión; ese script aplica las migraciones a todos los tenants READY y verifica permisos de runtime. Si el comando desplegado no incluye ese paso, ejecutar `node migrate-existing-tenants.mjs` en el provisioner con sus variables administrativas existentes. No trasladar la URL administrativa a la web.
4. Aplicar también la migración legacy si la base compartida se utiliza. Usar su migrador y una conexión con privilegios de migración; no confundir bases de WhatsApp con las del CRM.
5. Verificar columna, backfill y migración terminada en las bases utilizadas. Actualizar web y worker al mismo commit, restaurar réplicas originales y comprobar readiness, acceso autenticado, cola, captura de IA y consultas de Chats/Clientes/Agenda. No actualizar Redis, gateway ni PostgreSQL.
6. Si la aplicación falla, conservar la columna y restaurar las imágenes anteriores. La migración es aditiva; no ejecutar DROP como rollback. Antes de volver definitivamente a un worker anterior, reconciliar la captura creada después del cambio, porque el esquema anterior la guardaba por oportunidad.

No considerar producción actualizada únicamente porque GitHub construyó la imagen. Registrar por separado migración, imagen efectiva y salud.
