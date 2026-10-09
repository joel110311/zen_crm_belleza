# Configurar Checkout Pro como en Eventtia

Para renovación mensual automática, consultar [Suscripciones de Mercado Pago](./mercado-pago-subscriptions.md). Checkout Pro sigue disponible como **pago de un solo mes**, no como autorización recurrente.

El CRM crea una preferencia por negocio y plan en `/checkout/preferences`, redirige al comprador a Mercado Pago y confirma el pago consultando `/v1/payments/{id}` después de validar la firma del webhook. Sólo un pago aprobado, con la aplicación, moneda e importe esperados, habilita o extiende un mes de acceso. Checkout Pro no realiza una renovación automática: el cliente vuelve a pagar para renovar.

Mercado Pago es el proveedor predeterminado de esta etapa. Stripe no aparece en el formulario de precios, su portal y webhook quedan deshabilitados y el worker no ejecuta activaciones programadas. Los registros históricos se conservan y no bloquean un nuevo Checkout de Mercado Pago. Esta desactivación en el CRM **no cancela suscripciones externas existentes en Stripe**; comprueba cualquier contrato real directamente en Stripe antes de cambiar el proveedor de un cliente. Reactivar Stripe en una segunda etapa requiere explícitamente `BILLING_PROVIDER=stripe` y `BILLING_STRIPE_ENABLED=true`.

Al guardar precios de Mercado Pago se conserva el catálogo histórico de Stripe sin modificarlo ni borrarlo.

## 1. Credenciales en Portainer

En el stack `crm-belleza`, abre **Editor → Environment variables**. Las credenciales y el Application ID deben pertenecer a la misma aplicación de Mercado Pago. No copies valores al YAML ni al repositorio.

```dotenv
BILLING_PROVIDER=mercado_pago
BILLING_STRIPE_ENABLED=false
MERCADO_PAGO_ENABLED=true
MERCADO_PAGO_ENVIRONMENT=test
MERCADO_PAGO_APPLICATION_ID=
MERCADO_PAGO_TEST_ACCESS_TOKEN=
MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=
```

El secreto compartido funciona como en Eventtia. Si tu configuración de Mercado Pago tiene secretos diferentes por entorno, deja vacío el compartido y completa los siguientes; cada uno tiene prioridad sobre el compartido:

```dotenv
MERCADO_PAGO_TEST_WEBHOOK_SECRET=
MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET=
```

Conserva el proveedor anterior hasta completar los valores si vas a guardar el stack antes de terminar la configuración. Los cambios del editor de Portainer no quedan persistidos hasta actualizar el stack. Espera a que la nueva imagen termine de construirse en GitHub antes de actualizarlo.

## 2. Webhooks en Mercado Pago

En **Tus integraciones**, abre la aplicación cuyos tokens usarás. En **Webhooks → Configurar notificaciones**, selecciona el evento **Pagos (`payment`)** y configura la URL de pruebas y producción del CRM:

```text
https://app.synapselogik.com/api/webhooks/mercado-pago
```

Copia la clave secreta de esa aplicación a `MERCADO_PAGO_WEBHOOK_SECRET` (o al campo específico de cada entorno). El Access Token y la clave secreta del webhook son datos distintos. Conserva la configuración de la aplicación Eventtia para sus propios cobros.

La URL del CRM también se envía como `notification_url` al crear cada preferencia. `APP_BASE_URL` debe corresponder a `https://app.synapselogik.com` para que los retornos y notificaciones se dirijan al dominio correcto.

## 3. Probar y activar

Después de actualizar el stack, entra a `https://app.synapselogik.com/control`. En **Entorno de Mercado Pago**, selecciona **Prueba**, guarda y comprueba que el token, Application ID y firma aparezcan configurados. En multitenant, este selector tiene prioridad sobre `MERCADO_PAGO_ENVIRONMENT`.

Verifica el Checkout con los usuarios y medios de prueba indicados por Mercado Pago, y simula una notificación de un pago de prueba desde su panel. Confirma que un pago aprobado extienda una sola vez el acceso del negocio y que una notificación repetida no duplique la mensualidad. El retorno del navegador por sí solo no confirma el pago.

Cuando completes la validación y las credenciales productivas, selecciona **Producción** en el centro de mando. Comprueba también los precios de los planes antes de compartir el enlace de facturación con clientes.

## Referencias

- [Checkout Pro y Preferences API](https://www.mercadopago.com.mx/developers/es/reference/online-payments/checkout-pro-preferences/overview)
- [Configurar y validar Webhooks](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro-preferences/additional-content/notifications/webhooks)
