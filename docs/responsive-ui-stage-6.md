# Sexta entrega: Mi negocio, Servicios y Especialistas

Fecha: 15 de octubre de 2026. Implementada en la web actual. No requiere migraciones ni tablas nuevas. Joel realiza el redespliegue.

## Resultado

- Mi negocio: Negocio, Portal y Marca conservan sus funciones actuales. Datos comerciales primero; logotipo, horarios, región/moneda y políticas se despliegan por sección. Guardar permanece sobre la navegación móvil. El estado de cambios pendientes corresponde a la sección abierta; salir de la página con cambios de negocio/marca advierte mediante el navegador. No hay borradores persistentes ni bloqueo de todas las navegaciones internas.
- La carga fallida de configuración muestra error y permite reintentar; guardar queda deshabilitado hasta cargar los datos. Evita enviar valores iniciales si la petición falla. Portal también espera su configuración antes de permitir guardar.
- Servicios: búsqueda por nombre, descripción, categoría o especialista, tolerante a acentos; fichas con precio, duración, disponibilidad y acciones separadas. Categorías conserva búsqueda y edición. Los nombres largos ocupan varias líneas.
- Editores de servicio/categoría: cuerpo desplazable y acciones al pie. Foto/precio público, preguntas previas, preparación y cuidados quedan en secciones desplegables; se mantienen importes decimales, duración, especialistas y todas las opciones existentes.
- Cancelar una ficha modificada ofrece conservar o descartar el borrador. Eliminar servicio/categoría pide confirmación. Los botones de edición se bloquean durante el guardado/actualización para evitar reabrir datos anteriores.
- Especialistas: búsqueda, fichas adaptables y formulario con datos prioritarios primero. Foto opcional desplegable. Bloquear agenda abre un formulario independiente, con fechas legibles y acciones accesibles incluso a 320 × 500.
- Se conserva el límite existente de 5 especialistas activos del backend; esta entrega no modifica planes ni límites comerciales.
- Abrir/actualizar Especialistas consulta el estado de Google sin ejecutar descubrimiento mediante POST. El descubrimiento se solicita desde Sincronizar Google; conserva el enlace y sincronización existentes.
- Cuenta vencida: consultar fichas y configuración permanece disponible; crear, editar, sincronizar y subir archivos se deshabilitan. Copiar/abrir el portal sigue disponible. El servidor conserva sus validaciones existentes de permisos, aislamiento y escritura.
- Se conserva el color del negocio y se evita el encabezado global duplicado en estos módulos. No se modifica el motor de IA, facturación, contratos de API ni esquema de datos.

## Comprobaciones

Compilación de producción, TypeScript, ESLint de los archivos afectados y `git diff --check` correctos. Suite existente: **303 aprobadas, 2 omitidas y 0 fallidas** (305 pruebas).

Edge en anchos CSS efectivos **320, 375, 390, 768, 1024 y 1440 px**: negocio, horarios, región, políticas, portal y marca; catálogo/categorías y sus formularios; equipo, edición y bloqueo de agenda. También 320 × 500, 390 × 500 y catálogo/formulario a 390 × 320. Se corrigió el desbordamiento de Marca a 320 px y el desplazamiento del catálogo en ventanas de poca altura. Registro: **109 comprobaciones de geometría, sin desbordamientos detectados**. No equivale a una auditoría de accesibilidad ni cubre todas las combinaciones posibles de datos.

Recorridos con datos ficticios en las bases dedicadas de localhost:5446:

| Recorrido | Resultado observado |
|---|---|
| Nombre comercial: editar, guardar y restaurar | Persistencia y confirmación de guardado |
| Portal: cambiar nombre y guardar | Nuevo nombre conservado |
| Crear categoría y modificar descripción larga | Categoría y texto recuperados |
| Crear servicio de $185.50 y 47 minutos, asignar especialista y cambiar categoría | Valores y categoría recuperados al reabrir |
| Ocultar/restaurar precio público | Opción conservada; importe interno se mantiene |
| Crear especialista de nombre largo y área | Ficha y formulario recuperan los datos |
| Crear bloqueo para Sofía | Bloqueo visible en su ficha |
| Borrador de servicio/especialista: conservar o descartar | Confirmación accesible en 320 × 500; descartar no guarda |
| Eliminar servicio/categoría y cancelar | Confirmación legible; no se borra ningún registro |
| Elegir imagen de prueba para logotipo y cancelar | Recortador accesible a 390 × 500; no se sube ni guarda la imagen |
| Cuenta vencida | Consulta disponible; escritura bloqueada en interfaz |
| Personal PROFESIONAL sin permisos de administración | Rutas directas de negocio, servicios y especialistas vuelven al dashboard |

Evidencia local: `output/responsive-ui-stage-6/qa-layout.json`, capturas y registros de pruebas/compilación. La carpeta está ignorada por Git. Se utilizó la base de fixtures ya existente; no se ejecutaron migraciones ni operaciones en producción. Las verificaciones de permisos no amplían el acceso del personal.

## Límites y siguiente bloque

Pendiente la revisión en teléfonos físicos Android/Chrome e iPhone/Safari, incluyendo teclado, gestos y áreas seguras. Google no está conectado en el entorno de pruebas: no se verificó una sincronización real ni se enviaron mensajes o datos a proveedores. Se probó abrir/cancelar el recortador; no se verificó una subida real de imagen en esta entrega.

Siguiente bloque: **Recepción**, después reportes y Plan/facturación. Finalmente configuración, accesos y pantallas públicas, con regresión integral.
