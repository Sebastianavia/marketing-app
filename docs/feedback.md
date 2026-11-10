# Lulo Studio ↔ app de feedback

Actualizado el 2026-11-10. La app de feedback (repo aparte en `~/Documents/feedback`, publicada en
https://video-feedback-b07.pages.dev) sirve para que el equipo vea un video y deje notas por segundo.
Lulo sube allí los videos y trae de vuelta las notas para que Claude las aplique.

## Flujo

```
Lulo: «Subir a Feedback»  →  versión vN en el proyecto del video  →  En revisión del equipo (resaltada)
App de feedback: el equipo deja notas por segundo y un feedback general, firma con su nombre
        y pulsa «Enviar a Claude»  →  Enviado a Claude  (puede retirar el envío o seguir añadiendo notas)
Lulo: «Extraer notas y feedback» en el video (en esa versión) o en la bandeja, o se le pide a Claude
        en el chat  →  Claude trabajando  (Claude descarga las notas; esa versión queda cerrada)
Claude ejecuta las correcciones y responde nota por nota  →  Claude respondió
Lulo: «Subir esta versión a Feedback» (v N+1, mismo proyecto)  →  la anterior queda «Versión anterior»
        y el equipo sigue comentando sobre la nueva…
```

- La app de feedback solo sirve para dejar notas y feedback general, y para enviarlos a Claude. No hay
  «Aprobar». Cualquiera con el enlace puede comentar.
- En Lulo, el bloque de feedback de cada video lista **todas sus versiones** subidas con su estado y,
  en las que están en *Enviado a Claude*, el botón «Extraer notas y feedback».
  - La versión nueva se propone con el número siguiente y en el mismo proyecto de Feedback.
  - Un archivo que se vuelve a montar en la misma ruta (UGC, avatar…) también cuenta como versión nueva.
- **Lulo no consulta nada en segundo plano.** Lee el bucket solo al mostrar el bloque de un video (solo
  sus versiones), al abrir la bandeja **Feedback** o cuando Claude usa sus herramientas.
- Claude solo trabaja versiones *Enviado a Claude*, y siempre porque una persona se lo indica desde Lulo.

## Colores

| Estado | Color |
|---|---|
| En revisión del equipo («Por revisar» en la app de feedback) | ámbar, resaltado |
| Enviado a Claude | naranja (número en la bandeja) |
| Claude trabajando | azul |
| Claude respondió | violeta |
| Versión anterior | gris, atenuado |

## A quién le llegan las notas

| Video subido desde | «Extraer notas y feedback» va a |
|---|---|
| Edición de video (borrador vN) | El chat «Claude · editor» de esa edición |
| Guion a video · Director (final vN) | El chat «Claude · director» de esa producción |
| Estudio Claude (video del chat) | El chat de ese proyecto del Estudio |
| Avatar Studio, UGC Studio, Guion a video manual, Proyectos | Una edición nueva con Claude a partir de ese video (requiere «Claude · mi suscripción») |
| Subido desde otro PC | Pedírselo a Claude en el Estudio Claude (`feedback_pendiente`) |

## Herramientas de Claude ($0)

| Dónde | Herramientas |
|---|---|
| Claude · editor y Claude · director | `ver_feedback` (estado y notas de lo subido desde ahí), `tomar_feedback`, `responder_feedback` |
| Estudio Claude | `subir_a_feedback`, `ver_feedback` (ese proyecto), `feedback_pendiente` (todos los videos del equipo con cambios pedidos), `tomar_feedback`, `responder_feedback` |
| Claude Code en la terminal (MCP `lulo-studio`) | `feedback_pendiente`, `tomar_feedback`, `responder_feedback` |

- `tomar_feedback` (lo mismo que «Extraer notas y feedback») descarga las notas del momento y deja la
  versión en *Claude trabajando*. Si ya estaba extraída, no cambia nada. Solo acepta versiones
  *Enviado a Claude*.
- `responder_feedback` guarda el resumen nota por nota en `<video>.lulo.json`. El equipo lo ve en el
  reproductor como «Respuesta de Claude».

## Cómo está hecho

- `frontend/src/lib/feedback/r2.ts`: cliente S3 de R2 (`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`
  con multipart). Las claves solo viven en el servidor.
- `frontend/src/lib/feedback/feedback.ts`:
  - **Fuentes** (`FeedbackSourceSchema`): `edicion` (borrador actual), `director` (final actual),
    `studio` (medio del chat) y `archivo` (ruta dentro de la carpeta de proyectos; avatar, UGC,
    guion a video y proyectos). El servidor resuelve la ruta y nunca acepta una ruta libre fuera de
    la carpeta de proyectos.
  - **Subir**: la clave es `<Proyecto>/<Nombre>.mp4`. Los metadatos van codificados como URL:
    `lulo=1`, `origen`, `titulo`, `version` y `persona` (el nombre de la persona en Costos).
  - **Registro local**: `<datos>/feedback/registro.json`, una entrada por clave con su origen, ruta,
    feedback, `revisadoEn` y `claude`.
  - **Estado**: `reviewState()` es la misma regla que `stateFor()` en la app de feedback. La decisión
    (`decision {tipo, por, en}`) viene de `.feedback.json`. `claude.tomadoEn`, `respuesta` y
    `siguiente` vienen de `.lulo.json`, comparados por fecha.
  - **Leer**: `syncFeedback()` hace un `ListObjectsV2` y descarga solo los `.feedback.json` y
    `.lulo.json` que cambiaron. `refreshEntry(key)` lee un solo video. Nunca hay un temporizador.
  - **Claude**: `sendFeedbackToClaude`, `takeFeedback` y `respondFeedback`. Escriben `<video>.lulo.json`
    con metadatos `tomado`, `destino`, `notas`, `respondido` y `siguiente`.
  - Una versión nueva del mismo origen (misma edición o producción) marca la anterior con `siguiente`.
- `frontend/src/app/api/feedback/route.ts`:
  - `GET [?sync=1]`: la bandeja (con `sync=1` lee el bucket).
  - `POST`: `estado`, `subir`, `claude`. Todo con `assertAppUiRequest`, igual que aprobar.
- UI:
  - `components/feedback/FeedbackButton.tsx`, colocado en `EditDetail`, `ProductionBar`,
    `ClaudeStudioView`, `AvatarWorkspace`, `UgcGeneratorView`, `TextToVideoView` y
    `ProjectsLibraryView`.
  - `components/feedback/FeedbackInbox.tsx`, en la barra superior.

## App de feedback (cambios del 2026-11-10)

- `functions/_lib/util.js`: `reviewState` y `stateFor` (estados), `luloInfo`, `decisionFromMeta` y
  `feedbackMeta`. Los metadatos `decision`, `decisionEn` y `decisionPor` van en el `.feedback.json`
  para poder listar sin descargar nada.
- `GET /api/projects`: cada video trae `estado`, `decision` y `lulo`.
- `GET /api/feedback/<key>`: añade `estado` y `lulo` (con `respuesta`).
- `PUT /api/feedback/<key>`: las notas aceptan `autor` y se conserva la decisión. Responde 409 si el
  video está en *Claude trabajando* o *Hay versión nueva*.
- `POST /api/feedback/<key>` `{accion:"decidir", tipo:"cambios"|null, por}`: «Enviar a Claude» (o retirar el envío).
- `public/app.js`: resumen por estado, sección «Para revisar», tarjetas con color, panel «Enviar a Claude» en
  el reproductor (nombre, «Enviar a Claude» / «Retirar envío», respuesta de Claude, versión nueva) y
  notas cerradas mientras Claude trabaja.
- **Diseño Lulo Studio (2026-11-10):**
  - Mismos tokens que `globals.css`: oscuro por defecto y claro si el sistema lo pide; lima `#C6FF3D`
    para las acciones principales, naranja lulo para «Pedir cambios».
  - Tipografía: Archivo 125 % en los títulos, Geist en el texto y Geist Mono en las etiquetas.
  - Logo `public/brand/` y `favicon`, copiados de `brand/lulo-studio-logo/`.
  - Cualquiera con el enlace puede comentar (decisión del dueño).
- **Celular:**
  - El video queda fijo arriba mientras se leen las notas y se suelta al escribir, para dejar sitio
    al teclado (`body.is-editing`).
  - El orden es notas → feedback general → «Enviar a Claude»; el estado se ve junto al título.
  - Botones de al menos 40 px, campos de 16 px (iOS no hace zoom), márgenes seguros
    (`env(safe-area-inset-*)`), sin atajos de teclado en pantallas táctiles y miniaturas 4:5
    (los videos de Lulo son verticales).
- Publicar: `cd ~/Documents/feedback && npx wrangler pages deploy --branch main` (con la sesión de
  `wrangler login`).

## Robustez (revisión del 2026-11-10)

- **Relojes:** Lulo marca la extracción y la respuesta con una hora que nunca queda antes del envío del
  equipo (`stampAfter`), y la app de feedback hace lo mismo al reenviar. Así un reloj mal puesto en un
  PC no deja el estado atascado.
- **Orden de escritura:** extraer y responder escriben primero `.lulo.json` en el bucket y después el
  registro local. Si falla el bucket, nada cambia.
- **El bucket manda:** lo que se borra en R2 también se borra en el registro local. Lo que se sube o se
  extrae mientras se lee el bucket no se toca. Un fallo de red no cuenta como leído.
- **Versión nueva:** todas las anteriores apuntan a la nueva.
- **Extraer dos veces:** si una versión ya está en *Claude trabajando*, se responde con un 409 y no se
  le reenvía nada a Claude.
- **Nombres:** un nombre que ya existe en el proyecto (otra versión, otro video u otro PC) recibe « (2)»,
  « (3)»… para no pisarlo. Subir otra vez la misma versión reutiliza su clave.
- **Tipo de archivo:** cada video se sube con el tipo de su extensión (`.mov`, `.webm`…).
- **App de feedback, varios revisores a la vez:** el guardado fusiona las notas (`base` + `savedAt`) y
  «Enviar a Claude» espera a que termine el guardado en curso.

## Configuración (cada PC del equipo)

Añadir en `frontend/.env.local` (lo mismo para todo el equipo; los valores los tiene el dueño):

```
FEEDBACK_R2_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com
FEEDBACK_R2_ACCESS_KEY_ID=...
FEEDBACK_R2_SECRET_ACCESS_KEY=...
FEEDBACK_R2_BUCKET=video-feedback
FEEDBACK_APP_URL=https://video-feedback-b07.pages.dev
```

Sin estas variables, el botón da un aviso al subir y la bandeja no aparece. Los nombres empiezan por
`FEEDBACK_` para no activar sin querer el almacenamiento S3/R2 antiguo (`storage.service.ts` lee `R2_*`).
El token `cfut_…` es de R2 (solo objetos): no sirve para publicar la app de feedback.

Seguridad: la app de feedback no tiene inicio de sesión, así que cualquiera con el enlace puede ver y
comentar. Para cerrarla, ver Cloudflare Access en el README de la app de feedback.
