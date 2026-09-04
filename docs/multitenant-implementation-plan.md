# Plan de implementación multitenant

## Objetivo

Convertir Zen CRM Belleza de una instalación por cliente a una plataforma SaaS:

- Un alta de prueba desde la landing crea un tenant automáticamente.
- La aplicación web, el portal público y las futuras apps móviles comparten el mismo backend.
- Cada negocio conserva una base PostgreSQL independiente.
- La identidad, el cobro y el aprovisionamiento viven en una base central de control.

El diseño ejecutable de los hitos restantes, contratos de API, modelos y puertas de lanzamiento está en [`multitenant-execution-blueprint.md`](./multitenant-execution-blueprint.md).

## Decisiones de arquitectura

- Aplicación Next.js compartida y una base PostgreSQL por tenant.
- Base central de control para `User`, `Tenant`, `TenantMembership`, dominios, planes, suscripciones, conexiones de canal, dispositivos y trabajos de aprovisionamiento.
- Tenant explícito en la URL web: `/t/{slug}`. Los portales usarán `/portal/{slug}`.
- Una sola aplicación móvil de Zen CRM, no una aplicación por negocio.
- Stripe opera el cobro web. Las primeras apps móviles son compañeras para usuarios existentes y no incluyen compra ni enlaces a compra.
- Meta Cloud API es el canal principal. WuzAPI permanece como adaptador con una conexión aislada por tenant.

## Fase 0 — Endurecimiento previo al autoservicio

1. Impedir que `public/uploads` se incorpore a imágenes Docker o a archivos nuevos en Git.
2. Mantener la base de WuzAPI separada de la base del CRM en todos los stacks nuevos.
3. Pasar al runtime las variables Meta declaradas en el entorno.
4. Inventariar las instalaciones actuales, respaldarlas cuando aplique y crear una migración inicial reproducible desde una base vacía.
5. Retirar `prisma db push`, DDL y seeds implícitos del arranque de la aplicación. Reemplazarlos por `prisma migrate deploy` ejecutado exclusivamente por un provisionador/migrador.
6. Fijar imágenes por SHA/digest, separar roles de PostgreSQL y sustituir almacenamiento local por object storage privado.

### Estado inicial

- Hecho en este cambio: puntos 1 a 3 para el compose genérico.
- Hecho: `prisma/tenant-migrations/20260831000000_initial_schema` genera una base vacía equivalente a `prisma/schema.prisma`. Se validó aplicándola en PostgreSQL con pgvector y comprobando el estado con `prisma migrate status`.
- `prisma.tenant.config.ts` es la configuración que debe usar el provisionador con `prisma migrate deploy`; la cadena histórica de `prisma/migrations` sigue siendo únicamente legacy y no se debe mezclar con ella.
- Antes de desplegar el nuevo `whatsapp-db` sobre una instalación existente se debe migrar su estado o volver a enlazar el QR de WhatsApp. No debe hacerse como actualización ciega.
- `npm run db:tenant:migrate` ejecuta exclusivamente `prisma migrate deploy --config prisma.tenant.config.ts`. Espera a la DB y está destinado al provisionador; no siembra datos ni ejecuta `db push`.
- `npm run db:tenant:seed` agrega de forma idempotente la configuración mínima y las seis etapas del pipeline. No crea usuarios ni contraseñas predeterminadas; el provisionador creará la identidad y la membresía globales en la fase 1.
- El runtime ya no hace DDL, seed ni `db push`: `scripts/startup.mjs` sólo inicia Next.js. Por ello, una instalación nueva debe ejecutar primero migración y seed desde el provisionador. La actualización de una instalación legacy exige un corte controlado, no una actualización ciega.

### Criterio de salida

Una base vacía puede llegar al esquema canónico mediante migraciones versionadas, sin `db push`, y una imagen no contiene archivos de clientes.

## Fase 1 — Control plane

Crear un segundo esquema/DB con estos modelos iniciales:

- `User` global y credenciales.
- `Tenant`, `TenantMembership`, `TenantDomain` y estado de acceso.
- `TenantDatabase` con cluster, identificador, versión de esquema y credencial cifrada.
- `Plan`, `BillingPrice`, `Subscription`, `BillingEntitlement`, `Trial` y `BillingEvent`.
- `ProvisioningJob`, `WebhookEvent`, `ChannelConnection`, `DeviceInstallation` y `AuditLog`.

