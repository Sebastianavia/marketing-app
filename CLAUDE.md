# Lulo Studio — Marketing AI Studio (memoria del proyecto)

> Lee este archivo al empezar cualquier sesión. Resume todo lo necesario para trabajar sin re-explorar el repo.
> Detalle ampliado: `docs/context/project-map.md` (mapa de archivos, rutas API, servicios) y
> `docs/context/skills.md` (qué skill usar y cuándo). Prompts/especificaciones del dueño: `docs/prompts/`.
> Última actualización del estudio: 2026-10-10 (commit `02cca18` + cambios locales sin commitear).

## Qué es

App **de escritorio, de uso privado** (marca: **Lulo Studio**, título interno "Marketing Creative Studio") para
producir **videos de marketing verticales** (TikTok / Reels / Shorts): avatares que hablan (foto + voz),
clonación de voz, UGC para anuncios, face-swap y text-to-video. Todo el texto de la UI está en **español**.

El dueño trabaja en Windows (`D:\github\app- marketing`), con Antigravity/Gemini y con Claude.
Los proyectos generados se guardan en disco local (`D:\LuloStudio_Projects` por defecto, configurable).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend + API | **Next.js 16.3.8** (App Router, Turbopack), **React 19.2**, TypeScript 5 |
| Estilos | **Tailwind CSS v4** (`@import "tailwindcss"`, dark mode por clase `.dark`), fuentes **Geist / Geist Mono** |
| Estado | **Zustand 5** (`src/store/*`) |
| IA (texto) | **Vercel AI SDK v7** (`ai`, `@ai-sdk/openai` apuntando a OpenRouter, `@ai-sdk/google` con pool de claves Gemini) |
| Íconos | `lucide-react` |
| Validación | `zod` 4 |
| Storage | **Cloudinary** (imágenes/audio temporales para las APIs), disco local para proyectos; restos de S3/R2 (`@aws-sdk/*`) |
| Backend Python (legacy) | `backend/` FastAPI + CrewAI + HeyGen. **El frontend NO lo llama** (no hay referencias a `:8000`). |
| Shell de escritorio | Ventana sin marco: `TitleBar` usa `window.electronAPI` o `window.__TAURI__` si existen. **No hay Electron/Tauri en el repo todavía**; se corre como web en `localhost:3000`. |

⚠️ `frontend/AGENTS.md`: esta versión de Next tiene cambios incompatibles — antes de escribir código Next
consulta `frontend/node_modules/next/dist/docs/`.

## Proveedores de IA (todos vía rutas `src/app/api/*`, las claves nunca van al cliente)

| Proveedor | Uso | Dónde |
|---|---|---|
| **OpenRouter** | Guiones (LLM) y **render de video**: `heygen/avatar-iv` (lip-sync foto+audio) y modelos de video (Seedance, Wan…) | `services/openrouter/openrouter-video.service.ts`, `lib/ai/openrouter.ts`, `/api/openrouter/*` |
| **ElevenLabs** | TTS (`eleven_multilingual_v2`, `eleven_v4`…), Instant Voice Cloning, registro local de voces | `services/elevenlabs/elevenlabs.service.ts`, `lib/storage/voice-storage.ts`, `/api/elevenlabs/*` |
| **APIMart** | Video UGC: MiniMax-Hailuo-2.3, kling-v3-omni, seedance-2.0 | `lib/ai/apimart.ts`, `/api/apimart/*`, `services/pipeline/ugc-dispatcher.service.ts` |
| **Google Gemini** | Guiones baratos + copiloto "Mia", pool de claves con failover | `lib/ai/gemini-pool.ts`, `/api/script/generate`, `/api/mia-assistant` |
| **HeyGen API directa** | Legacy (v2 talking photo). El render actual de Avatar Studio va por OpenRouter | `services/heygen.service.ts`, `/api/heygen/*` |
| **Cloudinary** | Subir retrato/audio para tener URL pública que consumen las APIs de video; limpieza | `services/storage/cloudinary.service.ts`, `/api/storage/cloudinary` |

Catálogo de modelos de video con tarifas por segundo y límites de duración: `src/config/ugc-models.config.ts`
(fuente única de verdad para precios; `pricing.service.ts` lo sincroniza con precios vivos de OpenRouter).

Variables de entorno: ver `frontend/.env.local.example` (GEMINI_API_KEYS, ELEVENLABS_API_KEY, CLOUDINARY_*,
OPENROUTER_API_KEY, APIMART_API_KEY, NEXT_PUBLIC_APP_URL). **Nunca leer ni imprimir `.env.local` / `backend/.env`.**

