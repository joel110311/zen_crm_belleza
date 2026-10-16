# Base neutra común para los temas

15 de octubre de 2026.

Joel solicita conservar el color de cada tema como acento, con fondos neutros comunes en claro y oscuro. Esta decisión sustituye las superficies teñidas de las variantes anteriores.

## Cambio

- Los cinco temas (Azul clínica, Apple, Olive, Pink y Gold · Oro) comparten blanco y grises en claro; negro y grises en oscuro.
- Se centralizan fondo, tarjetas, paneles, texto secundario, bordes, campos, lateral, barras de desplazamiento y burbujas. Se eliminan los gradientes del fondo general.
- Se conservan los acentos de acciones, iconos, foco, selección, gráficos y estados. El color configurado por cada negocio para su portal público sigue independiente.
- Las muestras del selector muestran el acento junto a las superficies neutras. Las etiquetas de audios y documentos enviados usan el texto general sobre su burbuja neutra.
- Sin cambios de datos, permisos, navegación, contratos ni tablas. Se actualiza `DESIGN.md` para futuras modificaciones.

## Verificación

- Compilación de producción y comprobación de TypeScript correctas.
- ESLint del componente modificado, sin errores.
- Suite completa: 336 pruebas, 334 aprobadas, dos omitidas y cero fallos.
- Navegador local con datos de prueba: Apariencia en los cinco temas × dos modos × seis anchos CSS (320, 375, 390, 768, 1024 y 1440): 60 casos, sin desbordamiento horizontal. Los tokens neutros coinciden entre temas para cada modo; el fondo calculado del cuerpo es blanco o negro y no tiene imagen.
- Inspección visual de capturas en los seis anchos; comprobaciones adicionales de Hoy, Chats y del formulario de citas. Diálogo a 320 × 500: contenido desplazable y botones Cancelar/Continuar visibles dentro de la pantalla.
- Evidencia local en `output/neutral-themes/`: `audit.json`, capturas `verified-*`, muestras Pink claro/oscuro, inicio, chats, diálogo y registros de compilación/pruebas/lint. Las capturas de la matriz que no reflejaron correctamente la pintura del navegador se descartaron; se conservan las capturas inspeccionadas por separado.

La revisión se realizó en Edge con tamaños de navegador, no en teléfonos físicos ni como certificación completa de accesibilidad. No se enviaron mensajes ni se crearon citas durante la revisión.

## Entrega

No requiere migraciones. Joel realiza el redespliegue después del commit y push a `origin/main`.
