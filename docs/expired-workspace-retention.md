# Acceso vencido y conservación de datos

## Experiencia

- El ingreso de un miembro activo sigue entrando al CRM cuando vence la prueba o la mensualidad. La comparación de planes se abre sólo desde **Seleccionar un plan**.
- Desde el vencimiento: consulta y exportación por el propietario, con las operaciones bloqueadas. El aviso inicial dice **Tu periodo de prueba ha terminado** (o **Tu suscripción ha terminado**) y **Puedes consultar y exportar tus datos. Selecciona un plan para seguir trabajando.**
- A partir de un mes calendario sin periodo vigente: el aviso y la barra destacan la fecha exacta de eliminación.
- A los tres meses calendario: termina la consulta y el worker procesa la eliminación del negocio. La sesión de usuario y sus otros negocios no se eliminan.
- La fecha parte del fin del último periodo pagado registrado; si nunca hubo uno, del fin de la prueba. Entrar, cerrar el aviso o cancelar la renovación no reinician el reloj. Una renovación verificada o una nueva prueba concedida por un administrador sí suspenden el trabajo pendiente.
- Los meses se calculan en la zona horaria del negocio, ajustando fines de mes y cambios de horario. Por ejemplo, vencimiento el 13 de octubre: aviso de eliminación desde el 13 de noviembre y fecha límite el 13 de enero.
- Los roles del negocio siguen aplicando: sólo el propietario puede administrar la suscripción y exportar. El personal puede consultar lo que sus permisos ya permitían.

## Bloqueo y limpieza

`workspaceBillingState` recalcula el acceso a partir de los periodos en cada resolución de contexto, incluso si el worker aún no actualizó `Tenant.accessMode`. Conserva suspensiones administrativas y no desbloquea negocios sin datos de vencimiento verificables.

El Prisma enrutado bloquea las escrituras. El proxy rechaza las mutaciones de APIs operativas antes de llamar a servicios externos, manteniendo facturación, autenticación y eliminación de cuenta. Las automatizaciones, el portal público y los envíos de WhatsApp revalidan el estado. Las lecturas de clientes y calendario omiten sincronizaciones que escribían como efecto secundario.

`billing-lifecycle-worker` mantiene un trabajo `TenantDataRetention` por negocio. `account-deletion-worker` lo revalida bajo el bloqueo de tenant antes de congelar membresías y reutilizar `purgeTenant`: cancela renovaciones, desconecta canales y Google, limpia archivos/objetos privados, elimina la base y sus roles, y retira los registros del negocio. Conserva un comprobante técnico sin nombre, correo ni credenciales. No elimina la identidad global.

Una renovación registrada antes de la congelación cancela el borrado. Un pago reciente pendiente pospone la comprobación. Los fallos de limpieza dejan el negocio congelado y se reintentan; no se ofrece una recuperación de datos ya eliminados. Los respaldos externos mantienen su propio ciclo de caducidad y no vuelven a publicarse automáticamente.

**Adopción segura:** un negocio que ya hubiera superado los tres meses cuando se detecta por primera vez queda en `REVIEW_REQUIRED`. No se borra inmediatamente al desplegar esta política. Los trabajos programados antes de su fecha límite sí se procesan automáticamente cuando vence el plazo. Una suspensión administrativa tampoco provoca limpieza automática.

## Exportación

Descarga del propietario desde el aviso o Plan y facturación: archivo JSONL con manifiesto, registros por tipo y marcador final `complete`. Incluye usuarios sin credenciales, clientes, conversaciones y texto de mensajes, citas, equipo, categorías/servicios, movimientos y cierres de caja, pipeline y fuentes de conocimiento/FAQs. No incluye los archivos adjuntos binarios, secretos de canales, contraseñas, tokens públicos de reserva ni registros financieros del proveedor. Es una exportación de datos, no una copia restaurable de la base.

Se pagina de 250 en 250 y se revalida el acceso entre páginas. Cancelar la descarga detiene las consultas; una interrupción no lleva marcador final. Las respuestas son privadas y no se cachean.

## Verificación y despliegue

1. Aplicar la migración aditiva `20261013000000_expired_workspace_retention` al control plane. No modifica pruebas, pagos ni bases de negocios.
2. Publicar la misma imagen en web, worker de tenant, provisioner, facturación y eliminación de cuentas.
3. Verificar ingreso de un propietario vencido, aviso breve, consulta, rechazo de cambios, exportación y navegación a planes; probar aviso del segundo mes con datos ficticios.
4. Verificar `/api/health?scope=ready` y el funcionamiento de los workers.

Pruebas de política/acceso/exportación: `node --experimental-strip-types --test tests/workspace-retention.test.mts`. Integración destructiva aislada: `CONTROL_DATABASE_URL=postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control node scripts/test-tenant-retention.mjs`. El script rechaza otros destinos, crea un esquema y una base desechables y verifica limpieza real, conservación de identidad/otro negocio, renovación, nueva fecha pagada, adopción de cuentas antiguas y reintentos.

Demo local sobre las bases ficticias ya migradas: `node scripts/setup-expired-workspace-local.mjs` y `npm run dev -- --hostname 127.0.0.1 --port 3108`. Login: `owner-expiry@crm.local` / `CRM-Local-Expiry-2026!`. `--warning` prepara el segundo mes; cambia únicamente el fixture local. Se respalda `.env.local` en `.env.local.before-expiry-demo`. No configura claves de IA, WhatsApp ni cobros.

Rollback de la imagen: conservar la tabla nueva; la imagen anterior la ignora. Detener el worker nuevo de eliminación antes de revertir si fuera necesario. Un rollback de código no recupera datos ya borrados.
