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

## Candidatas para más adelante (no instaladas)
- `remotion-dev/skills@remotion-best-practices` — si se ensambla/edita video en código (multi-clip UGC, subtítulos animados).
- `elevenlabs/skills@dubbing`, `@voice-changer`, `@sound-effects`, `@music` — doblaje, cambio de voz, SFX y música de fondo.
- `heygen-com/hyperframes` — composición de video con HTML (alternativa a Remotion).