## Herramientas (vistas) y su estado real

Navegación en `src/app/page.tsx`: estado `activeTool` (no hay rutas por herramienta). Atajos ⌘0–⌘7.

| id | Vista | Estado |
|---|---|---|
| `avatar-studio` | `AvatarWorkspace.tsx` (1650 líneas) | **Real.** Foto → Cloudinary; audio por ElevenLabs TTS o MP3 local → Cloudinary; render OpenRouter `heygen/avatar-iv`; polling hasta 10 min; costo final; guardar proyecto. |
| `voice-studio` | `VoiceStudioView.tsx` | **Real.** Clonación IVC + TTS multilingüe (es/en/pt). |
| `ugc-generator` | `UgcGeneratorView.tsx` + `UgcModelSelector.tsx` | **Parcial.** El selector de modelo/costo (APIMart/OpenRouter) es solo visual: `useUgcPipeline` llama a `/api/openrouter/script` y luego a **HeyGen directo** (`/api/heygen/generate`). `ugc-dispatcher` y `/api/ugc/dispatch` existen pero la UI no los usa. |
| `text-to-video` | `TextToVideoView.tsx` | **Simulado** (setTimeout + video de muestra BigBuckBunny). |
| `deep-swap` | `DeepSwapView.tsx` ("Genjutsu") | **Simulado/demo.** `faceswap.service.ts` preparado para Replicate/fal. |
| `busi` | `BusiDemoView.tsx` | Demo estática (auditor de campañas). |
| `projects` | `ProjectsLibraryView.tsx` | **Real.** Biblioteca en disco, hidratación de proyectos (`useProjectHydrationStore`). |
| — | `MiaTerminal.tsx` | Copiloto "Mia" (chat Gemini/OpenRouter) + "CLI" simulada; inyecta guiones/prompts en la herramienta activa (`useMiaStore.injectedData`). |

## Sistema de diseño actual

- Estética "Linear/Vercel": negro puro `#000` / `#050505`, superficies `#0A0A0A`/`#111`, bordes `white/[0.06–0.08]`,
  tipografía pequeña (text-xs/11px), mucho `font-mono` uppercase para etiquetas. Modo claro completo (`useThemeStore`, clave `lulo_theme`).
- Tokens en `src/app/globals.css` (`--background`, `--surface`, `--border`…) + utilidades `.surface-card`, `.input-clean`,
  `.slider-minimal`, `.desktop-scroll`, `.drag-region/.no-drag`.
- Acento actual: **indigo** (poco usado); CTA principal en blanco/negro invertido.
- Componentes base reutilizables: `ui/StepIndicator`, `ui/UploadZone`, `ui/VideoPlayer` (9:16/16:9, descarga),
  `ui/ShimmerLoader`, `ui/GlassCard`, `dashboard/ToolCard`, `layout/TitleBar`, `layout/DesktopSidebar`, `layout/TopBar` (no usado).
- Layout de herramientas: grid 12 columnas, panel izquierdo (stepper + inputs) / derecho (preview), apilado en `< lg`.

**Dirección pedida por el dueño (prompt 01, `docs/prompts/01-ui-ux-design-system.md`):** dark premium, espacio negativo,
acentos azul eléctrico/púrpura neón SOLO en estados activos, botón Generar y feedback de IA; glassmorphism en modales;
hover que eleva tarjetas; Focus Mode por herramienta con "← Volver al Dashboard"; split-screen con video protagonista;
top bar discreto con créditos y perfil.

## Deuda técnica / bugs conocidos (verificados en el código)

1. `GlassCard` usa `.glass-panel` / `.glass-panel-hover`, que **no existen** en `globals.css`.
2. Atajos inconsistentes: el dashboard dice "Mis Proyectos (⌘6)" pero ⌘6 = Busi y ⌘7 = Proyectos.
3. UGC: el modelo elegido no se usa en el render (ver tabla). `useVideoPipeline` + `/api/pipeline/render` (SSE) tampoco se usan.
4. `ugc-dispatcher.service.ts` tiene URLs de relleno (Unsplash / Google sound) si faltan imagen/audio → riesgo de gastar créditos con assets falsos.
5. `openrouter-video.service.ts` devuelve **tarea mock** con video de Pixabay si no hay API key (útil en dev, peligroso si pasa en silencio).
6. Datos falsos en UI: créditos fijos `2450` (TopBar), "NVMe 34.2 GB / 512 GB" en el sidebar, ruta `D:\LuloStudio_Projects` hardcodeada en `page.tsx`.
7. `DeepSwapView` banner usa colores solo-oscuro (`text-zinc-400`, `text-amber-300`) → mal contraste en modo claro.
8. `AvatarWorkspace.tsx` es un monolito de ~82 KB: candidato a dividir (hooks de voz, de upload, de render).
9. Hay dos clientes HeyGen (TS y Python) y dos pipelines de guion (OpenRouter y Gemini): consolidar.
10. Sin tests ni CI. Validar con `npx tsc --noEmit`, `npm run lint` y `npm run build` dentro de `frontend/`.

