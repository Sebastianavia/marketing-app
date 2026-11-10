# Skills del proyecto — cuál usar y cuándo

Instaladas solo en este proyecto, en `.agents/skills/` (fuente de verdad, Antigravity) con copia en `.claude/skills/` para Claude Code (ver `CLAUDE.md` › Skills del proyecto).
Elegidas con el criterio de `find-skills`: alto número de instalaciones en https://skills.sh y fuentes reconocidas.
Instaladas el 2026-10-10 copiando las carpetas desde GitHub (el CLI `npx skills` estaba bloqueado por la red).
Para actualizar: volver a copiar la carpeta desde el repo/commit indicado.

## Por tarea

| Tarea | Skills |
|---|---|
| Diseñar o rediseñar UI (prompt 01, dashboard, focus mode) | `frontend-design` → `high-end-visual-design` → `redesign-existing-projects` |
| Diseñar un dashboard de datos (KPIs, jerarquía, comparaciones; p. ej. la vista Costos, `docs/plan-costos-dashboard.md`) | `dashboard-designer` (qué mostrar y dónde) → `frontend-design` (cómo se ve). Ignorar su guía de herramientas BI (Tableau, Power BI…) y su paleta hex: el dashboard es dentro de la app y usa sus tokens de color |
| Micro-interacciones, hover, transiciones Dashboard ↔ Focus Mode | `emil-design-eng`, `vercel-react-view-transitions`, revisar con `review-animations` |
| Escribir/refactorizar componentes React/Next (p. ej. partir `AvatarWorkspace`) | `vercel-react-best-practices`, `vercel-composition-patterns`, `codebase-design` |
| Auditar UI/UX y accesibilidad | `web-design-guidelines` |
| Probar la app en el navegador (Playwright) | `webapp-testing` |
| ElevenLabs TTS / clonación / modelos de voz | `elevenlabs-text-to-speech` |
| Subtítulos, transcripción de videos (Scribe) | `elevenlabs-speech-to-text` |
| Guiones de anuncios, hooks, variantes de creativos UGC | `ad-creative`, `marketing-psychology`, `crewai-marketing` |
| Chat/streaming/tool-calling con AI SDK + OpenRouter | `vercel-ai-sdk` |
| Bugs difíciles | `diagnosing-bugs` |
| Arquitectura / profundizar módulos | `improve-codebase-architecture`, `codebase-design` |
| Tests | `tdd` |
| Revisar cambios | `code-review` |
| Buscar skills nuevas | `find-skills` |
| Video viral con código HTML (reels, explicativos, subtítulos animados, títulos, transiciones, gráficos) | `hyperframes` (leer primero) → `hyperframes-registry` (≈450 bloques listos) → `hyperframes-cli` (previsualizar/render); medios con `media-use` |
| Copiar el estilo de un video viral / rehacer un video como proyecto editable | `reverse-any-video`, `style-sampling`, `vox-explainer` |
| Subtítulos 3D alrededor de quien habla, memes de dos pantallas, animación pintada a mano | `camera-3d-captions`, `duo`, `p5-paint-animation` |
| Avatar de HeyGen, video con presentador, doblaje con lip-sync | `heygen-avatar` → `heygen-video`; `heygen-translate` |
| Video en React/Remotion (plantillas, subtítulos, render) | `remotion-best-practices` (router) → `remotion-create`, `remotion-captions`, `remotion-render`… |
| Elegir enfoque de video (grabación, avatar, IA, plantilla) y qué publicar en redes | `video`, `social` |

## Inventario

| Skill | Origen | Commit |
|---|---|---|
| find-skills | vercel-labs/skills | 13e4063 |
| frontend-design | anthropics/skills | dbd4588 |
| webapp-testing | anthropics/skills | dbd4588 |
| web-design-guidelines | vercel-labs/agent-skills | 063bee9 |
| vercel-react-best-practices | vercel-labs/agent-skills (`react-best-practices`) | 063bee9 |
| vercel-composition-patterns | vercel-labs/agent-skills (`composition-patterns`) | 063bee9 |
| vercel-react-view-transitions | vercel-labs/agent-skills (`react-view-transitions`) | 063bee9 |
| high-end-visual-design | leonxlnx/taste-skill (`soft-skill`) | 717446e |
| redesign-existing-projects | leonxlnx/taste-skill (`redesign-skill`) | 717446e |
| emil-design-eng | emilkowalski/skills | e8a175d |
| review-animations | emilkowalski/skills | e8a175d |
| elevenlabs-text-to-speech | elevenlabs/skills (`text-to-speech`, renombrada) | 1d08a4a |
| elevenlabs-speech-to-text | elevenlabs/skills (`speech-to-text`, renombrada) | 1d08a4a |
| ad-creative | coreyhaines31/marketingskills | 1efedbc |
| marketing-psychology | coreyhaines31/marketingskills | 1efedbc |
| code-review, codebase-design, diagnosing-bugs, improve-codebase-architecture, tdd | mattpocock/skills (ya estaban) | — |
| crewai-marketing, vercel-ai-sdk | propias del proyecto (ya estaban) | — |
| context-mode | plugin context-mode (solo Antigravity; requiere su MCP) | — |
| hyperframes, hyperframes-cli, hyperframes-registry, media-use, reverse-any-video, style-sampling, figma, remotion-to-hyperframes, slideshow | heygen-com/hyperframes | 2026-11-10 (`skills-lock.json`) |
| camera-3d-captions, day-in-my-life, duo, p5-paint-animation, prod-by-claude, session-story, vox-explainer, x-posting-license | heygen-com/hyperframes-community-skills | 2026-11-10 |
| heygen-avatar, heygen-video, heygen-translate | heygen-com/skills | 2026-11-10 |
| remotion-best-practices, remotion-captions, remotion-create, remotion-docs, remotion-interactivity, remotion-license, remotion-maps, remotion-markup, remotion-multimedia, remotion-render, remotion-saas, remotion-studio, remotion-upgrade | remotion-dev/skills | 2026-11-10 |
| video, social | coreyhaines31/marketingskills | 2026-11-10 |

### Skills de video (2026-11-10)
Instaladas con `npx skills add <repo> --agent claude-code antigravity --copy` (copias reales en `.claude/skills/` y `.agents/skills/`, sin enlaces simbólicos para que funcionen en Windows). Están en git: quien haga `git pull` ya las tiene; basta con abrir una sesión nueva de Claude Code. Origen y hash de cada una en `skills-lock.json`.
- Actualizar: `npx skills update -p` (y hacer commit). Restaurar desde el lockfile: `npx skills experimental_install`.
- Requisitos al usarlas: HyperFrames usa `npx hyperframes …` (Node ≥ 22 y FFmpeg; descarga Chrome headless la primera vez). Las skills de HeyGen necesitan el CLI `heygen` o el MCP de HeyGen y una `HEYGEN_API_KEY` propia (cobra en HeyGen, no pasa por Costos de Lulo). Remotion exige licencia de empresa si la compañía supera 3 personas (ver `remotion-license`).
- Las skills de HyperFrames ejecutan `npx hyperframes events` al empezar (telemetría de uso; se puede desactivar según su documentación).
- Son para Claude Code en la terminal del proyecto. Los agentes de dentro de la app (editor, director, estudio) usan `--setting-sources local` y una carpeta propia, así que no las cargan.

## Candidatas para más adelante (no instaladas)
- `elevenlabs/skills@dubbing`, `@voice-changer`, `@sound-effects`, `@music` — doblaje, cambio de voz, SFX y música de fondo.
