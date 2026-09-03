# Host canónico de plataforma: `app.synapselogik.com`

## Decisión

`app.synapselogik.com` será la entrada única de la plataforma SaaS. Los tenants se resolverán por ruta, inicialmente con `/t/{slug}`, por ejemplo:

```text
https://app.synapselogik.com/t/salon-luna
https://app.synapselogik.com/portal/salon-luna
```

Esto evita depender de DNS wildcard para cada nuevo negocio. Más adelante, si se habilitan dominios propios o subdominios por cliente, se añade `TenantDomain` al control plane sin cambiar las rutas existentes.

## Valores de Portainer

Configurar estos valores en el stack nuevo de plataforma:

```dotenv
APP_DOMAIN=app.synapselogik.com
AUTH_URL=https://app.synapselogik.com
APP_BASE_URL=https://app.synapselogik.com
WHATSAPP_WEBHOOK_BASE_URL=https://app.synapselogik.com
META_WEBHOOK_BASE_URL=https://app.synapselogik.com
```

Mantener los secretos reales solamente en Portainer o en el gestor de secretos; no crear un archivo `.env` con valores reales en el repositorio.

## Variables al activar multitenancy

No activar estas variables mientras `crm-belleza.synapselogik.com` siga en modo legacy. Después de migrar el control plane y crear usuarios globales, el servicio web de `app.synapselogik.com` requiere:

```dotenv
CONTROL_DATABASE_URL=postgresql://zencrm_control_runtime:.../zencrm_control
MULTITENANT_AUTH_ENABLED=true
MULTITENANT_RUNTIME_ENABLED=true
MULTITENANT_PUBLIC_SIGNUP_ENABLED=false
MULTITENANT_INVITATIONS_ENABLED=false
MULTITENANT_PUBLIC_PORTAL_ENABLED=false
MULTITENANT_CHANNELS_ENABLED=false
MULTITENANT_PRIVATE_STORAGE_ENABLED=false
SECURITY_HASH_SALT=<secreto-aleatorio-independiente>
CHANNEL_STATE_SIGNING_SECRET=<secreto-aleatorio-independiente-de-32-caracteres-o-mas>
TENANT_CREDENTIALS_ENCRYPTION_KEY=<base64-de-32-bytes>
TENANT_CREDENTIALS_KEY_VERSION=1
```

El proceso `provisioner` usa además `TENANT_POSTGRES_ADMIN_URL`, `TENANT_POSTGRES_CLUSTER_KEY`, `TENANT_TRIAL_DAYS` y `CONTROL_DATABASE_REQUIRE_LEAST_PRIVILEGE=true`; ese URL administrativo nunca se entrega al servicio web. Al primer arranque crea o restringe el rol indicado en `CONTROL_DATABASE_URL` sin `SUPERUSER`, `CREATEDB` ni `CREATEROLE`, ejecuta las migraciones con el URL administrativo y concede al runtime únicamente DML. La llave AES es una medida temporal y deberá cambiarse por envelope encryption con KMS antes de producción pública.

El clúster PostgreSQL que aloja bases tenant debe incluir las extensiones `pgvector` y `btree_gist`. La migración inicial ejecuta `CREATE EXTENSION vector` y el portal usa `btree_gist` para impedir intervalos de reserva que se crucen; una imagen estándar `postgres:*` sin `pgvector` fallará correctamente antes de dejar un tenant a medias. Para pruebas locales se validó con `pgvector/pgvector:pg16`.

`MULTITENANT_PUBLIC_SIGNUP_ENABLED` permanece en `false` hasta que el provisioner esté desplegado, se haya probado el flujo completo y se acepte recibir altas externas. Cuando se active, `/` muestra la landing beta y `/signup` inicia una intención de alta verificable; el tenant no existe hasta que el propietario confirma su correo.

### Alta pública segura (requisito para cambiar a `true`)

La implementación actual ya no provisiona desde `/api/public/signup`. Primero crea un `SignupIntent` y sólo el enlace de correo, de un solo uso, genera `User`, `Tenant`, membresía `OWNER` y `ProvisioningJob`. Antes de activar la bandera pública deben estar configurados en secretos de Portainer:

```dotenv
SECURITY_HASH_SALT=<secreto-aleatorio-independiente>
TURNSTILE_SECRET_KEY=<cloudflare-turnstile-server-secret>
TURNSTILE_SITE_KEY=<cloudflare-turnstile-site-key>
TURNSTILE_EXPECTED_HOSTNAME=app.synapselogik.com
RESEND_API_KEY=<resend-api-key>
EMAIL_FROM=SynapseLogik CRM <soporte@synapselogik.com>
EMAIL_REPLY_TO=contacto@synapselogik.com
LEGAL_TERMS_VERSION=2026-09-03
LEGAL_PRIVACY_VERSION=2026-09-03
```

El backend valida Turnstile, usa límite atómico compartido por IP anonimizada/correo/fingerprint y persiste el historial de correo, aceptación legal y recuperación de contraseña. Si falta una de esas variables, la ruta pública se mantiene cerrada aun cuando alguien cambie la bandera por error.

### Activar por invitación y portal interno

Después de migrar control plane y todas las DB tenant, primero activa `MULTITENANT_INVITATIONS_ENABLED=true` y prueba una invitación por cada rol. La persona propietaria o administración puede revocar una invitación o desactivar una membresía; un profesional aceptado se proyecta a su perfil local de forma reintentable al entrar por primera vez.

