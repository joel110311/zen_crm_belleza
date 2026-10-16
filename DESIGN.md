# Diseño del CRM: identidad y temas

Actualizado el 15 de octubre de 2026. Guía del proyecto para futuras modificaciones, subordinada a las decisiones explícitas de Joel.

## Dirección aprobada

Conservar el rediseño adaptable aprobado, la tipografía, iconos, tamaños táctiles, navegación y prioridades de cada pantalla. Los temas cambian color y superficies; no cambian datos, permisos ni funciones. No restaurar Pipeline, Reportes ni la antigua Caja.

Celular: una tarea clara, texto completo, campos de 16 px y controles de al menos 44 px. Escritorio: aprovechar columnas y densidad sin empequeñecer letras. Usar superficies suaves y un acento principal; sin efectos metálicos, gradientes decorativos, neones, tipografías nuevas o fotografías añadidas para cambiar un tema.

## Referencias utilizadas

- Taste Skill, **Redesign Existing Projects**: https://github.com/Leonxlnx/taste-skill. Auditar, corregir en el stack existente y comprobar en navegador.
- **Awesome DESIGN.md**, VoltAgent: https://github.com/VoltAgent/awesome-design-md. Es una colección de documentos de diseño, sin SKILL.md instalable en la revisión consultada. Se aplica como referencia de diseño y no como software ejecutable.
- Análisis de **Oura**, revisión `3b605329240ce735b510037cca322f1831fdd7f8`: https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/oura/DESIGN.md. Se toman el criterio de superficies cálidas, jerarquía de neutros, espaciado y controles táctiles. Gold adapta su familia tierra/dorado a un CRM; no copia el azul de conversión ni sus titulares editoriales.
- Análisis de **Lamborghini**, misma revisión: https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/lamborghini/DESIGN.md. Se toma únicamente la disciplina del acento dorado y la separación por superficies. No se trasladan los vídeos, negro absoluto, mayúsculas, tamaños gigantes ni geometría del sitio automotriz.
- Referencia Pink aportada por Joel: captura adjunta y https://play.google.com/store/apps/details?id=com.arbo.agenda. Se interpreta como una dirección de color para belleza; la estructura funcional sigue siendo la del CRM.

## Paletas

| Tema | Identificador conservado | Acento claro | Superficie suave | Fondo claro | Acento oscuro |
|---|---|---|---|---|---|
| Olive | `green` | `#4c612b` | `#edf1e5` | `#fafbf7` | `#bdcd96` |
| Pink | `pink` | `#a7426b` | `#f8e7ef` | `#fff8fb` | `#eba6c1` |
| Gold · Oro | `gold` | `#89651f` | `#f5ead2` | `#fcfaf5` | `#ddbe78` |

Olive parte de los colores del prototipo aprobado en `output/responsive-crm-prototype/index.html`. No sustituirlo por verde esmeralda en oscuro. Su texto secundario se oscurece ligeramente frente al prototipo para mejorar contraste sobre salvia. Pink usa rosa empolvado con frambuesa. Gold usa oro antiguo en claro y champán en oscuro, evitando amarillo saturado.

Azul clínica y Apple mantienen sus paletas actuales. El color propio configurado para el portal público permanece independiente del tema del navegador.

## Roles y estados

Usar tokens semánticos: texto general, texto secundario, borde, superficie, acento y texto sobre acento. Los acentos pastel del modo oscuro necesitan texto oscuro en botones sólidos. Errores y badges destructivos también deben usar su propio color de texto, evitando blanco fijo sobre rojo claro. Las etiquetas de audios y documentos enviados están sobre una burbuja suave, no sobre un botón sólido; su contraste se evalúa por separado.

La tarjeta de próxima cita y el lateral pueden usar los tonos suaves del tema sin teñir toda la pantalla. Reservar el acento sólido para acciones, navegación seleccionada y señales pertinentes. Estados de éxito/error conservan su significado y texto.

## Comprobación

Probar 320, 375, 390, 768, 1024 y 1440 px CSS y altura reducida. Revisar Hoy, Apariencia, Agenda/formulario y Chats; comprobar claro/oscuro, selección persistente, foco y contraste. Una medición de contraste de tokens no certifica toda la aplicación. Guardar capturas y resultados locales, y documentar pendientes de dispositivos físicos.
