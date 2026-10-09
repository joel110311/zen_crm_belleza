# Suscripción mensual con Mercado Pago

La integración agrega Suscripciones (`/preapproval`) al Checkout Pro existente. **No convierte los pagos individuales ni registra renovaciones sin autorización del propietario.** Stripe sigue deshabilitado. La prueba interna y cualquier periodo ya pagado se conservan; el inicio se programa después de ambos.

## Funcionamiento

- El propietario acepta el precio, la moneda y la renovación mensual mediante una casilla sin seleccionar. El servidor verifica que el importe aceptado siga vigente.
- Se crea una autorización `pending` y se abre el checkout alojado por Mercado Pago México. No se reciben ni guardan tarjetas en el CRM.
- Se conserva una reserva única por negocio, el entorno y aplicación originales, el precio aceptado y la versión de consentimiento. Un timeout de creación **no** dispara otro POST. Una creación incierta requiere reconciliación o revisión de soporte; no se libera sólo por antigüedad.
- Autorizar, regresar del checkout o recibir un webhook no concede acceso. Cada ciclo se verifica mediante `/authorized_payments/{id}` y `/v1/payments/{id}`: aplicación, entorno, importe, moneda, referencia y fecha.
- Un ciclo aprobado concede su periodo mensual de calendario una sola vez. Una transacción con bloqueo por negocio evita duplicados simultáneos. Los ciclos atrasados no añaden meses extra ni sobrescriben periodos nuevos.
- Cancelar renovación requiere una confirmación y respuesta de Mercado Pago. Se conserva el periodo pagado. No implica reembolso ni detiene un débito ya procesándose. Si falla la conexión, se mantiene la reserva y se reintenta la cancelación solicitada durante la reconciliación.
- Los pagos rechazados generan avisos por correo (requieren Resend configurado) y en facturación. El plazo de recuperación usa `TrialPolicy.graceDays`, tres días si no hay política, anclado al vencimiento y sin reiniciarse con cada reintento. Durante ese plazo el CRM queda en sólo lectura; después, sólo facturación. No se eliminan datos ni se levanta una suspensión administrativa.
- El worker de eliminación no borra un negocio mientras exista una autorización recurrente sin cancelación confirmada. Necesita conectividad con el servicio web para confirmar la cancelación; un fallo queda pendiente de reintento.
- Cambiar precios del catálogo no cambia contratos autorizados. Los cambios voluntarios del propietario usan el mismo acuerdo, conservando su fecha de renovación, con la confirmación descrita abajo.

## Mejorar o bajar el plan

- Disponible para suscripciones automáticas autorizadas con un periodo mensual **pagado y vigente**. No convierte pagos individuales anteriores ni cobra mejoras durante la prueba.
- El propietario consulta primero un importe válido por diez minutos; consultar no cobra. Una casilla inicialmente vacía acepta expresamente el proporcional de hoy y el nuevo importe mensual. El precio se verifica otra vez al aceptar.
- Al subir de $200 a $500, el proporcional es `(500-200) × tiempo restante / duración real del periodo`. Se calcula en centavos, con los límites y duración del mes pagado (no se supone que todos tienen treinta días). Con quince días restantes de un periodo de treinta días, serían $150 hoy.
- Ese proporcional se paga por Checkout Pro. No es otra mensualidad ni extiende el acceso. Sólo se activa el nuevo plan tras aprobar el pago y confirmar, por API, el cambio de precio del **mismo** acuerdo recurrente. La próxima renovación cobra $500, no $200 más $500.
- Una bajada no cobra hoy. Cambia el importe de la siguiente renovación, manteniendo el plan y sus funciones actuales hasta terminar el periodo pagado. El siguiente pago aprobado aplica el plan menor; si falla, se usa la política de recuperación y no se concede otro mes.
- Se permite un cambio confirmado por periodo. El historial conserva precios de ciclos anteriores, para verificar pagos tardíos o devoluciones correctamente. Tras confirmar la siguiente renovación se libera la posibilidad de otro cambio.
- Se bloquean cambios dentro de la hora anterior al corte, o cuando Mercado Pago ya preparó un cobro con otro importe. Es una restricción de seguridad: actualizar el estado y esperar la renovación; no abrir otra suscripción como alternativa.
- Si la cancelación, el cambio de periodo o un cobro ya preparado impiden aplicar una mejora pagada, se solicita devolver el proporcional con una clave idempotente. No se muestra como devuelto hasta verificar el estado real del pago. Ante timeout del cambio de precio se lee el acuerdo y se recupera el mismo cambio, sin repetir el cobro.
- El worker también recupera pagos proporcionales sin webhook, por referencia exacta. No concede funciones a partir del retorno del navegador. Una eliminación de cuenta espera los cambios/pagos/devoluciones pendientes; la contabilidad del proporcional nunca cuenta como mensualidad.

## Despliegue gradual (todavía no activado en producción)

1. Respaldar la base de control. Aplicar **antes de actualizar web/workers** las migraciones con la nueva imagen:

   ```sh
   node migrate-control-plane.mjs
   ```

   El comando debe ejecutarse en el provisioner/entorno de migraciones ya configurado. Las migraciones `20261008020000_mercado_pago_subscriptions` y `20261008030000_mercado_pago_plan_changes` son aditivas; no tocan bases de datos de los clientes ni eliminan registros existentes. El servicio web nunca aplica migraciones. Aunque se despliegue con la bandera desactivada, ambas deben estar aplicadas antes de web/workers: readiness verifica el esquema.

