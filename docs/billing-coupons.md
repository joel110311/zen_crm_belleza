# Cupones del CRM

18 de octubre de 2026. Adaptación del flujo de cupones de Eventiia a los planes mensuales del CRM. Usa Taste Skill, Redesign Existing Projects, y la identidad de `DESIGN.md`.

## Operación

- **Centro de mando → Cupones de bienvenida:** generar códigos aleatorios de 50% o 100%, elegir uno o varios planes, límite de usos y fecha/hora de vencimiento. Consultar códigos, copiar, pausar y reactivar. Los parámetros comerciales de un código emitido son inmutables; para otra promoción se genera otro código. La fecha del formulario y de la lista usa la zona del dispositivo.
- **Plan y facturación → ¿Tienes un cupón?:** seleccionar plan, consultar código, revisar importe y confirmar el canje. Esencial cuesta $149.50 con 50%, Crecimiento $249.50 y Elite $399.50. El cupón de 100% no pide tarjeta ni llama a Mercado Pago.
- **Un mes de calendario por promoción, una promoción por negocio.** El mes comienza al finalizar cualquier prueba vigente; si ya venció, comienza al activar/cobrarse. No se acumulan promociones ni se aplican sobre un periodo de plan vigente. Una autorización automática pendiente debe administrarse antes del canje.
- El mes promocional **no autoriza renovación automática**. Después, el propietario contrata la suscripción al precio normal mediante el consentimiento y checkout recurrente existentes. Puede hacerlo antes del vencimiento: el inicio recurrente respeta el periodo promocional, igual que los periodos ya pagados.
- La prueba gratuita sigue independiente. **Centro de mando → Prueba y recuperación de pago** conserva las opciones de **7 o 14 días** para nuevos registros. No se modifica `TrialPolicy`, su valor predeterminado, la política contra repetir pruebas ni la fecha/duración de las pruebas ya iniciadas. Los avisos de vencimiento de prueba no se envían cuando un plan activo cubre un periodo posterior.
- Mientras sigue la prueba, el chatbot conserva su cupo de prueba. El cupo del plan promocional empieza en su fecha de inicio; no se consume anticipadamente por haber canjeado el cupón.

## Integridad

La consulta del cupón no consume usos. Una transacción bloquea primero el negocio y después el cupón; vuelve a validar vigencia, plan, límite e importe. Se conserva una fotografía del precio y una sola reserva activa por negocio. El servidor exige propietario, mismo origen y limita las consultas; generar o pausar requiere administrador de plataforma. Cada cambio queda en auditoría.

Con 50% se reserva un uso y se crea un intento del checkout individual existente con el importe descontado. Ni el enlace ni volver del checkout activan acceso. El webhook verifica el pago canónico, aplicación, entorno, moneda e importe del intento antes de conceder un mes una sola vez. Los cambios posteriores de catálogo no alteran ese precio aceptado. Una devolución conserva la prueba ordinaria restante y no devuelve el uso del cupón. El 100% concede su periodo atómicamente, sin fabricar un pago aprobado ni una venta; no suma al MRR estimado.

**Canjeados** cuenta beneficios concedidos; **reservados** incluye pagos todavía no confirmados. El límite incluye ambos. Los reintentos con un enlace ya creado reutilizan ese enlace. Si Mercado Pago rechaza inequívocamente la creación, se libera el uso y se conserva el registro fallido. Ante timeout o resultado incierto se mantiene la reserva: no se repite el POST ni se libera por antigüedad, ya que podría existir un pago externo. Soporte debe revisar el intento/referencia en Mercado Pago; esta entrega no incorpora una liberación manual que pueda causar sobrecanjes. Pausar impide nuevas reservas; no revoca beneficios ni pagos ya emitidos. Eliminar una cuenta no repone usos: se conserva un registro sin identidad/contacto ni relación con el negocio eliminado.

## Migración y publicación

Esta entrega **sí requiere migración del plano de control**:

`prisma/control-plane/migrations/20261018010000_billing_coupons/migration.sql`

Agrega `BillingCoupon` y `BillingCouponRedemption`. No altera bases de los negocios, precios, pruebas ni acuerdos recurrentes existentes. No crea cupones de producción automáticamente.

1. Esperar la imagen del commit publicado y conservar un respaldo de la base de control y la imagen anterior.
2. Ejecutar `node migrate-control-plane.mjs` con la imagen nueva en el entorno de migraciones/provisioner ya configurado, antes de actualizar web/workers. La salud de readiness exige ambas tablas.
3. Actualizar web y billing-lifecycle-worker. El worker anterior sigue siendo compatible con las tablas aditivas, pero sólo el actualizado evita avisos de prueba que ya está cubierta por una promoción.
4. Confirmar readiness, réplicas y acceso al panel/facturación. No cambiar secretos, entorno de Mercado Pago, webhook compartido con Eventiia ni las credenciales de clientes para instalar cupones.

Para volver a la imagen anterior se conservan las tablas y periodos concedidos. No borrar tablas con promociones/pagos emitidos. La migración y pruebas locales no acreditan por sí mismas un despliegue productivo.

## Validación

- `npm test`: pruebas de políticas, precios en centavos, validación, acceso por propietario/administrador, origen y límites, además de regresiones existentes.
- `node --experimental-strip-types tests/billing-coupons.integration.mts --database-url=postgresql://USUARIO:CLAVE@127.0.0.1:PUERTO/crm_coupons_test`: sólo admite esa base local desechable. Aplica todas las migraciones, prueba carreras por el último uso, canje concurrente, precios aceptados, webhook repetido, devoluciones, suspensión y respuestas inciertas. Las APIs de Mercado Pago están simuladas: no realiza cobros reales.
- Navegador local: generación, consulta, importes y canje de 100%; revisión en 320, 375, 390, 768, 1024 y 1440 px y poca altura. Evidencias privadas ignoradas en `output/coupons/`.

Resultado de esta entrega: **387 pruebas, 385 aprobadas, 2 omisiones existentes, 0 fallos**; integración PostgreSQL completa, compilación de producción con TypeScript, ESLint de archivos afectados y diff correctos. Canje gratuito completado desde el navegador local: una sola suscripción, la prueba intacta, un uso registrado y MRR cero. Campos de 16 px, acciones de al menos 44 px y sin desbordamiento horizontal en los seis anchos efectivos. En oscuro con Pink se comprobaron fondo negro y tarjetas `#1e1e1e`; el acento no tiñe las superficies.

La validación comercial completa con proveedores y dispositivos físicos queda para el recorrido posterior solicitado por Joel. No se certifican una compra real del 50% ni la renovación real desde esta prueba local.
