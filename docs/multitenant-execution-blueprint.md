# Plano de ejecución multitenant

## Resultado esperado

`app.synapselogik.com` opera una sola aplicación SaaS donde:

- La identidad, membresías, aprovisionamiento, canales y cobro viven en el control plane.
- Los contactos, citas, conversaciones, servicios, expedientes y configuración viven en una DB aislada por tenant.
- Web, portal público, PWA y futuras apps móviles consumen los mismos servicios multitenant.
- Ninguna ruta decide el tenant a partir de datos enviados en el cuerpo; siempre lo resuelve desde el slug/host y la sesión o desde una credencial pública firmada.

```text
Landing ──> Control plane ──> Provisionador ──> DB tenant ──> Onboarding
                 │                                  ▲
Stripe ──────────┤                                  │
Meta/WuzAPI ─────┴─> router + evento idempotente ───┤
Portal/PWA/App ─────> API /api/t/{slug}/v1 ─────────┘
```

## Estado real (actualizado el 3 de septiembre de 2026)

| Área | Estado | Observación |
| --- | --- | --- |
| Esquema tenant y migraciones | Listo | Una DB vacía llega al esquema actual sin `db push`. |
| Control plane | Listo como base | Identidad, tenant, membresías, billing, canales, auditoría y provisionamiento ya tienen modelos. |
| Provisionador | Listo para beta interna | Crea DB y roles aislados, migra, hace seed, verifica y activa trial. KMS sigue pendiente. |
| Resolución runtime | Lista | Slug + membresía + estado se verifican antes de abrir la DB tenant. |
| Onboarding básico | Listo | Negocio, horario, servicio y profesional son reanudables en la DB tenant. |
| Stripe | Backend inicial listo | Checkout, portal y webhook existen; faltan catálogo real, reconciliación y pruebas con Stripe test. |
| Producto operativo | Núcleo tenant listo | Dashboard, onboarding, servicios, especialistas, contactos, pacientes, agenda, disponibilidad y pipeline ya operan bajo `/t/{slug}`. |
| API tenant v1 | Lista para el núcleo | Contexto común, permisos por membresía, errores estables, `requestId` e idempotencia persistida en cada DB tenant. |
| Superficie legacy | Aislada, pendiente de retirar | Persisten 56 archivos que importan el Prisma global para `/dashboard`; ninguna ruta, pantalla, componente o servicio tenant los importa. |
| Portal público | Listo detrás de bandera | `/portal/{slug}` abre exclusivamente la DB resuelta desde control plane cuando `MULTITENANT_PUBLIC_PORTAL_ENABLED=true`; el portal legacy permanece como fallback mientras está apagada. |
| Invitaciones | Listas detrás de bandera | Tokens HMAC, asientos, membresías y proyección de profesionales con `MULTITENANT_INVITATIONS_ENABLED=true`. |
| Canales por tenant | Listos detrás de bandera | Meta Embedded Signup y WuzAPI guardan secretos cifrados en control plane; sus webhooks opacos entran a una cola durable y nunca llaman el código legacy. |
| Archivos privados y worker | Listos detrás de bandera | Metadatos tenant, URLs S3 firmadas de vida corta, descarga autorizada, tokens públicos limitados y `tenant-worker` sin volumen `public/uploads`. |
| Alta pública | Cerrada por bandera | Verificación de correo, CAPTCHA y rate limit compartido ya están implementados; faltan credenciales reales para abrirla. |

## Invariantes que no se negocian

1. `CONTROL_DATABASE_URL` nunca contiene datos operativos de clientes.
2. El servicio web nunca recibe `TENANT_POSTGRES_ADMIN_URL` ni permisos DDL.
3. Una operación autenticada recibe `TenantRuntimeContext`; no importa `@/lib/db`.
4. Un webhook resuelve `provider + externalAccountId` en el control plane antes de abrir una DB tenant.
5. Todo evento externo y toda mutación repetible tiene clave de idempotencia.
6. Los tokens y credenciales se cifran; los tokens de un solo uso se almacenan únicamente como hash.
7. Los archivos usan una clave `tenants/{tenantId}/...` y nunca una ruta pública local.
8. La app móvil no lleva secretos de proveedor ni el identificador de una DB.
9. Una redirección de navegador nunca activa una suscripción; sólo un webhook firmado o la reconciliación con el proveedor.
10. Las funcionalidades incompletas permanecen detrás de banderas apagadas.