## Convenciones

- Código y comentarios en español; nombres de identificadores en inglés. Componentes `PascalCase.tsx`, servicios `*.service.ts` con clase + singleton exportado, tipos en `src/types/*.types.ts`.
- Todas las llamadas a proveedores pasan por rutas `app/api/**/route.ts` (server-only). El cliente solo hace `fetch('/api/...')`.
- Alias `@/` → `frontend/src`.
- Commits estilo Conventional Commits (`feat(storage): ...`).
- `frontend/` aparece en `.vscode` como repo ignorado, pero el repo git es la raíz del proyecto.
- Hay cambios locales sin commitear del dueño: no hacer reset/checkout sobre ellos.

## Cómo correr

```powershell
cd frontend; npm install; npm run dev     # http://localhost:3000
# backend legacy (opcional): cd backend; .\venv\Scripts\activate; python main.py  # :8000
```

## Skills del proyecto

Fuente de verdad: **`.agents/skills/`** (23 skills; las lee Antigravity). Claude Code lee **`.claude/skills/`**:
mantener una copia sincronizada (desde la raíz, en PowerShell):
`Copy-Item -Recurse -Force .agents\skills\* .claude\skills\` (y luego borrar `.claude\skills\context-mode`, que solo sirve con el MCP de Antigravity).
Si `.claude/skills/` está vacío, lee directamente `.agents/skills/<nombre>/SKILL.md` antes de la tarea correspondiente.
Guía de cuál usar en cada tarea: `docs/context/skills.md`. Para buscar nuevas: skill `find-skills` (catálogo https://skills.sh).

## Decisiones de arquitectura (2026-10-10)

Plan completo: https://claude.ai/code/artifact/5321e959-43c0-467d-8114-330e35a1983f ("Lulo Studio — Plan estratégico de mejora y arquitectura").

- **Equipo de 4 personas, cada una ejecuta la app en su propio PC.** Sin servidor ni base de datos en la nube; costo de infraestructura cero.
- **Persistencia local:** SQLite (`lulo.db` en la carpeta de proyectos) con `better-sqlite3` + Drizzle; resultados (MP4, audios) en disco local como hoy.
- **Render en segundo plano:** tabla `render_jobs` + *runner* dentro del servidor Next.js (arrancado en `src/instrumentation.ts`), que consulta a los proveedores cada 10 s. Sin webhooks (un PC no es alcanzable desde internet). La UI consulta `/api/jobs/[id]` cada 3 s. El navegador nunca espera un render.
- **Entradas para proveedores:** Cloudinary (ya integrado) solo como almacenamiento temporal con URL pública; se borra tras el render.
- **Consumo:** tabla local `usage_events` (persona, proveedor, modelo, unidades, costo) + vista "Consumo" + exportar CSV para comparar entre los 4. Recomendado: una clave de API por persona.
- **"Busi" es en realidad Buzzy (https://www.buzzy.now/)**: plataforma externa de video (Seedance 2.5, Wan 3.0, MiniMax H3) que se integra por MCP desde el servidor (`src/lib/buzzy/client.ts`, `BUZZY_MCP_URL`, `BUZZY_MCP_TOKEN`). Renombrar `busi` → `buzzy` con alias de compatibilidad. Pendiente: URL y autenticación del MCP de Buzzy (no son públicas).
- **Proveedor de avatar por defecto:** OpenRouter `heygen/avatar-iv` ($0.05/s, la mitad que la API directa de HeyGen a $0.10/s). Respaldo: fal Kling AI Avatar v2 ($0.0562/s). Lipsync sobre video: sync.so.
- **Gráficos de campañas:** plantillas propias en React (Satori / Remotion) antes que Canva, Bannerbear o Placid.
