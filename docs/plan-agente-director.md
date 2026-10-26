# Plan: agente director y editor de video (Lulo Studio)

Fuente: documento "Lulo Studio — Agente director y editor de video" (26 oct 2026).
Decisión: se implementan las DOS opciones de agente (A y B), sobre la MISMA capa de herramientas.

## Objetivo
1. **Director:** recibe un guion (texto libre o formato de abajo), decide qué herramienta usa cada escena, muestra un plan con costo por escena, y tras aprobación genera todo, guarda cada archivo en una carpeta de producción y monta el video final.
2. **Editor por prompt:** botón "Editar video" al terminar cualquier video y en cada tarjeta de Proyectos; el prompt se convierte en una lista de pasos de edición (visible y aprobable) que FFmpeg aplica en una versión nueva (v2, v3…). El original nunca se toca.

## Agentes (ambos)
- **A. Claude Code en la PC del usuario** + servidor MCP de Lulo Studio (stdio) + skill "director". Usa el plan Pro del usuario.
- **B. Director dentro de la app**: chat "Director" que usa las mismas herramientas con el orquestador existente (`lib/ai/orchestrator.ts`, selector IA: Gemini gratis / Haiku / Sonnet) vía AI SDK tool calling. Plan y botones de aprobar en pantalla.
- No usar Agent SDK de Anthropic dentro de la app (requiere clave de API; no se permite login de claude.ai en apps de terceros).

## Capa de herramientas (se construye UNA vez)
Implementar la lógica en `src/lib/director/tools.ts` (funciones puras sobre lo que ya existe) y exponerla dos veces:
- MCP server stdio (p. ej. `frontend/mcp/lulo-mcp.ts`) que llama a la app en `http://localhost:3000/api/*` (la app debe estar corriendo).
- Herramientas del AI SDK para el chat Director (opción B).

| Herramienta | Qué hace | Base existente | ¿Gasta? |
|---|---|---|---|
| ver_catalogo | avatares, voces, modelos, proyectos, producciones | /api/avatars, /api/projects, config/*-models | No |
| estimar_costo | precio de un plan antes de ejecutar | config/cost-rates.ts, image-models, broll-models, elevenlabs-models | No |
| crear_imagen | imagen con/sin avatar | /api/images/generate | Sí |
| crear_voz | locución ElevenLabs (voz clonada) | /api/elevenlabs/tts (+ with-timestamps) | Sí |
| video_avatar | HeyGen Avatar IV (foto + audio) | /api/render-jobs (kind avatar) | Sí |
| toma_de_apoyo | clip image→video sin persona hablando | runner kind 'broll' (Veo/Kling/Hailuo) | Sí |
| estado_trabajo | avance de un trabajo | /api/jobs/[id] | No |
| montar_video | une escenas, voz, fundidos | lib/video/ffmpeg.ts (stitchScenes) | No |
| editar_video | aplica pasos de edición → versión nueva | NUEVO | No |
| produccion | crea carpeta y anota cada archivo | NUEVO | No |

## Carpeta de producción
`<carpeta de proyectos>\Producciones\<nombre>\produccion.json`: por cada archivo → escena, herramienta, modelo, prompt, costo, ruta, estado. Permite rehacer una sola escena y volver a montar. Nueva categoría en Proyectos (`config/project-categories.ts`).

## Editor por prompt
Ediciones soportadas al inicio (todas FFmpeg, gratis): recortar/cortar/reordenar/unir, fundidos, velocidad, recuadre 9:16/1:1/16:9, textos/logo/marca de agua, volumen, música de fondo (archivo del usuario), subtítulos (tiempos de ElevenLabs cuando la voz se hizo allí). El modelo devuelve un JSON de pasos validado con zod; nunca comandos FFmpeg libres.
Fuera de alcance inicial: ediciones que requieren "ver" el video.

## Reglas de gasto (en el SERVIDOR, no solo en el prompt)
1. Toda herramienta que gasta: primero devuelve costo estimado; ejecuta solo con aprobación explícita (token de aprobación / confirmación).
2. Presupuesto por producción: por defecto $3 (o el del guion). Si el plan lo supera → proponer versión más barata.
3. El límite diario existente (`assertWithinDailyLimit`) aplica a todo.
4. Modelo más barato que sirva por defecto (Seedream 5.0 Flash, Veo 3.1 Lite, ElevenLabs v4 Turbo, Haiku/Gemini gratis para pensar).
5. Reutilizar avatares, voces e imágenes; rehacer solo la escena fallida.
6. Producciones largas: escena de prueba a baja resolución primero.
7. Nunca borrar ni sobrescribir originales (versiones + papelera).
8. Las claves nunca salen del servidor; el agente nunca las ve.
9. Todo se registra en Costos con el id de producción.

## Formato de guion sugerido
```markdown
# Anuncio sérum — 9:16, máx. 30 s, presupuesto $3
## Escena 1 — avatar (10 s)
Quién: avatar «Valentina» · Voz: clonada «Valentina»
Dice: «¿Tu piel se ve apagada? Mira esto.»
## Escena 2 — imagen (4 s)
El sérum de la imagen producto.png sobre mármol, luz de mañana.
Edición: zoom lento, texto «-40 % sequedad»
## Escena 3 — toma de apoyo (6 s, sin voz)
Valentina aplicándose el sérum frente al espejo.
## Cierre
Logo + «Envío gratis hoy», música suave de fondo.
```

## Fases (cada una usable sola)
1. MCP solo lectura + estimar_costo (gasto $0). Prueba: en Claude Code, "¿qué avatares tengo y cuánto costaría un video de 30 s con Valentina?".
2. Herramientas que generan + carpeta de producción, con aprobación y presupuesto. Prueba: producción de 2 escenas (< $1). **Hecha en código (2026-10-26), verificada sin gasto; falta la prueba con dinero.** Decisiones: se aprueba solo en la app; cualquier cambio pide aprobar de nuevo; solo la tarjeta de la producción en Proyectos.
3. Montaje + editor por prompt (pantalla Editar video, versiones, botón en videos terminados y en Proyectos). Prueba gratis sobre un video existente.
4. Skill "director" para Claude Code (formato de guion, orden de trabajo, reglas de gasto). Prueba: guion de ejemplo de punta a punta.
5. Chat Director dentro de la app (opción B) con las mismas herramientas. Prueba: mismo guion sin terminal.

## Decisiones por defecto (cambiables)
- Presupuesto por producción: $3.
- Modelo para pensar en la app: el del selector IA (Gemini gratis por defecto; Haiku si es confidencial o se agota el cupo).
- Música: carpeta del usuario `Musica\` en la carpeta de proyectos.
- Subtítulos: solo cuando la voz viene de ElevenLabs (con tiempos); transcripción de audio subido = pendiente.
- Buzzy: fuera por ahora; posible herramienta futura.

## Reglas del repo
Ver CLAUDE.md (datos en %APPDATA%\LuloStudio, nunca leer .env.local, no commitear sin pedirlo, español en la UI).
