# Zen CRM Belleza

CRM para negocios de belleza con clientes, servicios, agenda y reservas públicas, caja, WhatsApp, recordatorios y personalización de marca.

El modo actual es mono-tenant por stack: cada instalación usa su propia aplicación y base. La plataforma está en transición a una aplicación compartida con una base PostgreSQL por tenant, control plane central y alta automática desde la landing. El plan y sus criterios de salida están en [docs/multitenant-implementation-plan.md](docs/multitenant-implementation-plan.md).

Para la plataforma nueva, el host canónico será `app.synapselogik.com`; el procedimiento de corte y las variables de Portainer se documentan en [docs/app-synapselogik-rollout.md](docs/app-synapselogik-rollout.md).

## Stack

- `zen-crm`: Next.js + Prisma + pgvector
- `zen-crm-db`: PostgreSQL con extension vector
- `whatsapp-gateway`: WuzAPI sobre Go / whatsmeow para login por QR

## Funciones principales

- Inbox de WhatsApp con takeover humano / IA
- Recepcion y envio de texto, imagen, audio, video y documentos
- Plantillas internas
- Pipeline editable con etapas y presets
- Base de conocimiento con texto, archivos, URLs, sitemap, GitHub y YouTube
- Agenda interna y sincronizacion con Google Calendar
- Scoring comercial y captura de datos del lead

## Seguridad de claves IA

Por defecto, el CRM **no usa silenciosamente** `OPENAI_API_KEY` ni `GEMINI_API_KEY` del contenedor.

La prioridad ahora es:

1. clave guardada por el cliente en `Configuracion > IA`
2. variables de entorno **solo** si `ALLOW_ENV_AI_FALLBACK=true`

Para despliegue SaaS por cliente, la recomendacion es:

- `ALLOW_ENV_AI_FALLBACK=false`
- que cada cliente guarde su propia clave en `Configuracion > IA`

## Despliegue con Docker / Portainer

Para la instalación independiente de Belleza en Portainer usa `portainer-stack.crm-belleza.yml` y carga las variables de `portainer.crm-belleza.env.example`.

Este stack publica las imágenes:

- `ghcr.io/joel110311/zen_crm_belleza:latest`
- `ghcr.io/joel110311/zen_crm_belleza_db:latest`

Sus servicios, bases de datos y volúmenes tienen nombres propios y no comparten datos con una instalación de Oftalmología.

Para instalaciones genéricas también puedes usar `docker-compose.zen-crm.yml`.

### Inicialización de una base tenant

La aplicación ya no altera su propia base al arrancar. El provisionador debe ejecutar primero, con la `DATABASE_URL` de una base nueva:

```bash
npm run db:tenant:migrate
npm run db:tenant:seed
```

El seed sólo crea la configuración mínima y las etapas del pipeline; no genera usuarios ni contraseñas. En la plataforma SaaS, la identidad y la membresía se crearán desde el control plane. No ejecutes estos comandos como parte del proceso web ni como una actualización ciega de una instalación legacy.

Para Portainer, toma como base las variables de `portainer.env.example`.
Si quieres un stack ya orientado a un subdominio de ejemplo, usa tambien `portainer-stack.example.yml`.
Si quieres el flujo mas facil posible de copiar/pegar en Portainer, usa `portainer-stack.quickstart.yml`.

### Variables requeridas

- `POSTGRES_DB`
- `POSTGRES_PASSWORD`
- `WUZAPI_ADMIN_TOKEN`
- `WUZAPI_DB_PASSWORD`
- `WUZAPI_GLOBAL_ENCRYPTION_KEY`
- `WUZAPI_GLOBAL_HMAC_KEY`
- `AUTH_SECRET`
- `AUTH_URL`
- `APP_BASE_URL`
- `WHATSAPP_WEBHOOK_BASE_URL`
- `APP_DOMAIN`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`

### Variables opcionales

- `INITIAL_ADMIN_NAME`
- `WUZAPI_USER_TOKEN`
- `WHATSAPP_INSTANCE_NAME`
- `SESSION_DEVICE_NAME`
- `TRAEFIK_NETWORK`
- `TRAEFIK_ENTRYPOINT`
- `TRAEFIK_CERTRESOLVER`
- `STACK_SLUG`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ALLOW_ENV_AI_FALLBACK`
- `TZ`
- `STARTUP_DB_MAX_ATTEMPTS`
- `STARTUP_DB_RETRY_MS`

### Alta pública multitenant (acceso anticipado)