Activa `MULTITENANT_PUBLIC_PORTAL_ENABLED=true` sólo para el tenant interno de prueba ya publicado. Verifica catálogo, disponibilidad, dos solicitudes concurrentes sobre el mismo intervalo, reservación, enlace de gestión y cancelación. Con la bandera apagada se conserva el portal legacy; con la bandera encendida `/portal/{slug}` no toca la DB legacy.

### Provisión continua

El compose despliega `provisioner` como proceso separado. El web service no recibe `TENANT_POSTGRES_ADMIN_URL`; sólo el provisionador puede crear bases y roles. Al arrancar, éste crea `zencrm_control` si todavía no existe, fija su zona horaria en UTC, aplica las migraciones inmutables y después empieza a drenar la cola:

```bash
docker compose -f docker-compose.zen-crm.yml up -d provisioner
```

Cada base tenant también queda fijada en UTC antes de migrarse. Esto evita que `nextRunAt`, vencimientos y trials se desfasen cuando el host PostgreSQL usa una zona horaria local. El worker drena trabajos pendientes, espera 15 segundos y repite. Para validar un stack nuevo, crear primero un tenant interno y confirmar que quede `READY`, con `TenantDatabase.status=READY`, las migraciones tenant completas y trial creado.

### Canales por tenant y almacenamiento privado

Mantén ambas banderas nuevas en `false` hasta que las dos migraciones `20260903070000_*` estén aplicadas a control plane y a todas las bases tenant. Para una prueba interna, configura primero:

```dotenv
MULTITENANT_CHANNELS_ENABLED=true
META_APP_ID=<app-id-de-meta>
META_APP_SECRET=<app-secret-solo-servidor>
META_EMBEDDED_SIGNUP_CONFIG_ID=<config-id-de-embedded-signup>
MULTITENANT_WUZAPI_WEBHOOK_HMAC_KEY=<hmac-global-aleatorio>

MULTITENANT_PRIVATE_STORAGE_ENABLED=true
TENANT_STORAGE_S3_ENDPOINT=https://<endpoint-s3-compatible>
TENANT_STORAGE_S3_REGION=us-east-1
TENANT_STORAGE_S3_BUCKET=<bucket-privado>
TENANT_STORAGE_S3_ACCESS_KEY_ID=<solo-servidor>
TENANT_STORAGE_S3_SECRET_ACCESS_KEY=<solo-servidor>
TENANT_STORAGE_S3_FORCE_PATH_STYLE=true
```

No habilites ACL pública, website hosting ni una política de lectura anónima en el bucket. Meta recibe una URL única y opaca por conexión; WuzAPI exige HMAC sobre el cuerpo crudo y también recibe una ruta opaca. Inicia el consumidor junto al provisionador:

```bash
docker compose -f docker-compose.zen-crm.yml up -d provisioner tenant-worker
```

`tenant-worker` procesa webhooks y mantenimiento de objetos mediante `SKIP LOCKED`, heartbeat, reintento exponencial y dead letter. Las clases de trabajo para mensajes salientes, recordatorios, campañas e IA ya están reservadas en la cola; se conectarán cuando Inbox, campañas y recordatorios dejen su implementación legacy. Si se exige antivirus, deja `TENANT_STORAGE_REQUIRE_ANTIVIRUS=false` hasta integrar un proveedor de escaneo: con `true`, los objetos quedan bloqueados en estado `PENDING` de forma segura.

## Cobro beta y cobertura internacional

- No publicar un precio ni habilitar Checkout hasta tener precios activos en `BillingPrice` y las credenciales del proveedor en el gestor de secretos.
- Stripe será el primer adaptador para una entidad operando desde México o España. Paddle queda disponible en el modelo para valorar un Merchant of Record si España/UE se convierte en mercado prioritario.
- El comprobante de Stripe o Paddle no es CFDI mexicano. Mientras no exista facturación fiscal, el precio y checkout deben mostrar el aviso de acceso anticipado de forma visible.
- Antes de vender SaaS B2C a la UE con una entidad fuera de la UE, revisar con contador la clasificación e IVA/Non-Union OSS; no activar España basándose en un umbral informal de clientes.

Cuando se decida activar Stripe, agregar además:

```dotenv
BILLING_STRIPE_ENABLED=false
STRIPE_SECRET_KEY=<solo-servicio-web>
STRIPE_WEBHOOK_SECRET=<solo-servicio-web>
```

Primero crear productos/precios en Stripe y registrar cada precio activo en `BillingPrice` con `provider=STRIPE`, periodicidad y el `externalPriceId` correspondiente. Después configurar el Customer Portal en Stripe y el endpoint firmado `POST /api/webhooks/stripe` para `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`. Sólo entonces cambiar `BILLING_STRIPE_ENABLED=true`. Los precios fundadores se crean como precios/cupones de Stripe; no se calculan en el navegador.

## Corte sin datos que preservar

1. Construir y publicar la imagen que ya incluya la línea base de tenant.
2. Crear un stack nuevo para `app.synapselogik.com` con una base limpia; no reutilizar los volúmenes del stack legacy.
3. Confirmar `https://app.synapselogik.com/api/health?scope=ready`, login, carga de archivos, OAuth Google, webhook Meta y WuzAPI.
4. Actualizar las URLs de callback externas para usar `app.synapselogik.com`.
5. Cuando la nueva plataforma esté lista, redirigir `crm-belleza.synapselogik.com` hacia `app.synapselogik.com` en Traefik. No redirigir antes de validar el nuevo stack.

## Observación actual

Al verificarlo durante esta preparación, ambos hosts resuelven al mismo servidor y responden por HTTPS. No se requiere crear un registro DNS adicional; el cambio pendiente es declarar `app.synapselogik.com` como host canónico en el despliegue de plataforma.