Separar los estados: `provisioningStatus`, `billingStatus` y `accessMode`. Nunca usar un único enum para representar las tres dimensiones.

### Estado inicial

- Hecho: `prisma/control-plane/schema.prisma` y `prisma/control-plane/migrations` definen la base central. Usa exclusivamente `CONTROL_DATABASE_URL`; nunca comparte la `DATABASE_URL` de un tenant.
- Hecho: `npm run db:control:migrate` aplica las migraciones de control plane y `npm run db:control:generate` genera su cliente Prisma separado. La migración inicial se validó en PostgreSQL vacío.
- Los campos sensibles de conexión de tenant, canales y dispositivos se almacenan sólo como ciphertext y versión de llave. La implementación de envelope encryption llega con el provisionador.
- Hecho: `src/lib/control-plane.ts` crea de forma transaccional el tenant, su membresía `OWNER` y un único `ProvisioningJob` por clave de idempotencia. También resuelve el acceso de un usuario por slug sin abrir una base de tenant.

### Criterio de salida

Un usuario puede pertenecer a varios tenants y se puede suspender uno sin afectar su cuenta ni otros negocios.

## Fase 2 — Provisionador y bases de tenant

Crear un proceso separado, con credenciales administrativas exclusivas, que:

1. Reciba un `ProvisioningJob` idempotente.
2. Elija un cluster y cree DB, roles de migración y runtime por tenant.
3. Revoca `CONNECT` a `PUBLIC`, instala `vector`, ejecuta migraciones y seed versionado.
4. Prueba la conexión runtime y marca el tenant como `READY`.
5. Registra errores, reintentos, tiempos y versión de esquema.

El proceso web nunca tendrá permisos `CREATEDB`, `CREATEROLE`, DDL ni el secreto administrador de WuzAPI.

### Estado inicial

- Hecho: `scripts/provision-tenant.mjs` reclama un trabajo con `FOR UPDATE SKIP LOCKED`, recupera locks vencidos y usa reintento exponencial. `npm run provisioner:once` procesa un trabajo y `npm run provisioner:drain` procesa la cola disponible.
- Hecho: por tenant crea un rol de migración propietario y un rol runtime sin privilegios administrativos; revoca `PUBLIC`, instala `vector`, configura permisos por defecto, migra, siembra y verifica el esquema antes de marcarlo `READY`.
- Hecho: la URL runtime se guarda cifrada con AES-256-GCM y versión de llave en el control plane. El secreto de migración nunca se persiste. La migración a un KMS/envelope encryption real queda pendiente antes de producción.
- El worker debe desplegarse con el target Docker `provisioner` y las variables `CONTROL_DATABASE_URL`, `TENANT_POSTGRES_ADMIN_URL`, `TENANT_CREDENTIALS_ENCRYPTION_KEY` (base64 de 32 bytes), `TENANT_CREDENTIALS_KEY_VERSION`, `TENANT_POSTGRES_CLUSTER_KEY` y `TENANT_TRIAL_DAYS`. `TENANT_POSTGRES_ADMIN_URL` nunca pertenece al servicio web. La llave AES temporal también debe estar disponible para el runtime web para descifrar su URL de datos; debe sustituirse por permisos de descifrado KMS/envelope encryption antes de producción.
- Validado contra dos PostgreSQL efímeros: crea la base aislada, aplica la migración, crea los defaults, activa el trial al quedar `READY` y no concede `CREATE` al rol runtime. Un fallo transitorio se reintentó sobre la misma base sin crear duplicados.

### Criterio de salida

Dos solicitudes repetidas para el mismo tenant no crean dos bases y un fallo se puede reanudar desde el último paso seguro.

## Fase 3 — Runtime multitenant

1. Implementar un `TenantPrismaManager` con caché LRU, TTL, límites de pool y desconexión controlada.
2. Resolver primero el slug/host en el control plane y fallar cerrado si no existe.
3. Mover roles y permisos a `TenantMembership`; mantener solamente identidad global en el control plane.
4. Refactorizar el acceso actual a Prisma para que cada ruta, Server Action, callback OAuth, webhook y worker reciba un `TenantContext`.
5. Convertir las Server Actions críticas en servicios reutilizables y API/BFF para clientes móviles.

