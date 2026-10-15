# Octava entrega: Plan y facturación

15 de octubre de 2026. Interfaz web existente; no requiere migraciones ni tablas nuevas. Joel realiza el redespliegue.

## Revisión con Taste Skill

Se aplica la guía `redesign-existing-projects` instalada desde https://github.com/Leonxlnx/taste-skill. La skill principal `design-taste-frontend` está orientada a páginas públicas y excluye pantallas de aplicación; su flujo de imágenes y animaciones de marketing no corresponde a esta vista interna.

La auditoría encontró el estado de la cuenta después del catálogo, información repetida en tres tarjetas, precios con alturas distintas, texto pequeño y controles sin suficiente espacio en celular. Se revisaron código y capturas del estado anterior antes de cerrar los ajustes.

| Hallazgo | Mejora aplicada |
|---|---|
| Estado del negocio debajo del catálogo | Estado y administración primero; accesos a Mi plan, Comparar planes y Uso y pagos |
| Diferencias de alineación entre planes | Cabeceras y recomendaciones alineadas, cifras tabulares y precio/moneda/periodo explícitos |
| Información extensa antes de decidir | Cupo de IA visible; funciones completas en Qué incluye; condiciones y uso desplegables |
| Texto comprimido y navegación larga | Una columna en celular/tableta; tres planes cuando hay espacio; enlace Uso y pagos breve |
| Controles pequeños o sin foco evidente | Botones y desplegables de al menos 44 px; foco visible, respuesta al pulsar y movimiento reducido |

Se conservan colores, fuente e iconos del sistema aprobado. Las recomendaciones de la skill se aplican según la tarea: no se añaden fotos, texturas ni animaciones decorativas a los controles de cobro. No se ha auditado nuevamente toda la aplicación con Taste Skill en esta entrega.

## Comportamiento conservado

Esencial $299/1,000 respuestas, Crecimiento $499/3,000 y Elite $799/10,000 al mes; importes, recomendaciones y límites provienen del catálogo existente. Renovación, consentimiento inicialmente desmarcado, cambios de plan, cancelación y proveedor mantienen sus flujos. Se añaden guardas de operaciones pendientes en los controladores de botones. Los estados de suscripción se presentan en español.

Autorización y pago aprobado siguen siendo estados diferentes. Se conserva el aviso de retención, exportación del propietario, condiciones fiscales y enlace de eliminación de cuenta. Ningún endpoint, política de permisos, cálculo de cobro ni esquema de base cambia.

Reportes y la antigua Caja ya estaban retirados: sus rutas redirigen al dashboard y siguen fuera del alcance. Pipeline permanece retirado por decisión de Joel.

## Verificación

- Compilación de producción, TypeScript y ESLint de archivos afectados correctos; `git diff --check` sin errores.
- Suite: **305 aprobadas, 2 omitidas, 0 fallidas** (307 pruebas). Incluye las regresiones de consentimiento y contratación mensual; los tests de componentes simulan la importación CSS que normalmente procesa Next.js.
- Edge en anchos CSS efectivos **320, 375, 390, 768, 1024 y 1440 px**: texto, planes y controles sin desbordamiento horizontal detectado. También confirmación de cancelación a 320 × 500 y 390 × 320; se puede desplazar y volver sin cancelar.
- Fixtures locales para prueba activa, suscripción activa, autorización pendiente, pago vencido y renovación cancelada. Se verifican bloqueos de una segunda contratación mientras existe autorización y disponibilidad del consentimiento tras cancelación. Detalles de funciones, pagos y cupos se despliegan correctamente.
- Capturas y mediciones: `output/responsive-ui-stage-8/`. Los controles verificados miden al menos 44 px de alto. La medición de geometría no equivale a una auditoría integral de accesibilidad.

`scripts/setup-responsive-billing-local.mjs` sólo funciona con ambas URLs exactas de las bases dedicadas en localhost:5446 y fuera de NODE_ENV=production. No crea tablas ni llama al proveedor; rechaza negocios con otros registros de facturación. El entorno queda con prueba activa, sin acuerdos ficticios de facturación.

No se realizaron pagos, autorizaciones, cotizaciones de cambio de plan, sincronizaciones ni cancelaciones reales de Mercado Pago. Sus integraciones se cubren con las pruebas existentes con I/O simulado; no se declara una comprobación bancaria de extremo a extremo. Pendiente revisión en teléfonos físicos Android/Chrome e iPhone/Safari.

Siguiente bloque: configuración e integraciones, después accesos/pantallas públicas y revisión integral de los módulos vigentes con la guía de rediseño.
