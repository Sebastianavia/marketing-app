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
| Santiago Ruiz | `etm-estandar-v1.md` (ESTÁNDAR DE EDICIÓN ETM · v1) | Creada y con el estándar pegado (13 nov 2026). Falta poner sus colores (primario #0A0A0B, acento #F4581C, texto #F6EFE6) y su fuente (Sora SemiBold, con `instalar_fuente`): ahora tiene los de Lulo por defecto (lima y blanco, prohibidos por el estándar). |

## Lo que el motor ya cumple del estándar ETM (marca «Santiago Ruiz», Fase 9)

| Regla | Cómo |
|---|---|
| Corte por palabra, queda la última toma | `cortar_palabras` + detección automática de arranques repetidos |
| Sin apuntador | Fase 8, `voces_de_fondo` |
| Subtítulos bajo el mentón, anclados a la cara | posición «Bajo el mentón» (`cara`) + `sombraSuave` |
| Fuentes Sora, Anton y Prata | `instalar_fuente` (Google Fonts, OFL) |
| Palabra grande en el pecho | kit `texto_kinetico` con `posicion: 'pecho'` y `fuente: 'Anton'` |
| Caja de comentarios de Instagram en el CTA | kit `comentario_instagram` |
| 0,8 s de aire al final | `colaFinal: 0.8` |
| Cabeza completa con zoom | automático (`headTop`) |
| Barrido con desenfoque de movimiento | transición `barrido` |
| Transcribir el audio final | `verificar_audio_final` |
| Gancho A y B en dos archivos | `crear_variante` |
