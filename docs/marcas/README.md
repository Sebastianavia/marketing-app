# Estándares de marca

Cada cliente puede entregar su estándar de edición. Funciona así:

- **El texto completo va en la marca:** pestaña «Marcas» → editar la marca → campo «Estándar de edición». Se comparte en R2.
  - En las ediciones de esa marca, elegida en «Nueva edición» o con `usar_marca`, Claude lo sigue **por encima** del manual.
  - Claude recibe también la lista de lo que el motor aún no hace (`ENGINE_LIMITS` en `frontend/src/lib/editor/brand-standard.ts`), para avisarlo antes de entregar.
- **Lo que sirve para cualquier video pasa a la skill de Lulo:** `LULO_BASE_RULES` en `frontend/src/lib/editor/manual.ts`. Sale en el Manual como «Criterio base de Lulo».
- **Lo propio del cliente se queda solo en su marca:** colores, fuentes, tamaño y estilo de subtítulos, efectos permitidos o prohibidos, título del gancho, transiciones prohibidas, niveles de música, caja de comentarios de Instagram…

## Marcas

| Marca | Archivo | Estado |
|---|---|---|
| ETM | `etm-estandar-v1.md` | Falta pegarlo en la pestaña «Marcas» (marca «ETM»: primario #0A0A0B, acento #F4581C, texto #F6EFE6, fuente Inter). |
