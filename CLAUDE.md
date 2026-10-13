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
- **Persistencia (implementado 2026-10-12):** NO SQLite. Archivos JSON en la **carpeta de datos del usuario**, fuera de la app, para que nada se pierda al actualizar o empaquetar como `.exe`: `getDataDir()` en `src/lib/data/data-dir.ts` = `LULO_DATA_DIR` o `%APPDATA%\LuloStudio` (Windows) o `~/.lulo-studio`. Contiene `meta.json` (schemaVersion, migraciones solo hacia adelante), `settings.json` (basePath, personName, dailyLimitUSD; antes `frontend/storage-config.json`, se migra solo), `usage/AAAA-MM.jsonl` (registro de costos, solo se añade) y `jobs/<id>.json` (trabajos de render). Escrituras atómicas (`writeJsonAtomic`).
- **Todo lo generado se guarda solo:** `src/lib/storage/generated-library.ts` copia cada MP3 (ruta TTS) y cada MP4 (runner) a `<carpeta de proyectos>\Generados\AAAA-MM\`, aunque no se pulse "Guardar proyecto".
- **Render en segundo plano (implementado para Avatar Studio):** `src/lib/jobs/runner.ts` arrancado en `src/instrumentation.ts`; `POST /api/render-jobs` crea el trabajo y responde al instante; `GET /api/jobs/[id]` para seguirlo. Reintenta 3 veces, timeout 30 min, retoma trabajos al reiniciar. La vista guarda el jobId en localStorage (`lulo_avatar_active_job`) y lo retoma al volver.
- **Costos (implementado):** `recordUsage()` en `src/lib/usage/usage-store.ts`, llamado desde TTS, guiones (Gemini $0, OpenRouter estimado) y runner de video. Tarifas en `src/config/cost-rates.ts` (fuente: `docs/finops/`). Vista `components/costs/CostsView.tsx` (herramienta `costs`, ⌘8): totales hoy/mes, gasto por herramienta, tabla por día con hora, persona, proveedor, cantidad y costo, exportar CSV (`/api/usage/export`), nombre de la persona y límite diario editables (`/api/settings/profile`). Indicador "Hoy $X" en la barra superior (`TodaySpend`).
- **Entradas para proveedores:** Cloudinary (ya integrado) solo como almacenamiento temporal con URL pública; se borra tras el render.
- **Consumo:** tabla local `usage_events` (persona, proveedor, modelo, unidades, costo) + vista "Consumo" + exportar CSV para comparar entre los 4. Recomendado: una clave de API por persona.
- **"Busi" es en realidad Buzzy (https://www.buzzy.now/)**: plataforma externa de video (Seedance 2.5, Wan 3.0, MiniMax H3) que se integra por MCP desde el servidor (`src/lib/buzzy/client.ts`, `BUZZY_MCP_URL`, `BUZZY_MCP_TOKEN`). Renombrado `busi` → `buzzy` (alias en `LEGACY_TOOL_IDS`); `BuzzyView` muestra el estado de conexión (`/api/buzzy/status`). Pendiente: URL y autenticación del MCP de Buzzy (no son públicas) y el cliente MCP.
- **Proveedor de avatar por defecto:** OpenRouter `heygen/avatar-iv` ($0.05/s, la mitad que la API directa de HeyGen a $0.10/s). Respaldo: fal Kling AI Avatar v2 ($0.0562/s). Lipsync sobre video: sync.so.
- **Gráficos de campañas:** plantillas propias en React (Satori / Remotion) antes que Canva, Bannerbear o Placid.
- **Voz ElevenLabs (2026-10-12):** los modelos, precios, límites y ajustes válidos viven en `frontend/src/config/elevenlabs-models.ts` (fuente única, cliente y servidor). Predeterminado `eleven_v4_turbo` ($0.04/1k, el más barato con etiquetas de emoción). `buildApiVoiceSettings()` envía a la API solo los ajustes que admite cada modelo (v4: stability+similarity; v3: solo stability 0/0.5/1; v2 y Flash: todos, speed 0.7–1.2). UI compartida en `components/voice/VoiceModelPanel.tsx` (Voice Studio y Avatar Studio). Botón "Dar emoción" → `api/elevenlabs/enhance` (Gemini, rechaza si cambia palabras). Modelos sin etiquetas: el servidor quita `[..]` antes de generar (`X-Tags-Removed`).
- **Orquestador (2026-10-12):** todo el texto generado (guiones de Avatar/Voice Studio, guion UGC, "Dar emoción") pasa por `src/lib/ai/orchestrator.ts` (`orchestrateText` / `orchestrateObject`). Modo en `settings.json` (`orchestrator`: `free` = pool Gemini 2.5 Flash, `claude-cheap` = Haiku 5.5, `claude-quality` = Sonnet 5.5, vía OpenRouter); selector "IA" en la barra superior. Si el modo gratis falla devuelve 409 `free_exhausted` y el cliente (`lib/ai/orchestrator-client.ts` → `postOrchestrated`) pregunta antes de usar Claude; nunca salta solo a pago. Cada llamada registra tokens y costo en Costos. Modelos y precios de texto: `src/config/llm-models.ts`. El chat `api/chat` y Mia (opción por defecto "Según selector IA", `selectedModel: 'orchestrator'`) usan `orchestrateTextStream`. `confidential: true` fuerza Claude Haiku si el modo es gratis.
- **Guion a video / video por escenas (2026-10-13):** herramienta `text-to-video` (`components/tools/TextToVideoView.tsx`). Entrada: guion (tal cual o reescrito), idea o PDF → `POST /api/scenes/plan` (orquestador, `lib/scenes/scene-plan.ts`; en modo "tal cual" rechaza si cambian palabras). Edición en tarjetas, imágenes (persona + producto), voz (VoiceModelPanel), modelo de B-roll (`config/broll-models.ts`, Veo 3.1 Lite por defecto). `POST /api/scenes` crea el proyecto (`<datos>/scenes/<id>.json` + carpeta) tras comprobar claves, Cloudinary, FFmpeg y límite diario. `lib/scenes/scene-runner.ts` (arranca en instrumentation): voz completa con `with-timestamps` → cortes a mitad de pausa (`scene-timing.ts`) → un RenderJob por escena (`kind: avatar|broll`, el runner ya maneja ambos) → montaje FFmpeg (`lib/video/ffmpeg.ts`: cover-crop, tpad, xfade, voz continua) → MP4 en la biblioteca y borrado de temporales de Cloudinary. `POST /api/scenes/[id]/retry` repite solo lo fallido. FFmpeg: `FFMPEG_PATH` → `ffmpeg-static` → PATH (el PC de Sebas ya tiene FFmpeg 8.1 en PATH). OpenRouter: se usa `.chat()` (Chat Completions) y las descargas de `unsigned_urls` llevan Authorization.
- **Catálogo de video y PDF (2026-10-13):** `lib/video/video-catalog.ts` compara los modelos configurados (avatar, B-roll, UGC) con `GET openrouter.ai/api/v1/videos/models` (caché 1 h); `GET /api/system/video-models`; aviso `VideoCatalogAlert` en la barra; `assertVideoModelAvailable` bloquea `POST /api/render-jobs` y `POST /api/scenes` si el modelo ya no existe. `lib/pdf/pdf-images.ts` extrae fotos de PDFs sin librerías (DCT/JPEG, Flate 8 bits RGB/gris → PNG, filtros ASCII85/ASCIIHex; ignora < 200 px, máscaras y duplicados) → `POST /api/scenes/pdf-images`. Cloudinary Free: 25 créditos/mes, máx. 10 MB imagen / 100 MB video.
- **Arreglos tras la primera prueba real (2026-10-13):** `writeJsonAtomic` reintenta el rename en Windows (EPERM/EBUSY/EACCES) y `isTransientFsError` evita dar por fallido un proyecto por un bloqueo pasajero. El scene-runner reutiliza trabajos ya lanzados (`sceneProjectId`+`sceneId`) para no pagar dos veces un clip. B-roll: imagen opcional (`imageId: 'none'` = texto→video); por defecto parte de una foto de producto o de nada (Veo rechazó la foto de la persona por "usage guidelines"); si el proveedor rechaza la imagen, el runner reintenta sin ella. 404 de OpenRouter en los primeros 3 min no cuenta como fallo. El estado de cada escena en `GET /api/scenes/[id]` sale del trabajo. Al terminar, el video se añade a Proyectos → TextToVideo. Solo HeyGen Avatar IV hace lip-sync con la voz de ElevenLabs; las tomas de apoyo no muestran a nadie hablando.
- **Modos de voz en Guion a video (2026-10-13):** `voiceMode` del proyecto (`config/broll-models.ts` → `VOICE_MODES`): `voiceover` = todas las escenas B-roll + voz ElevenLabs continua encima (predeterminado, el más barato); `native` = sin ElevenLabs, cada clip con `generate_audio: true` y prompt "The person speaks in Spanish… and says: \"…\"" (formato de diálogo de la guía de Veo), solo modelos con `audio: true` (Veo 3.1 Lite $0.05/s, Kling 3.0 Std $0.126/s, Wan 3.0 $0.10/s), montaje con el audio de cada clip (`clipHasAudio`, `acrossfade`, `probeMedia`); `avatar` = HeyGen + ElevenLabs (lo anterior). La voz nativa puede cambiar entre clips (OpenRouter no permite fijar voz).

## Pendiente del plan (al 2026-10-12)

- Generador UGC: usar de verdad el modelo elegido (hoy aún va por `useUgcPipeline` → HeyGen directo).
- Guion a video y Clonación y reemplazo: siguen simulados.
- Cliente MCP de Buzzy (falta URL y clave).
- Campañas automáticas (Fase 2 del plan).
- Errores de lint previos en `AvatarWorkspace.tsx` y otros archivos antiguos (setState en efectos, `any`).

## context-mode (MCP)

El proyecto declara el servidor `context-mode` en `.mcp.json` (para Claude Code) y en `.agents/mcp_config.json` (para Antigravity). Cuando sus herramientas estén disponibles en la sesión (`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_fetch_and_index`, `ctx_index`):

- Para analizar, buscar, contar o resumir archivos y salidas largas, usar `ctx_execute` / `ctx_execute_file` e imprimir solo el resultado, nunca el archivo entero.
- Para varias órdenes de exploración, usar `ctx_batch_execute` en una sola llamada.
- Para páginas web, `ctx_fetch_and_index` y luego `ctx_search`.
- Leer un archivo completo solo cuando se va a editar.
- Si las herramientas no están disponibles (por ejemplo en una sesión en la nube), filtrar a mano: `grep`, rangos de líneas, solo los errores.

Instalación recomendada en Claude Code (añade también los hooks de enrutado automático):
`/plugin marketplace add mksglu/context-mode` → `/plugin install context-mode@context-mode` → `/reload-plugins` → comprobar con `/context-mode:ctx-doctor`.