2. En el stack agregar las variables presentes en `portainer-stack.crm-belleza.yml`:

   ```dotenv
   MERCADO_PAGO_SUBSCRIPTIONS_ENABLED=false
   BILLING_RECONCILIATION_SECRET=
   ```

   Generar un secreto aleatorio exclusivo, de al menos 32 caracteres. El **mismo** valor debe llegar a web, billing-lifecycle-worker y account-deletion-worker. Los workers también necesitan `APP_BASE_URL=https://app.synapselogik.com`. No compartir el secreto ni almacenarlo en Git. Conserva las credenciales originales de ambos entornos para administrar contratos ya existentes, aunque cambies el selector del panel.

   Si las credenciales del vendedor de prueba automático pertenecen a otra aplicación, configurar `MERCADO_PAGO_TEST_APPLICATION_ID` con ese ID y `MERCADO_PAGO_PRODUCTION_APPLICATION_ID` con el ID productivo. Si se dejan vacíos, se conserva `MERCADO_PAGO_APPLICATION_ID`. No confundir el ID de usuario vendedor con el ID de aplicación ni aceptar un pago de otra aplicación para resolver una configuración incorrecta.

3. En la aplicación de Mercado Pago habilitar los eventos `payment`, `subscription_preapproval` y `subscription_authorized_payment` hacia:

   ```text
   https://app.synapselogik.com/api/webhooks/mercado-pago
   ```

   Suscripciones depende de la configuración del webhook de la aplicación, no de la `notification_url` enviada por Checkout Pro. Si se comparte la aplicación con Eventiia, **no sobrescribir su URL sin definir cómo se entregarán ambos productos**: configurar una URL adicional si el panel lo permite, un router de notificaciones verificado, o usar una aplicación dedicada. Comprobar que los Access Tokens y el secreto correspondan a la aplicación elegida.

4. Actualizar web y workers con la nueva imagen, manteniendo la bandera en `false`. Confirmar los nueve servicios y `/api/health?scope=ready`.
5. Seleccionar **Prueba** en `/control`, habilitar la bandera y autorizar con usuarios/medios de prueba oficiales. No usar tarjetas reales para probar. Verificar autorización, primer pago, próxima mensualidad, rechazo, cancelación desde CRM y desde Mercado Pago, notificación repetida, retorno sin pago y recuperación sin webhook. Probar además mejora proporcional, precio y fecha de la siguiente factura, bajada al siguiente periodo, respuesta perdida de actualización y devolución cuando no se puede aplicar. Confirmar también que el webhook de Eventiia siga funcionando si se comparte la app.
6. Sólo después de esta validación, seleccionar producción y ofrecer renovaciones reales. Desactivar la bandera impide **nuevas** autorizaciones; **no cancela** contratos existentes. La cancelación, los webhooks y la reconciliación permanecen disponibles.

La reconciliación lee un contrato por poll y tres ciclos por página, rotando por el historial. No inicia pagos ni nuevas suscripciones: Mercado Pago ejecuta las renovaciones autorizadas. Puede terminar la actualización de precio previamente consentida y solicitar una devolución pendiente de una mejora no aplicable. Sus errores quedan visibles en facturación y logs para soporte. Revisar los pendientes `CREATING`/`CHECKOUT_CREATING` antes de liberar reservas manualmente: podría existir un recurso externo aunque se haya perdido su respuesta.

## Verificación local

```sh
npm test
npm run lint
npm run build
node --experimental-strip-types tests/mercado-pago-subscriptions.integration.mts --database-url=postgresql://postgres@127.0.0.1:PUERTO/crm_recurring_test
```

La prueba de integración sólo admite localhost y una base desechable llamada `crm_recurring_test`. Aplica toda la cadena de migraciones, comprueba ciclos y mejoras simultáneas en PostgreSQL real, simula la siguiente renovación de $500 y la posterior bajada a $200 sin perder el periodo pagado, conserva el periodo tras cancelar y ejecuta el worker de vencimientos. Las respuestas de Mercado Pago son simuladas: **esto no sustituye la prueba con su sandbox ni certifica cobros reales**.

## Referencias oficiales

- [Suscripciones API](https://www.mercadopago.com.mx/developers/es/reference/online-payments/subscriptions/overview)
- [Autorización alojada con estado pending](https://www.mercadopago.com.mx/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Gestión y cancelación](https://www.mercadopago.com.mx/developers/es/docs/subscriptions/subscription-management)
- [Actualizar un acuerdo existente](https://www.mercadopago.com.mx/developers/es/reference/online-payments/subscriptions/update-preapproval/put)
- [Devoluciones idempotentes](https://www.mercadopago.com.mx/developers/es/reference/online-payments/checkout-pro-preferences/create-refund/post)
- [Búsqueda de pagos por referencia](https://www.mercadopago.com.mx/developers/es/docs/subscriptions/additional-content/payment-management)
- [Webhooks de Suscripciones](https://www.mercadopago.com.mx/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks)
