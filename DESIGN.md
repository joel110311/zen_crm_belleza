# Diseño del CRM: identidad y temas

Actualizado el 15 de octubre de 2026. Guía del proyecto para futuras modificaciones, subordinada a las decisiones explícitas de Joel.

## Dirección aprobada

Conservar el rediseño adaptable aprobado, la tipografía, iconos, tamaños táctiles, navegación y prioridades de cada pantalla. Los temas cambian únicamente el acento; comparten la misma base neutra. No cambian datos, permisos ni funciones. No restaurar Pipeline, Reportes ni la antigua Caja.

Celular: una tarea clara, texto completo, campos de 16 px y controles de al menos 44 px. Escritorio: aprovechar columnas y densidad sin empequeñecer letras. Usar superficies suaves y un acento principal; sin efectos metálicos, gradientes decorativos, neones, tipografías nuevas o fotografías añadidas para cambiar un tema.

## Referencias utilizadas

- Taste Skill, **Redesign Existing Projects**: https://github.com/Leonxlnx/taste-skill. Auditar, corregir en el stack existente y comprobar en navegador.
- **Awesome DESIGN.md**, VoltAgent: https://github.com/VoltAgent/awesome-design-md. Es una colección de documentos de diseño, sin SKILL.md instalable en la revisión consultada. Se aplica como referencia de diseño y no como software ejecutable.
- Análisis de **Oura**, revisión `3b605329240ce735b510037cca322f1831fdd7f8`: https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/oura/DESIGN.md. Se toman el criterio de superficies cálidas, jerarquía de neutros, espaciado y controles táctiles. Gold adapta su familia tierra/dorado a un CRM; no copia el azul de conversión ni sus titulares editoriales.
- Análisis de **Lamborghini**, misma revisión: https://github.com/VoltAgent/awesome-design-md/blob/3b605329240ce735b510037cca322f1831fdd7f8/design-md/lamborghini/DESIGN.md. Se toma únicamente la disciplina del acento dorado y la separación por superficies. No se trasladan los vídeos, negro absoluto, mayúsculas, tamaños gigantes ni geometría del sitio automotriz.
- Referencia Pink aportada por Joel: captura adjunta y https://play.google.com/store/apps/details?id=com.arbo.agenda. Se interpreta como una dirección de color para belleza; la estructura funcional sigue siendo la del CRM.

## Paletas

| Tema | Identificador conservado | Acento claro | Acento oscuro |
|---|---|---|---|
| Azul clínica | `clinic` | Azul clínico existente | Azul clínico existente |
| Apple | `apple` | `#0071e3` | `#2997ff` |
| Olive | `green` | `#4c612b` | `#bdcd96` |
| Pink | `pink` | `#a7426b` | `#eba6c1` |
| Gold · Oro | `gold` | `#89651f` | `#ddbe78` |

**Decisión posterior de Joel, 15 de octubre de 2026:** todos los temas comparten fondos neutros. Claro: fondo y tarjetas blancos, secundarios grises claros. Oscuro: fondo negro `#000000`, tarjetas y lateral `#1e1e1e`, secundarios `#2c2c2c`. Texto, bordes, formularios, barras de desplazamiento y burbujas usan grises, sin matices azules, rosas, verdes o dorados. Se retiran los fondos de color y gradientes de las primeras variantes.

El color aparece en botones de acción, iconos, indicadores, foco y selecciones puntuales. No teñir otra vez toda la pantalla ni las tarjetas de contenido por cambiar el acento. Los colores de estado y de datos conservan su significado. El color propio configurado para el portal público permanece independiente del tema del navegador.

## Roles y estados

Usar tokens semánticos: texto general, texto secundario, borde, superficie, acento y texto sobre acento. Los acentos pastel del modo oscuro necesitan texto oscuro en botones sólidos. Errores y badges destructivos también deben usar su propio color de texto, evitando blanco fijo sobre rojo claro. Las etiquetas de audios y documentos enviados están sobre una burbuja suave, no sobre un botón sólido; su contraste se evalúa por separado.

La tarjeta de próxima cita y el lateral usan la base neutra compartida. Reservar el acento sólido para acciones, navegación seleccionada y señales pertinentes. Estados de éxito/error conservan su significado y texto.

## Comprobación

Probar 320, 375, 390, 768, 1024 y 1440 px CSS y altura reducida. Revisar Hoy, Apariencia, Agenda/formulario y Chats; comprobar claro/oscuro, selección persistente, foco y contraste. Una medición de contraste de tokens no certifica toda la aplicación. Guardar capturas y resultados locales, y documentar pendientes de dispositivos físicos.
