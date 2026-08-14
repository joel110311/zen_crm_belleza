# Zen CRM Belleza

CRM para negocios de belleza con clientes, servicios, agenda y reservas públicas, caja, WhatsApp, recordatorios y personalización de marca.

Este repositorio esta preparado para despliegue tipo SaaS por instancia: cada cliente levanta su propio stack, conecta su numero por QR, configura sus claves y trabaja sobre una base limpia, sin mensajes ni leads precargados.

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

### Arranque

```bash
docker compose -f docker-compose.zen-crm.yml up -d
```

### Recomendacion para Portainer

1. crea un stack nuevo
2. pega el contenido de `docker-compose.zen-crm.yml`
3. carga las variables de `portainer.env.example` adaptadas al cliente
4. asigna un `APP_DOMAIN` unico por cliente, por ejemplo `crm.cliente.com`
5. asigna un `STACK_SLUG` unico por cliente, por ejemplo `zencrm-cliente-a`
6. deja `ALLOW_ENV_AI_FALLBACK=false` para que el CRM no use claves IA del servidor
7. si tu Swarm tarda en levantar PostgreSQL, deja los retries de startup tal como vienen

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