No actives `MULTITENANT_PUBLIC_SIGNUP_ENABLED=true` hasta que el control plane y sus migraciones estén listos. El registro público queda deliberadamente apagado si falta cualquiera de estas variables:

- `MULTITENANT_RUNTIME_ENABLED=true`
- `MULTITENANT_AUTH_ENABLED=true`
- `MULTITENANT_PUBLIC_SIGNUP_ENABLED=true`
- `CONTROL_DATABASE_URL` (base PostgreSQL exclusiva del control plane, usando un rol runtime sin `CREATEDB`, `CREATEROLE` ni `SUPERUSER`)
- `TENANT_POSTGRES_ADMIN_URL` sólo en `provisioner`; nunca en web ni `tenant-worker`
- `CONTROL_DATABASE_REQUIRE_LEAST_PRIVILEGE=true` para impedir un despliegue accidental con el rol administrativo en la web
- `APP_BASE_URL=https://app.synapselogik.com` (o el dominio público final)
- `SECURITY_HASH_SALT` (secreto aleatorio independiente)
- `TURNSTILE_SECRET_KEY` y `TURNSTILE_SITE_KEY` (se lee en ejecución; se conserva compatibilidad con `NEXT_PUBLIC_TURNSTILE_SITE_KEY`)
- `RESEND_API_KEY`, `EMAIL_FROM` (remitente verificado) y `EMAIL_REPLY_TO` opcional

El alta primero guarda una intención y evidencia de aceptación legal; sólo un enlace de correo de un solo uso crea usuario, tenant y trabajo de provisionamiento. Antes de abrir tráfico real, ejecuta `npm run db:control:migrate` y verifica que el provisionador aplique las migraciones tenant nuevas.

### Equipo y portal público multitenant

Las invitaciones y el portal nuevo se activan por separado para que el stack legacy continúe intacto durante la transición:

- `MULTITENANT_INVITATIONS_ENABLED=true` exige runtime/auth multitenant, `RESEND_API_KEY`, `EMAIL_FROM`, URL pública y `SECURITY_HASH_SALT`. Crea invitaciones de siete días con token HMAC, controla los asientos (`BillingEntitlement` `seats`, o 5 durante beta) y permite revocar invitaciones o desactivar membresías sin borrar el historial local.
- `MULTITENANT_PUBLIC_PORTAL_ENABLED=true` hace que `/portal/{tenantSlug}` resuelva el tenant sólo en el control plane. Sólo abre una DB `READY`, en modo `FULL`, con portal publicado; no utiliza `DATABASE_URL` legacy. Las reservas usan un apartado de siete minutos en su propia tabla, exclusión PostgreSQL por intervalo e idempotencia; los enlaces de gestión almacenan únicamente su hash.

Mantén ambas banderas en `false` hasta desplegar las migraciones de control y tenant, configurar el secreto HMAC y realizar la prueba interna descrita en `docs/app-synapselogik-rollout.md`.

### Canales y archivos privados multitenant

- `MULTITENANT_CHANNELS_ENABLED=true` abre únicamente las rutas `/api/t/{slug}/v1/channels` y los webhooks opacos por tenant. Requiere runtime/auth multitenant, `SECURITY_HASH_SALT` y `TENANT_CREDENTIALS_ENCRYPTION_KEY`. Meta requiere además `META_APP_ID`, `META_APP_SECRET` y `META_EMBEDDED_SIGNUP_CONFIG_ID`; WuzAPI requiere `MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY` y, si se desea configuración automática, `MULTITENANT_WUZAPI_BASE_URL`.
- `MULTITENANT_PRIVATE_STORAGE_ENABLED=true` requiere un bucket S3 compatible privado y las variables `TENANT_STORAGE_S3_*`. Las subidas se realizan con `PUT` firmado por diez minutos y se confirman con `HEAD`; la aplicación guarda sólo clave, hash, MIME y tamaño. Nunca se entrega una URL pública permanente.
- El perfil `multitenant` incluye `tenant-worker`. Es el único proceso que aplica `WebhookEvent` a una DB tenant y que borra objetos; no recibe `DATABASE_URL` legacy ni monta `public/uploads`. Inícialo junto con el provisionador tras aplicar las migraciones.

Mientras las banderas estén apagadas, los paneles y rutas legacy continúan funcionando sin cambio. Las cargas nuevas por tenant no pasan por `/api/upload` ni por `public/uploads`.

### Arranque

```bash
docker compose -f docker-compose.zen-crm.yml up -d
```

### Recomendacion para Portainer (modo legacy por instancia)

