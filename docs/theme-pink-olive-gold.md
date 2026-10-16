# Temas Pink, Olive y Gold

15 de octubre de 2026. Sin migraciones ni tablas nuevas. Joel realiza el redespliegue.

## Diseño y alcance

Se aplica Taste Skill, Redesign Existing Projects. Olive corrige la distancia entre el prototipo aprobado y el producto: acento `#4c612b`, salvia `#edf1e5`, fondo `#fafbf7`, texto `#22291e` y líneas `#e6e9e1`. El texto secundario se oscurece ligeramente para mejorar contraste. La tarjeta de próxima cita usa el salvia real, en lugar de una mezcla demasiado tenue. En oscuro se usa oliva/salvia sobre carbón cálido, sin pasar a esmeralda.

Pink añade rosa empolvado con frambuesa, y Gold · Oro añade oro antiguo, marfil y champán. Ambos tienen variante clara y oscura. Los tres temas mantienen la fuente, iconos, controles y organización aprobados. La navegación y las superficies comparten el acento; no se agregan gradientes metálicos, fotos ni cambios de datos.

Por petición de Joel se consultó VoltAgent/awesome-design-md. La revisión `3b605329240ce735b510037cca322f1831fdd7f8` es una colección DESIGN.md y no incluye SKILL.md instalable. Se utilizaron como referencias las guías Oura y Lamborghini, adaptadas al CRM. `DESIGN.md` documenta los criterios, paletas y enlaces, y AGENTS.md indica consultarlo en futuras tareas de diseño. No se presenta la colección como una skill instalada.

## Comportamiento

Los temas se eligen desde **Configuración → Apariencia → Tema de colores**. El antiguo identificador `green` se conserva para Olive y no se borra la preferencia existente. Pink y Gold usan el mismo catálogo tanto antes del primer render como al montar React, evitando volver a Azul al recargar. La selección sigue siendo local al navegador, como antes; no se introduce sincronización de cuenta ni almacenamiento en base de datos. Si el navegador bloquea almacenamiento, el cambio visual funciona durante esa sesión sin derribar la interfaz.

Se mantienen Azul clínica y Apple. La marca y el color propio configurado del portal público siguen siendo independientes del tema. Los botones y badges destructivos usan texto semántico para contrastar sobre los rojos claros de oscuro. También se corrigen etiquetas de medios enviados y un aviso de desconexión de WhatsApp en oscuro. No cambia la entrega de mensajes, reproducción, permisos ni conexión de canales.

## Verificación

- Compilación de producción, TypeScript, ESLint de archivos afectados y diff correctos.
- **334 pruebas aprobadas, 2 omitidas, 0 fallidas**, de 336. Cinco regresiones cubren restauración inicial, persistencia de Pink/Gold, compatibilidad de la clave Green, valores desconocidos y almacenamiento bloqueado.
- **72 combinaciones finales**: Hoy y Apariencia × Olive/Pink/Gold × claro/oscuro × anchos CSS efectivos **320, 375, 390, 768, 1024 y 1440**. Sin desbordamiento horizontal detectado; los botones del selector mantienen al menos 44 px. Evidencia en `output/pink-olive-themes/qa-final.json` y capturas por vista/tamaño.
- **78 pares de tokens** de texto y fondo alcanzan al menos **4.5:1**, incluyendo texto sobre acento, superficies secundarias, burbujas y acciones destructivas. Esto no certifica la accesibilidad de toda la aplicación. Evidencia `contrast.json`.
- En navegador, Pink y Gold permanecen seleccionados tras recargar. Se revisa el formulario de nueva cita en Gold oscuro a **320 × 500**: Continuar queda entre 440 y 484 px; no se crea una cita. El selector Gold también se alcanza desplazando la página a esa altura.
- Se revisa Chats en Gold claro/oscuro a 390 y en oscuro a 1440. Se abre la revisión de cancelación de una cita ficticia local y se elige Conservar; no se cancela. El botón destructivo presenta texto `rgb(53,19,19)` sobre `rgb(239,154,154)` en oscuro.

Se usaron la cuenta y datos ficticios locales existentes. No se enviaron mensajes, aceptaron permisos, cambiaron credenciales ni alteró producción. La comprobación de teclado, áreas seguras y gestos en Android/iPhone físicos sigue pendiente. Las capturas iniciales pueden contener una notificación ficticia de recepción; las muestras finales se guardan sin ella.