## Orden de implementación

### M1 — Contrato común de API y capa de servicios tenant

Estado: **núcleo operativo completado**. Inbox, caja/reportes y configuración avanzada permanecen para cortes posteriores porque dependen del router de canales, almacenamiento y workers.

#### Diseño

- Rutas autenticadas: `/api/t/{tenantSlug}/v1/{recurso}`.
- Rutas web: `/t/{tenantSlug}/{módulo}`.
- Contexto único de entrada:

```ts
type TenantServiceContext = {
  tenantId: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "PROFESSIONAL" | "RECEPTION";
  accessMode: "FULL" | "READ_ONLY" | "BILLING_ONLY" | "SUSPENDED";
  actor: TenantActor;
  db: PrismaClient;
};
```

- `requireTenantApiContext(request, slug, operation, permissions)` traduce errores a `401`, `403`, `404` y `409` de forma uniforme.
- Los servicios reciben el contexto explícitamente: `listServices(ctx)`, `createAppointment(ctx, input)`, etc.
- Las páginas web y API consumen los mismos servicios; las Server Actions dejan de ser la lógica principal.
- Respuestas API con forma estable:

```json
{ "data": {}, "meta": { "requestId": "..." } }
```

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "requestId": "..." } }
```

#### Primer orden de migración

1. Servicios y especialistas.
2. Contactos y pacientes.
3. Calendario y disponibilidad.
4. Pipeline.
5. Inbox y mensajes.
6. Caja/reportes.
7. Configuración, plantillas, catálogo, documentos e IA.

Servicios/especialistas van primero porque el onboarding, el calendario y el portal dependen de ellos. Inbox va después del router de canales para no duplicar una integración todavía legacy.

#### Protección automática

- ESLint prohíbe `@/lib/db`, `@/lib/system-settings` y `@/app/actions/*` dentro de `src/app/t`, `src/app/api/t` y la futura `src/lib/tenant-services`.
- Pruebas de contrato ejecutan cada endpoint con: miembro correcto, otro tenant, miembro inactivo, modo lectura, tenant suspendido y slug inexistente.

#### Terminado cuando

- Las pantallas principales existen bajo `/t/{slug}`.
- `rg` no encuentra acceso legacy desde rutas o servicios multitenant.
- Un usuario de tenant A no puede obtener, modificar ni inferir IDs del tenant B.

#### Entrega comprobada

- `TenantServiceContext` resuelve identidad global, membresía, modo de acceso, actor local y Prisma de la DB aislada.
- `/api/t/{slug}/v1` expone servicios, categorías, especialistas, bloqueos, contactos, pacientes, calendario y pipeline.
- POST, PATCH y DELETE exigen `Idempotency-Key`; `ApiMutationReceipt` conserva respuestas exitosas 24 horas dentro de la DB tenant.
- El onboarding consume el mismo contrato v1.
- Las pantallas `/t/{slug}/{módulo}` consumen sólo la API tenant y respetan controles por rol.
- La agenda valida horario del negocio, asignación servicio-profesional, bloqueos, traslapes y sobrecitas administrativas.
- La migración se probó desde cero en dos bases PostgreSQL con la extensión `pgvector`; el mismo identificador puede existir en ambas sin colisión y no es visible entre ellas.
- Prueba HTTP autenticada: catálogo → profesional → contacto/paciente → cita → oportunidad; replay idempotente sin duplicado, choque de agenda `409` y tenant ajeno `404`.

### M2 — Onboarding completo y centro de preparación

El onboarding actual conserva sus cuatro pasos obligatorios. Se añade un centro de preparación que permite terminar el núcleo y completar integraciones opcionales después.

#### Flujo diseñado

1. Negocio: nombre, país, zona horaria y dirección. Hecho.
2. Horario: días y rango de atención. Hecho.
3. Servicio inicial: precio, moneda y duración. Hecho.
4. Profesional inicial: perfil y vínculo con actor. Hecho.
5. Políticas: cancelación, anticipos, tolerancia, acompañantes y escalamiento.
6. Portal: colores, introducción, servicios visibles y vista previa.
7. Equipo: invitaciones con rol y, cuando aplique, perfil profesional.
8. Canales: Meta Cloud API principal; WuzAPI como alternativa explícita.
9. Revisión: checklist y publicación.

Los pasos 1 a 6 forman el núcleo. Equipo y canales se pueden omitir para no bloquear la activación. `completedAt` significa “núcleo usable”; el checklist mantiene por separado el avance opcional.

#### Evolución de datos tenant

`TenantOnboardingState` incorporará, cuando se agreguen los pasos, `version`, `completedSteps`, `skippedSteps` y `publishedAt`. Los datos de negocio siguen en sus modelos canónicos; el estado no duplica configuración.

#### APIs

- `PATCH /api/t/{slug}/v1/onboarding/{step}`
- `GET /api/t/{slug}/v1/onboarding`
- `POST /api/t/{slug}/v1/onboarding/complete`
- `GET /api/t/{slug}/v1/readiness`

#### Terminado cuando

- Una cuenta nueva llega a una agenda y portal utilizables sin intervención manual.
- Recargar, volver atrás o repetir un envío no crea servicios, perfiles ni invitaciones duplicados.

### M3 — Alta pública segura y recuperación de cuenta

La bandera `MULTITENANT_PUBLIC_SIGNUP_ENABLED` no se activa públicamente antes de este hito.

#### Nuevos modelos del control plane

- `SignupIntent`: correo, negocio, slug solicitado, zona horaria, UTM, hash del token, expiración y estado.
- `LegalAcceptance`: versión de términos/privacidad, fecha e IP anonimizada.
- `PasswordResetToken`: hash, expiración y consumo.
- `EmailDelivery`: plantilla, proveedor, estado e identificador externo para diagnóstico.

#### Flujo

1. `POST /api/public/signup-intents`: valida CAPTCHA y rate limit compartido; no crea tenant.
2. Se envía un enlace con token de un solo uso y vencimiento corto.
3. `POST /api/public/signup-intents/verify`: consume el token y crea usuario, tenant, owner y `ProvisioningJob` en una transacción.
4. El provisionador inicia el trial sólo al quedar `READY`.
5. El usuario entra al onboarding con sesión global.

#### Controles

- CAPTCHA validado en servidor.
- Límite compartido por IP anonimizada + correo + fingerprint de intento; nunca sólo memoria local.
- Respuestas de recuperación y verificación que no revelan si existe una cuenta.
- Password reset, revocación de sesiones y auditoría desde la primera beta pública.

#### Terminado cuando

- Bots o reintentos no generan tenants ilimitados.
- Una persona puede verificar correo, recuperar contraseña y aceptar la versión legal vigente.

#### Implementación realizada (2026-09-03)

- El onboarding v1 conserva los cuatro pasos previos y añade políticas, portal, preparación opcional de equipo/canales, checklist y publicación. `TenantOnboardingState` registra versión, pasos terminados/omitidos y publicación; la configuración canónica sigue en `SystemSettings` y los modelos de catálogo.
- El control plane incorpora `SignupIntent`, `LegalAcceptance`, `PasswordResetToken`, `EmailDelivery` y `SecurityRateLimit`. Los tokens se guardan con hash, los límites son atómicos en PostgreSQL y los IP/fingerprints se anonimizan con HMAC.
- La ruta pública anterior que provisionaba directamente (`/api/public/signup`) queda cerrada. La única ruta de creación es la verificación de un intent por correo.
- El alta pública se mantiene desactivada de forma segura mientras falte CAPTCHA, correo transaccional, URL pública y secreto de hash. Consulta `README.md` para las variables y aplica primero las migraciones de control y tenant.

### M4 — Invitaciones, membresías y perfiles profesionales

#### Nuevo modelo del control plane

`TenantInvitation` contiene tenant, correo normalizado, rol, hash del token, expiración, estado, invitador e idempotency key. Nunca almacena una contraseña.

#### Flujo

1. Owner/admin invita y se valida el límite de asientos del plan.
2. Si el correo ya tiene usuario global, sólo acepta la membresía; si no, crea su identidad al aceptar.
3. Se crea o reactiva `TenantMembership` idempotentemente.
4. En el primer acceso, `ensureTenantActor` proyecta el usuario en la DB tenant.
5. Para rol `PROFESSIONAL`, se vincula o crea `Specialist` mediante `controlUserId`; un fallo deja estado reintentable, no una membresía fantasma.

#### Permisos

| Rol | Alcance inicial |
| --- | --- |
| OWNER | Suscripción, propiedad, configuración, equipo y operación completa. |
| ADMIN | Configuración, equipo y operación; sin transferencia de propiedad. |
| PROFESSIONAL | Su agenda, pacientes asignados y conversaciones permitidas. |
| RECEPTION | Agenda, contactos e inbox; sin clínica sensible ni facturación SaaS. |

#### Terminado cuando

- Invitar dos veces no crea dos membresías.
- Desactivar una membresía corta acceso sin borrar el historial del actor local.

#### Implementación realizada (2026-09-03)

- `TenantInvitation` y su entrega de correo registran token HMAC, rol, vencimiento, invitador, idempotencia y el estado reintentable del perfil profesional; no existe contraseña en una invitación.
- Owner y admin pueden invitar, revocar y desactivar/reactivar miembros desde el paso Equipo. Los asientos cuentan miembros activos e invitaciones pendientes; usan el entitlement `seats` cuando exista y 5 como límite beta explícito.
- Aceptar crea o reactiva una `TenantMembership` en transacción serializable. Al primer acceso `ensureTenantActor` proyecta el actor y, para profesionales, crea o vincula el `Specialist` sin impedir el acceso si la proyección debe reintentarse.

### M5 — Portal público verdaderamente multitenant

El portal existente no se reutiliza hasta retirar su dependencia de la DB global.

#### Resolución pública

- `/portal/{tenantSlug}` resuelve `Tenant.slug` en el control plane sin requerir membresía.
- Sólo abre la DB si el tenant está `READY`, el acceso admite operación y `portalEnabled=true`.
- El slug interno de `SystemSettings` deja de ser identidad global; aliases o dominios viven en `TenantDomain`.

#### API pública

- `GET /api/public/t/{slug}/v1/portal`
- `GET /api/public/t/{slug}/v1/availability?serviceId=&specialistId=&date=`
- `POST /api/public/t/{slug}/v1/slot-holds`
- `POST /api/public/t/{slug}/v1/bookings`
- `GET /api/public/t/{slug}/v1/bookings/{token}`
- `POST /api/public/t/{slug}/v1/bookings/{token}/cancel`

La reserva usa `AppointmentSlotHold`, transacción y clave de idempotencia. Los tokens públicos se almacenan como hash, tienen alcance limitado y no exponen IDs internos innecesarios.

#### Terminado cuando

- Dos portales con servicios homónimos nunca comparten disponibilidad ni clientes.
- Dos solicitudes concurrentes no reservan el mismo profesional y horario.

#### Implementación realizada (2026-09-03)

- Las rutas públicas bajo `/api/public/t/{slug}/v1` resuelven `Tenant.slug` desde control plane y sólo conectan a una DB tenant `READY`, `FULL`, con portal explícitamente publicado.
- El catálogo, disponibilidad, apartados, reserva, consulta y cancelación operan exclusivamente con el Prisma tenant. El portal legacy sólo se conserva mientras la nueva bandera está apagada.
- Cada apartado es un intervalo de siete minutos respaldado por una exclusión PostgreSQL en `PublicAppointmentSlotHold` (`calendarKey` + rango de tiempo); no permite cruces ni siquiera con dos solicitudes concurrentes. Las claves de idempotencia y los tokens públicos se guardan como HMAC, nunca en claro.

### M6 — Meta Cloud API y WuzAPI por tenant

#### Conexión

- El Embedded Signup recibe un `state` firmado, de un solo uso, ligado a tenant y usuario.
- El resultado crea/actualiza `ChannelConnection` en control plane.
- Para Meta, `externalAccountId` es `phone_number_id`; la restricción única impide asignarlo a dos tenants.
- Los tokens se cifran con una llave versionada. El frontend sólo ve estado y últimos cuatro caracteres cuando sea útil.

#### Webhook

1. Verifica firma sobre cuerpo crudo.
2. Extrae `phone_number_id` o ruta opaca WuzAPI.
3. Resuelve `ChannelConnection` en control plane.
4. Inserta `WebhookEvent` único por proveedor/evento.
5. Responde rápido y procesa después.
6. El worker abre la DB resuelta, aplica el evento idempotentemente y marca resultado.

El webhook nunca llama acciones legacy, nunca usa `DATABASE_URL` y nunca persiste multimedia en `public/uploads`.

#### Terminado cuando

- Un evento de un número desconocido se ignora/audita sin tocar ninguna DB.
- Repetir el mismo evento no duplica mensajes, contactos ni respuestas del bot.

#### Implementación realizada (2026-09-03)

- `ChannelConnectionState` crea un `state` firmado, HMAC-hasheado, ligado al owner/admin, con vencimiento de diez minutos y consumo transaccional. La interfaz de onboarding inicia Meta Embedded Signup sin revelar `META_APP_SECRET`; el código se intercambia sólo en servidor y el `phone_number_id` tiene unicidad global por proveedor.
- Las rutas `/api/webhooks/tenant/meta/{ruta-opaca}` y `/api/webhooks/tenant/wuzapi/{ruta-opaca}` validan firma sobre el cuerpo crudo antes de resolver `ChannelConnection`. Meta usa `x-hub-signature-256`; WuzAPI exige HMAC. Cada mensaje, status o reacción entra como `WebhookEvent` único y trabajo `WEBHOOK_EVENT` atómico; un número/ruta desconocido queda `IGNORED` sin abrir una DB tenant.
- El worker abre la DB sólo después de reclamar el trabajo. Inserta contactos, conversación y mensaje con bloqueo advisory y consulta por `providerMessageId`, por lo que una repetición o recuperación tras caída no duplica datos. Multimedia se conserva como referencia del proveedor hasta que se migre el inbox a `PrivateFile`; no se escribe en `public/uploads`.

### M7 — Archivos privados y procesos asíncronos

#### Archivos

- Object storage S3-compatible con buckets privados.
- Clave: `tenants/{tenantId}/{resourceType}/{resourceId}/{uuid}.{ext}`.
- Subidas mediante URL firmada de corta duración y confirmación posterior.
- Descargas con autorización tenant; el portal usa tokens públicos de alcance limitado.
- La DB guarda `storageKey`, MIME, tamaño, hash y estado antivirus, nunca una URL pública permanente.

#### Workers

- Procesos separados para webhooks, mensajes salientes, recordatorios, campañas, IA y mantenimiento.
- Cada unidad incluye `tenantId`, tipo, recordId e idempotency key.
- Reclamo atómico, heartbeat, reintento exponencial y cola de fallos.
- Los recordatorios se reclaman dentro de cada DB tenant para evitar dobles envíos entre réplicas.

#### Terminado cuando

- Reiniciar o escalar la web no duplica trabajos.
- No hay escrituras runtime en `public/uploads`.

#### Implementación realizada (2026-09-03)

- `PrivateFile` almacena sólo `storageKey`, recurso, nombre, MIME, tamaño, SHA-256, estado de carga/antivirus y hashes de capacidades públicas. La clave siempre inicia con `tenants/{tenantId}/`; no hay columna de URL permanente.
- `POST /files/uploads` autoriza el tenant y produce un `PUT` S3 firmado por diez minutos. `POST /complete` verifica por `HEAD` tamaño, MIME y metadato SHA-256 antes de liberar la descarga; ésta redirige a una URL firmada por 60 segundos. Un token opcional de portal tiene vigencia máxima de siete días y nunca expone un ID interno.
- `TenantWorkItem` usa `FOR UPDATE SKIP LOCKED`, heartbeat, recuperación de locks vencidos, backoff exponencial y dead letter. `tenant-worker` se ejecuta separado del web/provisioner y atiende hoy webhooks y borrado de objetos. Los tipos para mensajes salientes, recordatorios, campañas e IA quedan persistidos para migrar sus productores sin introducir timers en la web.

### M8 — Facturación, trial y límites de plan

#### Activación de Stripe beta

1. Crear productos/precios de prueba en Stripe.
2. Sembrar `Plan`, `BillingPrice` y límites en control plane.
3. Probar Checkout y Customer Portal en modo test.
4. Procesar eventos y ejecutar reconciliación periódica contra Stripe.
5. Aplicar entitlements en el servidor: asientos, canales, IA, almacenamiento y campañas.
6. Mostrar aviso beta/CFDI antes de pagar.
7. Activar `BILLING_STRIPE_ENABLED=true` sólo después de pruebas de impago, cancelación y recuperación.

#### Estados de acceso

| Estado | Comportamiento |
| --- | --- |
| `FULL` | Operación normal. |
| `READ_ONLY` | Consulta y exportación; no mutaciones operativas. |
| `BILLING_ONLY` | Sólo facturación y recuperación de suscripción. |
| `SUSPENDED` | Sin acceso a datos operativos. |

El cambio de proveedor a Paddle no modifica las DB tenant: sólo agrega precios/eventos/adaptador en el control plane.

#### Terminado cuando

- Webhook repetido, fuera de orden o perdido se corrige por idempotencia y reconciliación.
- Los límites no dependen de ocultar botones; se validan en el servicio.

### M9 — Calidad, observabilidad y operación de flota

#### Pruebas obligatorias

- Aislamiento horizontal con dos tenants y datos deliberadamente homónimos.
- Permisos por rol y membresía inactiva.
- `READ_ONLY`, `BILLING_ONLY`, suspensión y trial vencido.
- Webhooks duplicados/fuera de orden.
- Carrera de reserva y carrera de aprovisionamiento.
- Rotación de claves y credenciales.
- Backup/restauración de un único tenant sin afectar otro.

#### Migraciones de flota

- Inventario de versión por `TenantDatabase.schemaVersion`.
- Canario interno, lotes pequeños, pausa automática por tasa de error.
- Migraciones expand/contract; nunca depender de rollback destructivo.
- Estado y error visibles desde una consola de plataforma.

#### Observabilidad

- `requestId`, `tenantId`, actor, ruta, latencia y resultado en logs estructurados.
- Métricas por tenant sin datos sensibles.
- Alertas para cola, webhooks, conexiones, migraciones, backups y pagos.
- `AuditLog` para accesos administrativos, equipo, canales, exportación y facturación.

#### Terminado cuando

- Existe evidencia automática de aislamiento y un simulacro documentado de restauración.

### M10 — Lanzamiento en `app.synapselogik.com`

#### Ambientes

- Local.
- Staging con dominios, Stripe test y números/canales de prueba.
- Producción limpia, sin reutilizar volúmenes legacy.

#### Secuencia

1. Migrar control plane.
2. Desplegar provisionador y verificar permisos.
3. Desplegar web con alta pública apagada.
4. Crear un tenant interno por el flujo real.
5. Completar onboarding, portal, invitación, canal y pago test.
6. Probar backup/restauración y aislamiento.
7. Activar alta por invitación.
8. Activar alta pública con protecciones.
9. Redirigir el host legacy únicamente tras la aceptación.

#### Banderas mínimas

- `MULTITENANT_AUTH_ENABLED`
- `MULTITENANT_RUNTIME_ENABLED`
- `MULTITENANT_PUBLIC_SIGNUP_ENABLED`
- `MULTITENANT_PUBLIC_PORTAL_ENABLED`
- `MULTITENANT_CHANNELS_ENABLED`
- `MULTITENANT_INVITATIONS_ENABLED`
- `BILLING_STRIPE_ENABLED`

### M11 — PWA y aplicaciones iOS/Android

La app móvil empieza después de estabilizar `/api/t/{slug}/v1`; no debe hablar con Server Actions ni replicar reglas de negocio.

#### Primera entrega móvil

- Una sola app de plataforma.
- Login global y selector de negocio.
- Agenda, inbox, contactos/pacientes y notificaciones.
- Deep links que siempre incluyen el contexto del tenant.
- Tokens de sesión rotables en almacenamiento seguro del dispositivo.
- Registro push en `DeviceInstallation` ligado a `userId + tenantId`.
- Borrado de cuenta, privacidad y cierre de sesión remota.

#### PWA primero

El dashboard responsive y una PWA instalable validan navegación móvil, offline limitado y notificaciones antes de mantener dos binarios de tiendas.

#### Terminado cuando

- El mismo usuario puede cambiar entre tenants sin mezclar caché, notificaciones ni archivos.
- Web, PWA, Android e iOS ejercen exactamente las mismas autorizaciones de servidor.

## Puertas de lanzamiento

### Beta interna

- M1 para servicios, especialistas, contactos y calendario.
- M2 núcleo.
- M5 portal aislado.
- Pruebas mínimas de M9.

### Beta por invitación

- M3 verificación/recuperación.
- M4 invitaciones.
- M6 al menos Meta por tenant.
- M7 archivos privados.
- M8 Stripe test + límites básicos.

### Beta pública de pago

- Rate limit compartido y CAPTCHA.
- Stripe live y reconciliación.
- Backups/restauración ensayados.
- Privacidad, términos, retención, exportación y eliminación operables.
- Monitoreo y soporte para aprovisionamiento/canales/pagos.

## Plan de cierre desde el estado actual

Este checklist es el camino restante hasta beta pública. Ninguna credencial se guarda en Git.

### R0 — Activar correo transaccional y alta pública

Estado: **desplegado; falta la certificación manual del recorrido completo**.

- [x] Verificar `synapselogik.com` en Resend.
- [x] Preparar `EMAIL_FROM=SynapseLogik CRM <soporte@synapselogik.com>`.
- [x] Preparar `EMAIL_REPLY_TO=contacto@synapselogik.com`.
- [x] Confirmar que Cloudflare Email Routing entrega `contacto@synapselogik.com` en el Gmail del propietario.
- [x] Crear una API key de Resend con permiso exclusivo de envío y restringida a `synapselogik.com`.
- [x] Guardar la API key una sola vez en el gestor de secretos del despliegue como `RESEND_API_KEY`; nunca en archivos versionados.
- [x] Crear Turnstile administrado para `app.synapselogik.com` y separar las acciones `signup`/`password_reset` con validación de hostname en servidor.
- [x] Desplegar primero con `MULTITENANT_PUBLIC_SIGNUP_ENABLED=false`.
- [x] Probar entrega real desde `soporte@synapselogik.com`, firma del dominio y `Reply-To: contacto@synapselogik.com`.
- [x] Probar localmente vencimiento y consumo único del enlace de verificación; repetir la prueba con correo real después del despliegue.
- [x] Activar `MULTITENANT_PUBLIC_SIGNUP_ENABLED=true` después de crear el control plane y comprobar el readiness remoto.

### R1 — Desplegar la plataforma base en `app.synapselogik.com`

- [x] Crear DNS/proxy/TLS para `app.synapselogik.com`.
- [x] Validar localmente la imagen candidata con Next/TypeScript/ESLint, Compose y un build Docker completo; no se publicó la imagen.
- [x] Cambiar `AUTH_URL` y `APP_BASE_URL` a `https://app.synapselogik.com` al desplegar la nueva plataforma.
- [x] Validar en local la creación automática de una base limpia de control plane y sus seis migraciones.
- [x] Desplegar web, provisioner y `tenant-worker` como procesos separados.
- [x] Diseñar y verificar que `TENANT_POSTGRES_ADMIN_URL` se entregue sólo al provisioner; la web nunca recibe permisos DDL.
- [~] Configurar cifrado de credenciales y secretos de webhooks fuera de la imagen Docker. El cifrado ya está configurado; el bucket S3 privado se mantiene apagado hasta elegir el proveedor y hacer una prueba de carga.
- [~] Añadir health checks y alertas para web, provisioner, worker, cola y PostgreSQL. El readiness remoto y los health checks de los tres procesos están activos; faltan alertas externas y una política de backup.

### R2 — Certificar el recorrido de autoservicio

- [ ] Ejecutar: landing → signup → correo → verificación → login → aprovisionamiento → wizard → dashboard.
- [ ] Comprobar en el despliegue reintentos, doble clic, correo ya registrado, slug ocupado y fallo temporal de Resend; vencimiento y uso único ya pasaron localmente.
- [x] Confirmar localmente que el trial comienza cuando la DB queda `READY`, no al llenar el formulario; repetir como smoke test desplegado.
- [x] Validar localmente recuperación de contraseña y revocación de sesiones; repetir con correo real desplegado.
- [ ] Medir tiempo de alta y mantenerlo visible si el provisionamiento tarda.

Consulta [`multitenant-beta-smoke-test.md`](./multitenant-beta-smoke-test.md) para ejecutar y registrar esta prueba sin introducir datos de clientes reales durante la validación técnica.

### R3 — Certificar funciones tenant ya construidas

- [ ] Activar las banderas una por una en staging: portal, invitaciones, canales y almacenamiento privado.
- [ ] Probar servicios, especialistas, contactos, pacientes, agenda, pipeline y onboarding con dos tenants.
- [ ] Probar invitación por cada rol y corte inmediato al desactivar una membresía.
- [ ] Probar reservas concurrentes y enlaces públicos de consulta/cancelación.
- [ ] Probar Meta y WuzAPI con eventos repetidos, desconocidos y fuera de orden.
- [ ] Terminar la migración del inbox, caja/reportes y configuración avanzada que aún vive en la superficie legacy.

### R4 — Backups, seguridad y operación

- [ ] Automatizar backup del control plane, de cada DB tenant y del bucket privado.
- [ ] Restaurar un solo tenant en un simulacro sin afectar a los demás.
- [ ] Automatizar pruebas de aislamiento horizontal, roles y estados de acceso.
- [ ] Configurar retención, exportación y eliminación de cuenta/datos.
- [ ] Sustituir la llave AES compartida por cifrado de envolvente/KMS antes de abrir una beta pública amplia.
- [ ] Documentar rotación de llaves de Resend, Stripe, canales y credenciales PostgreSQL.

### R5 — Completar Stripe y límites de producto

- [ ] Crear productos, precios y precio fundador en modo test.
- [ ] Sembrar `Plan`, `BillingPrice` y entitlements en el control plane.
- [ ] Probar Checkout, Customer Portal, webhooks duplicados y reconciliación periódica.
- [ ] Aplicar límites en servidor para asientos, canales, almacenamiento, IA y campañas.
- [ ] Probar trial vencido, impago, cancelación, reactivación y modos `READ_ONLY`/`BILLING_ONLY`.
- [ ] Mostrar antes del pago el aviso beta y de comprobante digital sin CFDI.
- [ ] Pasar a Stripe live sólo cuando las pruebas anteriores tengan evidencia.

### R6 — Lanzamiento gradual

- [ ] Crear tenant interno mediante el flujo público real.
- [ ] Abrir beta por invitación y observar aprovisionamiento, correo, canales y soporte.
- [ ] Abrir signup público con límites conservadores y alertas.
- [ ] Cambiar los CTA de la landing hacia `https://app.synapselogik.com/signup`.
- [ ] Mantener el CRM legacy disponible durante la aceptación y retirarlo sólo con respaldo verificado.

### R7 — PWA y tiendas móviles

- [ ] Convertir la web responsive en PWA instalable y validar navegación móvil, caché y deep links por tenant.
- [ ] Estabilizar el contrato `/api/t/{slug}/v1` antes de crear binarios.
- [ ] Publicar una sola app de plataforma para iOS y Android con login global y selector de tenant.
- [ ] Añadir push por `userId + tenantId`, almacenamiento seguro de sesión, borrado de cuenta y cierre remoto.
- [ ] Preparar privacidad, capturas, ficha de tienda y revisión de Apple/Google.

## Próxima unidad de trabajo

Ejecutar **R2** con una persona de prueba: correo → verificación → inicio de sesión → aprovisionamiento → wizard → dashboard. El dominio canónico ya es `app.synapselogik.com`; web, control plane, provisionador y worker están activos con una réplica cada uno, y el readiness remoto confirma ambas bases. La prueba requiere que la persona complete Turnstile en el navegador; ese desafío no se automatiza. Después se retoma **M8/R5 — Stripe** y se habilitan portal, invitaciones, canales y almacenamiento privado de uno en uno, con sus credenciales y pruebas correspondientes.