1. crea un stack nuevo
2. pega el contenido de `docker-compose.zen-crm.yml`
3. carga las variables de `portainer.env.example` adaptadas al cliente
4. asigna un `APP_DOMAIN` unico por cliente, por ejemplo `crm.cliente.com`
5. asigna un `STACK_SLUG` unico por cliente, por ejemplo `zencrm-cliente-a`
6. deja `ALLOW_ENV_AI_FALLBACK=false` para que el CRM no use claves IA del servidor
7. al pasar a la plataforma SaaS, ejecuta el provisionador antes de levantar el proceso web

Con esto evitas choques de routers/servicios de Traefik al desplegar varias instancias.

### Despliegue rapido tipo "copiar y pegar"

Si quieres algo mas parecido a tu stack anterior:

1. abre `portainer-stack.quickstart.yml`
2. cambia solo los valores marcados al inicio del archivo
3. pegalo completo en Portainer
4. despliega el stack

Ese archivo ya incluye:

- app
- base de datos
- base de datos dedicada para WuzAPI
- gateway de WhatsApp
- router Traefik con `tls=true`
- healthcheck
- reintentos de arranque contra PostgreSQL
- volumenes persistentes
- labels de Traefik

Importante:
- Zen CRM y WuzAPI usan bases separadas dentro del stack. Esto evita conflictos de esquema y problemas con las migraciones internas del gateway.

## Primer acceso

En una base nueva, el contenedor crea automaticamente:

- estructura base de la app
- pipeline inicial limpio
- un usuario `SUPERADMIN` con los datos definidos en `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_PASSWORD`

Luego:

1. entra al CRM
2. ve a `Configuracion > WhatsApp`
3. prepara el canal
4. conecta por QR
5. ve a `Configuracion > IA`
6. guarda la clave del cliente

## Healthcheck

El stack expone endpoints de salud:

- `/api/health` (liveness): siempre responde `200` mientras la app este viva, incluyendo estado de base en el payload
- `/api/health?scope=ready` (readiness): responde `200` si Prisma logra consultar la base, o `503` si no hay conexion

Ejemplo:

```bash
curl https://crm.cliente.com/api/health
curl https://crm.cliente.com/api/health?scope=ready
```

## Nota sobre el primer arranque en Swarm

El contenedor del CRM ahora espera a que PostgreSQL este disponible antes de sembrar:

- usuario inicial
- pipeline base
- configuracion minima
- esquema Prisma principal

Si la base tarda en responder, el contenedor reintentara y, si aun no puede conectar, saldra con error para que `restart_policy` lo vuelva a levantar.

## Base limpia para clientes nuevos

La imagen de PostgreSQL ya no usa dumps con datos historicos.

Cada despliegue nuevo arranca sin:

- contactos
- conversaciones
- mensajes
- leads
- citas
- plantillas

Solo se crea la base minima operativa para que el cliente pueda iniciar.

## Desarrollo local

```bash
docker compose -f docker-compose.local.yml up -d --build
```

El compose local deja `ALLOW_ENV_AI_FALLBACK=true` para facilitar pruebas con variables de entorno.
# WhatsApp Cloud API oficial (Embedded Signup v4)

El CRM integra directamente WhatsApp Cloud API de Meta y conserva como alternativa el canal por QR. No usa YCloud y no solicita permisos de Messenger ni Instagram.

## Configuracion en Meta

1. La app debe pertenecer a un Tech Provider o Solution Partner y estar en modo **Live**.
2. Crea una configuracion nueva de **Facebook Login for Business** con **WhatsApp Embedded Signup v4** y selecciona solamente Cloud API / WhatsApp Business Accounts.
3. Solicita acceso avanzado a `whatsapp_business_management` y `whatsapp_business_messaging`.
4. Autoriza el dominio HTTPS del CRM y la URL OAuth indicada por Meta. El callback de mensajes es `https://TU-DOMINIO/api/webhooks/whatsapp`.
5. Define en Portainer las variables `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_TECH_PROVIDER_SOLUTION_ID`, `META_GRAPH_API_VERSION`, `META_WHATSAPP_REGISTRATION_PIN` y `META_WEBHOOK_VERIFY_TOKEN`.
6. Abre **Configuracion > Canal WhatsApp** y pulsa **Conectar mi WhatsApp**.

El servidor intercambia inmediatamente el codigo temporal, suscribe el WABA a `messages`, `account_update` y `message_template_status_update`, registra el numero con el PIN y verifica cada webhook con `X-Hub-Signature-256`.

Documentacion oficial consultada:

- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