### Estado inicial

- Hecho: `TenantPrismaManager` usa LRU, TTL, máximo de clientes y máximo de conexiones por pool. Sólo descifra y abre una base cuyo `TenantDatabase` esté en estado `READY`.
- Hecho: `requireTenantContext` resuelve el slug y membresía desde el control plane antes de solicitar el cliente tenant; aplica de forma central los modos `FULL`, `READ_ONLY`, `BILLING_ONLY` y `SUSPENDED`.
- Hecho: `/t/{slug}` está protegido desde un layout de servidor. Sólo se activa con `MULTITENANT_RUNTIME_ENABLED=true`; los slugs desconocidos, no listos o sin membresía retornan 404. El dashboard legacy aún no se mueve a esta ruta.
- Hecho: `MULTITENANT_AUTH_ENABLED=true` hace que Credentials valide exclusivamente `User.passwordHash` del control plane. `createControlUser` prepara altas globales con hash bcrypt; las rutas `/t/{slug}` rechazan sesiones legacy aunque sean válidas en el CRM anterior.
- Hecho: `/` y `/signup` activan un alta beta únicamente con `MULTITENANT_PUBLIC_SIGNUP_ENABLED=true`. La API crea en una sola transacción la identidad global, tenant, membresía `OWNER` y trabajo idempotente; después inicia sesión y muestra `/onboarding/{slug}` hasta que el provisionador termina. El límite de intentos en memoria es sólo una protección inicial: antes de exponerlo sin invitación se añade CAPTCHA, verificación de correo y rate limit compartido.
- Hecho: `/t/{slug}/dashboard` es el primer vertical migrado. Obtiene contexto, configuración y métricas exclusivamente desde la base aislada del tenant; el dashboard legacy sigue separado.
- Hecho: cada identidad global se proyecta de forma idempotente a un actor operativo local mediante `User.controlUserId`. La contraseña permanece exclusivamente en el control plane; el actor tenant tiene contraseña nula y su rol se sincroniza desde `TenantMembership`. `requireTenantRuntimeContext` entrega conjuntamente acceso, DB aislada y actor para los servicios migrados.
- Hecho: el onboarding inicial vincula opcionalmente el primer perfil `Specialist` con el actor local de la persona propietaria. Esto no sustituye las futuras invitaciones ni la sincronización de miembros `PROFESSIONAL`.
- Pendiente: portar el resto del dashboard/API/acciones a `TenantRuntimeContext`, sincronizar perfiles cuando se invite un miembro `PROFESSIONAL` y retirar el cliente Prisma global legacy.

### Criterio de salida

No existe una ruta que abra una base tenant sin haber verificado tenant, membresía y estado de acceso.

## Fase 4 — Alta desde landing y onboarding

1. Landing: correo, verificación, CAPTCHA, UTM, dominio/negocio y aceptación legal.
2. Crear el `Tenant` y el `ProvisioningJob`; mostrar estado de preparación por polling o SSE.
3. Iniciar los siete días de prueba solamente cuando el tenant quede `READY`.
4. Convertir `BusinessPolicyConfigurator` en onboarding reanudable y añadir progreso/terminación.
5. Onboarding mínimo: identidad, zona horaria, horarios, servicios, políticas, conexión de WhatsApp/Meta, invitaciones y primer portal público.

### Estado inicial

- Hecho: `TenantOnboardingState` vive en cada DB tenant y conserva paso, servicio y especialista iniciales. La ruta protegida `/t/{slug}/onboarding` permite reanudar tras una recarga o editar los datos tras terminar.
- Hecho: el asistente registra identidad del negocio, país, zona horaria, días/horario de atención, un primer servicio y un primer profesional. Cada mutación exige sesión global, membresía `OWNER` o `ADMIN`, misma procedencia y `TenantRuntimeContext` de escritura; nunca toca la DB legacy ni el control plane para datos operativos.
- Hecho: el registro público envía al asistente cuando el provisionador marca `READY`, en lugar de abrir un panel vacío.
- Pendiente: políticas de atención, conexión WhatsApp/Meta, invitaciones, portal público y CAPTCHA/verificación de correo/rate limit compartido antes de exponer el alta sin invitación.

### Criterio de salida

Una persona que llega desde una campaña puede crear un entorno aislado y usable sin intervención manual.

