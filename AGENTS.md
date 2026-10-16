<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Preferencias del proyecto

- Joel solicita usar Taste Skill para todo trabajo de diseño. Leer y aplicar `C:/Users/Joel/.codex/skills/redesign-existing-projects/SKILL.md` para pantallas del CRM y mejoras de interfaces existentes; usar `C:/Users/Joel/.codex/skills/design-taste-frontend/SKILL.md` para landing y páginas públicas nuevas, dentro de su alcance. Auditar antes de modificar, conservar la identidad visual aprobada y las funciones, y verificar el resultado en navegador. Las preferencias explícitas de Joel prevalecen sobre sugerencias estéticas de las skills.
- Para cambios de interfaz, comprobar en el navegador anchos efectivos de 320, 375, 390, 768, 1024 y 1440 píxeles CSS. Revisar texto, botones, ventanas y desbordamiento horizontal; guardar evidencia visual. En pantallas de poca altura, verificar que el contenido del diálogo siga accesible con desplazamiento vertical.
- Joel redespliega los cambios que no requieren migraciones de base de datos ni creación de tablas. En esos casos, verificar, hacer commit y subir a Git, pero no redesplegar automáticamente. Informar el commit y cualquier compilación pendiente.
- Pipeline fue retirado por decisión de Joel: no restaurarlo en el menú ni incluirlo en el plan de rediseño, salvo una nueva petición explícita.

- Para decisiones de diseño y temas, leer también `DESIGN.md`: adapta las referencias de VoltAgent/awesome-design-md a la identidad aprobada del CRM. No reemplazar el diseño del producto con el de la marca de referencia.
