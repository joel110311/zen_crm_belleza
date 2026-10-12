# Planes mensuales

| Plan | Precio MXN/mes | Respuestas del chatbot por periodo | Recomendación |
| --- | --- | --- | --- |
| Esencial | $299 | 1,000 | Negocios con 1 o 2 lugares |
| Crecimiento | $499 | 3,000 | Negocios con 3 a 5 lugares |
| Elite | $799 | 10,000 | 6 o más sillas o multisucursal |

Todos incluyen agenda, catálogo y profesionales, clientes, portal de reservas y bandeja de WhatsApp. Las recomendaciones de tamaño no imponen límites de sillas o usuarios ni crean una nueva función de sucursales. Cada espacio contratado mantiene su propia suscripción y cupo; no se comparten automáticamente consumos entre espacios.

Una respuesta es un mensaje automático enviado a WhatsApp, incluidos adjuntos. Entrantes, mensajes manuales y simulador no consumen cupo. El periodo sigue el de la suscripción (o el mes UTC si no hay fechas); cambiar de plan dentro del mismo periodo no borra consumo. La prueba conserva su cupo existente de 500 respuestas durante la prueba, no una mensualidad adicional.

El contador está en Asistente IA, debajo de Responder automáticamente. Se actualiza al abrir, al recuperar el foco y cada minuto mientras la página está visible. Al agotar el cupo, sólo se detienen los envíos automáticos; la atención manual continúa.

## Aplicación y compatibilidad

Aplicar `npm run db:control:migrate` en el entorno configurado antes de publicar los cambios. La landing pública, facturación y checkout leen el catálogo real de la base. La vista local de landing comparte los valores de referencia de `src/lib/plan-catalog.ts`.

La migración nueva conserva IDs y los slugs `esencial`, `automatiza`, `pro`; los nombres visibles pasan a Esencial, Crecimiento y Elite. No editar migraciones anteriores ya aplicadas. Las referencias históricas conservan importes para conciliación.

No se reescriben pagos históricos ni se cambian automáticamente autorizaciones recurrentes existentes en Mercado Pago: sus importes requieren gestionar el cambio con consentimiento y confirmación del proveedor. Nuevas contrataciones usan $299 / $499 / $799 tras migrar. Los precios mensuales antiguos de Stripe quedan inactivos para evitar cobrar un importe diferente al mostrado; deben crearse precios nuevos antes de reactivar ese proveedor.

El control de cupo reserva una unidad bajo bloqueo de base por negocio antes de enviar y confirma el consumo al recibir un identificador del proveedor. Los fallos sin confirmación liberan la reserva. Reservas de procesos interrumpidos se conservan de forma preventiva; deben conciliarse con los mensajes/proveedor antes de liberarlas. El contador incluye reservas pendientes para no ocultar capacidad ya comprometida.
