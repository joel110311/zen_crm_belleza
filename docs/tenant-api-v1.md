# API multitenant v1

## Base y autenticación

Las rutas operativas viven en `/api/t/{tenantSlug}/v1`. Requieren una sesión del control plane, membresía activa en el slug solicitado, tenant `READY`, base tenant `READY` y permiso para el recurso.

El middleware deja pasar `/api/t/*` para que la propia API responda JSON; nunca redirige un cliente móvil a HTML de login.

## Contrato

Respuesta exitosa:

```json
{
  "data": {},
  "meta": { "requestId": "uuid" }
}
```

Error:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "No tienes permiso para realizar esta acción.",
    "requestId": "uuid"
  }
}
```

El encabezado `x-request-id` replica el identificador de la respuesta. Puede enviarse un `x-request-id` propio si contiene entre 8 y 100 caracteres seguros.

## Mutaciones e idempotencia

Todo `POST`, `PATCH` y `DELETE` exige `Idempotency-Key` de 8 a 200 caracteres (`a-z`, `A-Z`, dígitos, punto, guion, guion bajo o dos puntos).

- La primera ejecución guarda su respuesta durante 24 horas en `ApiMutationReceipt` dentro de la DB tenant.
- Un reintento con la misma ruta, método, llave y cuerpo devuelve la respuesta original con `idempotent-replayed: true`.
- Reutilizar la llave con otro cuerpo devuelve `409 CONFLICT`.
- Una ejecución fallida libera la llave para permitir un reintento corregido.

## Recursos

| Recurso | Rutas principales |
| --- | --- |
| Servicios | `GET/POST /services`, `GET/PATCH/DELETE /services/{id}` |
| Categorías | `GET/POST /service-categories`, `PATCH/DELETE /service-categories/{id}` |
| Especialistas | `GET/POST /specialists`, `GET/PATCH/DELETE /specialists/{id}` |
| Disponibilidad | `GET/POST /specialists/{id}/availability-blocks`, `PATCH/DELETE /availability-blocks/{id}` |
| Contactos | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/{id}` |
| Fichas de clientes | `GET/POST /patients`, `GET/PATCH/DELETE /patients/{id}` |
| Calendario | `GET/POST /calendar`, `GET/PATCH/DELETE /calendar/{id}` |
| Pipeline | `GET /pipeline`, `POST /pipeline/stages`, `PATCH/DELETE /pipeline/stages/{id}`, `POST /pipeline/deals`, `PATCH/DELETE /pipeline/deals/{id}` |
| Onboarding | `GET/PATCH /onboarding` |

Los listados de contactos y fichas de clientes aceptan `q`, `page` y `pageSize` (máximo 100). Calendario acepta `from` y `to`, con un rango máximo de 93 días.

## Permisos base

| Rol | Acceso operativo |
| --- | --- |
| `OWNER`, `ADMIN` | Lectura y escritura en todos los recursos del núcleo. |
| `RECEPTION` | Lee catálogo/equipo; gestiona contactos, clientes, agenda y pipeline. |
| `PROFESSIONAL` | Lee catálogo y clientes; gestiona fichas de clientes y únicamente su propia agenda. No accede al pipeline. |

La interfaz oculta controles no autorizados, pero la API vuelve a validar cada operación. Los identificadores nunca se aceptan como prueba de pertenencia: todas las relaciones se consultan con el Prisma de la base tenant ya resuelta.

## Reglas de agenda

- Inicio anterior al fin y dentro del horario semanal del negocio.
- Cliente y especialista deben existir en la misma DB del negocio.
- Si un servicio restringe especialistas, el profesional debe estar asignado.
- Se rechazan traslapes con citas activas y bloqueos personales/globales.
- Sólo `OWNER` o `ADMIN` pueden crear sobrecitas.
- El borrado de una cita es una cancelación lógica que conserva el historial.
- La creación y reprogramación usan transacción `Serializable` para detectar carreras.

## Códigos relevantes

| HTTP | Código | Motivo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Cuerpo, campo o `Idempotency-Key` inválido. |
| 401 | `UNAUTHORIZED` | No existe sesión válida del control plane. |
| 402 | `BILLING_REQUIRED` | Tenant en modo sólo facturación. |
| 403 | `FORBIDDEN`, `READ_ONLY`, `TENANT_SUSPENDED` | Permiso o modo de acceso insuficiente. |
| 404 | `NOT_FOUND`, `TENANT_NOT_FOUND` | Recurso ausente o slug no revelable para el usuario. |
| 409 | `CONFLICT`, `TENANT_NOT_READY` | Colisión de negocio, agenda, idempotencia o provisión pendiente. |
| 503 | `TENANT_DATABASE_UNAVAILABLE` | La DB tenant no está marcada como lista. |