## Fase 5 — Canales, archivos y procesos asíncronos

1. Separar `crm-worker` del proceso web y exigir `{ tenantId, jobType, recordId }` en cada trabajo.
2. Webhooks: validar firma, resolver canal a tenant en la base central, registrar evento idempotente y encolar; el worker procesa después.
3. Meta usa `phone_number_id -> tenantId`; WuzAPI usa ruta opaca y HMAC por canal.
4. Mover archivos a S3/MinIO privado bajo `tenants/{tenantId}/...` y servirlos con URLs firmadas.
5. Cifrar tokens Meta/WuzAPI/Google y credenciales de tenant con envelope encryption.

### Criterio de salida

Escalar réplicas web no duplica recordatorios ni campañas, y ningún webhook necesita asumir una base por defecto.

## Fase 6 — Facturación y ciclo de vida

1. Un adaptador de facturación con Stripe Checkout + Customer Portal como primer proveedor y Paddle Billing como alternativa Merchant of Record. `BillingPrice` y `BillingEvent` son neutrales al proveedor; no introducir lógica de Stripe en tenants.
2. Webhooks firmados e idempotentes; actualizar acceso desde el estado actual de la suscripción, no desde la redirección del navegador.
3. Límites por plan y prueba: usuarios, canales, IA, almacenamiento y campañas.
4. Estados de acceso: completo, solo lectura, facturación y suspendido.
5. Retención, exportación, eliminación y restauración definidos por contrato y política de privacidad.

### Criterio de salida

Una renovación, impago o cancelación modifica el acceso correcto sin intervenir manualmente ni borrar datos prematuramente.

### Decisión de proveedor para beta

- Con entidad y cuenta bancaria en México/España, Stripe permite vender globalmente y es el camino más rápido para la primera integración web.
- Stripe no convierte su recibo en CFDI mexicano. La página de precio/checkout debe decirlo de forma visible durante la beta.
- Una entidad fuera de la UE que venda SaaS B2C a consumidores europeos puede tener IVA desde la primera venta; no se debe asumir que un volumen bajo elimina la obligación. Consultar al contador para clasificar la operación y, si procede, usar Non-Union OSS.
- Paddle es Merchant of Record para sus propias transacciones y administra impuesto indirecto; es una opción fuerte si España/UE se vuelve mercado prioritario. Validar la elegibilidad comercial y payout del vendedor con Paddle antes de prometerlo.
- Hecho: las rutas web `POST /api/billing/checkout` y `POST /api/billing/portal` verifican dueño y tenant antes de crear una sesión de Stripe Checkout o Customer Portal. Sólo se activan con `BILLING_STRIPE_ENABLED=true` y un precio `BillingPrice` activo.
- Hecho: `POST /api/webhooks/stripe` verifica la firma sobre el cuerpo crudo, registra y reclama `BillingEvent` idempotentemente, y sincroniza `Subscription`, `billingStatus` y `accessMode` a partir de eventos de suscripción. La URL de éxito no concede acceso por sí sola.

## Fase 7 — Calidad, operación y migración

1. Pruebas negativas de aislamiento entre tenants para rutas, acciones, jobs, webhooks y archivos.
2. Backups de control plane y tenants; WAL/PITR, dumps por tenant y simulacros de restauración.
3. Métricas por tenant, alertas, auditoría y límites de consumo.
4. Migraciones por flota con canario, lotes, expand/contract y rollback probado.
5. Migrar primero un tenant interno y luego clientes existentes con ventana de solo lectura y reversión.

### Criterio de salida

Se puede restaurar y migrar un tenant de forma aislada, y demostrar que no puede leer datos de otro.

## Fase 8 — PWA y aplicaciones móviles

1. Hacer el dashboard responsive y publicar PWA instalable.
2. Crear API móvil estable sobre los servicios multitenant.
3. Construir una sola app iOS/Android para agenda, inbox, clientes, archivos y notificaciones push.
4. Añadir deep links, cámara, caché de agenda, biometría y notificaciones por `userId + tenantId`.
5. Preparar privacidad, borrado de cuenta, Data Safety, App Privacy, OAuth en navegador seguro y cuentas de publicación.

### Criterio de salida

Un miembro puede usar el mismo tenant desde web, PWA, Android e iOS sin duplicar datos ni autenticación.
