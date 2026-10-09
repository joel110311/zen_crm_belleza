# Desplegar el acceso administrativo con soporte

## Antes de actualizar

1. Esperar que **Build and Push Docker Image** del commit publicado esté verde en
   GitHub Actions. Usar la etiqueta de siete caracteres de ese commit, sin prefijo
   `sha-`: `ghcr.io/joel110311/zen_crm_belleza:COMMIT_CORTO`.
   El propietario también puede usar `:latest`, como queda en el YAML del repo:
   es una etiqueta móvil, no un identificador inmutable. Re-descargar/resolver la
   imagen al actualizar y comprobar la etiqueta OCI `org.opencontainers.image.revision`
   o el digest en producción; anotar la imagen anterior para rollback.
2. Conservar una copia privada del YAML y los valores actuales de Portainer. No
   subir secretos a Git ni reutilizar contraseñas de Eventiia.
3. Este cambio no requiere migraciones ni modificar PostgreSQL, Redis, gateway,
   redes, volúmenes, claves de cifrado o las credenciales de clientes.

## Opción recomendada: guardar el cambio en el stack

En **Portainer → Stacks → crm-belleza → Editor**, cambiar únicamente la imagen
del servicio web `belleza-crm` a la etiqueta publicada. Conservar las imágenes y
configuración actuales de los demás servicios.

Dentro de `services.belleza-crm.environment`, agregar estas líneas si no existen:

```yaml
      - ADMIN_USERNAME=${ADMIN_USERNAME:-adminjoel}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
```

En **Environment variables** del stack agregar:

- `ADMIN_USERNAME`: `adminjoel`.
- `ADMIN_PASSWORD`: contraseña nueva, exclusiva del CRM, entre 20 y 128 caracteres.

La contraseña se captura directamente en Portainer, no se pega en el YAML. Si ya
hay una contraseña configurada, conservarla salvo que se quiera rotar el acceso.
Sin un valor válido, la nueva identidad administrativa permanece desactivada.
`INITIAL_ADMIN_PASSWORD` no es la contraseña de este acceso.

Actualizar el stack. No seleccionar ninguna opción para eliminar volúmenes ni
recrear bases. Mantener el orden de actualización **start-first** del servicio web
si ya está configurado; un worker programado debe continuar **stop-first**.

La sección `environment` admite un mapa `CLAVE: valor` o una lista de cadenas
`- CLAVE=valor`, pero no mezclar ambas formas dentro de una lista. En este YAML
usar `- ADMIN_USERNAME=${ADMIN_USERNAME:-adminjoel}` y
`- ADMIN_PASSWORD=${ADMIN_PASSWORD:-}`. No usar `- ADMIN_USERNAME: ...`.

## Alternativa: actualizar únicamente el servicio web

En **Services → crm-belleza_belleza-crm**, editar la imagen y agregar las dos
variables al entorno del servicio. Si el registro GHCR está seleccionado, el
campo de imagen usa `joel110311/zen_crm_belleza:COMMIT_CORTO`.

Aplicar los cambios y comprobar la tarea nueva en estado running. Esta alternativa
no actualiza la definición del stack: guardarla también en el editor cuando sea
posible, para que un despliegue posterior no quite las variables ni vuelva atrás.

## Verificación después del despliegue

1. Confirmar el servicio web en `1/1` con la imagen esperada y sin reinicios.
2. Abrir `/api/health?mode=readiness&strict=true`: esperar HTTP 200 y `ok: true`.
3. Entrar a `https://app.synapselogik.com/control/login` como `adminjoel`.
   El primer login válido inicializa la identidad interna y deja auditoría.
4. En **Revisar negocios**, buscar Logicapp o una cuenta recién creada. Elegir
   **Abrir CRM** o **Revisar alta**, indicar motivo y entrar con acceso completo.
5. Comprobar dashboard, chats, imágenes/audio y wizard. No enviar mensajes ni
   cambiar datos de un cliente sólo para probar: usar un negocio de prueba propio.
6. Regresar por **Centro de mando** y abrir otro negocio. La sesión anterior deja
   de autorizar a `adminjoel`; cada sesión dura 30 minutos. No aparece un banner.
7. Verificar por separado que el propietario normal sigue entrando a su CRM y
   que no ve el panel administrativo ni negocios ajenos.

Los accesos quedan en `AuditLog` (`support.workspace.started` / `.ended`), sin
crear membresías permanentes. Con edición se usa un actor local de soporte; no se
cambia la contraseña del cliente ni se suplanta su identidad.

## Si la verificación falla

Volver la imagen web a `ghcr.io/joel110311/zen_crm_belleza:6296cf1`, manteniendo
todos los volúmenes y secretos actuales. Esa versión incluye la reparación del
falso 404 y el login dedicado, pero no permite entrar a negocios como soporte.
No hace falta revertir una migración de esta entrega porque no contiene ninguna.

Nunca prometer que no habrá caídas: la base PostgreSQL y el plano de control son
dependencias compartidas. El aislamiento de aplicación no sustituye backups
fuera del servidor, una restauración verificada ni infraestructura redundante.
