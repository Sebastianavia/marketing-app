# Mapa del proyecto (detalle)

Complemento de `CLAUDE.md`. Rutas relativas a la raíz `app- marketing/`.

## Raíz
- `CLAUDE.md` — memoria principal (léela primero).
- `GEMINI.md`, `.agents/rules/context-mode.md`, `.agents/mcp_config.json` — reglas para Antigravity (MCP `context-mode`). No aplican a Claude.
- `.agents/skills/` + `.claude/skills/` — skills del proyecto (ver `.claude/context/skills.md`).
- `docs/prompts/` — prompts/especificaciones del dueño, numerados.
- `backend/` — Python 3.12 legacy: `main.py` (FastAPI: `/api/campaign/generate`, `/api/video/render`, `/api/video/status/{id}`),
  `marketing_crew.py` (CrewAI: estratega, copywriter, QA; LLM `openrouter/anthropic/claude-3.5-sonnet`),
  `heygen_service.py`, `talking_photo_pipeline.py` (CLI: guion Gemini/OpenRouter → ElevenLabs → HeyGen talking photo → MP4).

## frontend/src/app
- `layout.tsx` — Geist fonts, script anti-flash de tema, `lang="es"`, título "Lulo Studio Desktop".
- `page.tsx` — SPA completa: `TitleBar` + `DesktopSidebar` + `<main>` (dashboard o herramienta activa) + `MiaTerminal`. Array `TOOLS` con las tarjetas.
- `globals.css` — tokens de color, utilidades, scrollbar, slider.

### API routes (`app/api/**/route.ts`)
| Ruta | Función |
|---|---|
| `chat` | streaming `streamText` (AI SDK) vía OpenRouter |
| `mia-assistant` | copiloto Mia (Gemini pool o OpenRouter), skills de `lib/ai/mia-skills.ts` |
| `script/generate` | guion de marketing (Gemini pool con failover) |
| `openrouter/script` | guion vía OpenRouter (usado por `useUgcPipeline`) |
| `openrouter/videos/generate`, `openrouter/videos/status/[id]` | render de video (heygen/avatar-iv y otros) + polling |
| `openrouter/pricing` | precios vivos de modelos de video |
| `elevenlabs/tts` | síntesis de voz |
| `elevenlabs/voices` (GET), `voices/add` (POST, IVC), `voices/[id]` (DELETE) | voces |
| `apimart/generate`, `apimart/status/[id]` | video APIMart |
| `ugc/dispatch` | despacho multi-proveedor por `modelId` (no usado por la UI) |
| `heygen/avatars`, `heygen/generate`, `heygen/status/[id]`, `heygen/talking-photo/generate` | HeyGen directo (legacy, aún usado por UGC) |
| `pipeline/render` | pipeline SSE ElevenLabs → storage → OpenRouter (no usado por la UI) |
| `storage/cloudinary` | subir / limpiar assets temporales |
| `projects` (GET/DELETE), `projects/load`, `projects/media?path=`, `projects/check-name`, `projects/open-folder` | biblioteca local en disco |
| `settings/storage` | ruta base de proyectos (`frontend/storage-config.json`) |

## frontend/src/components
- `layout/`: `TitleBar` (barra sin marco, controles ventana Electron/Tauri, toggle tema, limpieza Cloudinary, carpeta del workspace), `DesktopSidebar` (activity bar 56px con tooltips y atajos, launcher de Mia), `TopBar` (no usado), `ThemeToggle`.
- `dashboard/ToolCard` — tarjeta de herramienta (icono, badge, categoría, descripción).
- `tools/`: `AvatarWorkspace` (+ alias `AvatarStudioView`), `VoiceStudioView`, `UgcGeneratorView`, `UgcModelSelector`, `TextToVideoView`, `DeepSwapView`, `BusiDemoView`.
- `ui/`: `StepIndicator`, `UploadZone`, `VideoPlayer`, `ShimmerLoader`, `GlassCard`.
- `storage/`: `ProjectsLibraryView`, `SaveProjectWidget`, `StorageConfigModal`, `CloudinaryCleanWidget`, `CloudinaryConfirmModal`.
- `mia/MiaTerminal` — panel inferior con modos copilot / cli.

## frontend/src (resto)
- `config/ugc-models.config.ts` — `AIModelConfig` + `UGC_MODELS_CATALOG` (APIMart: Hailuo 2.3, Kling v3 Omni, Seedance 2.0; OpenRouter: Seedance 1.5 Pro, Seedance 2.0 Fast, Wan 2.6) + `DEFAULT_UGC_MODEL`, `getModelById`.
- `hooks/`: `useCostEstimator` (duración × tarifa), `useUgcPipeline` (guion → HeyGen → polling), `useVideoPipeline` (SSE, sin uso).
- `services/`: `elevenlabs/`, `openrouter/openrouter-video.service.ts`, `openrouter.service.ts`, `pipeline/ugc-dispatcher|ugc-pipeline`, `pricing/`, `storage/cloudinary|storage(S3/R2)`, `apimart.service.ts`, `heygen.service.ts`, `faceswap.service.ts`.
- `lib/`: `ai/{apimart,gemini-pool,mia-skills,openrouter}.ts`, `storage/{project-storage,voice-storage}.ts` (fs local, metadata JSON por proyecto, categorías HeyGen/UGC/TextToVideo/Genjutsu), `video/video-metadata.ts` (duración real del MP4).
- `store/`: `useMiaStore` (panel, mensajes, inyección a herramientas), `useThemeStore`, `useProjectHydrationStore` (reabrir proyecto en su herramienta), `usePricingStore`, `useCloudinaryStore`.
- `types/`: `elevenlabs`, `faceswap`, `heygen`, `openrouter`, `pipeline` (`PipelineError`…), `ugc-models`, `ugc`.

## Flujo Avatar Studio (el más completo)
1. Foto (UploadZone) → `/api/storage/cloudinary` → URL pública.
2. Audio: modo `generar` (guion opcional vía `/api/script/generate` → `/api/elevenlabs/tts`) o modo `local` (MP3) → Cloudinary.
3. `/api/openrouter/videos/generate` (`heygen/avatar-iv`, aspect 9:16|16:9) → `taskId`.
4. Polling `/api/openrouter/videos/status/[taskId]` hasta 600 s → `videoUrl`.
5. Duración real (`extractVideoDurationSeconds`) × tarifa → costo final; `SaveProjectWidget` guarda en disco.
