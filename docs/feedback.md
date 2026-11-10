# Lulo Studio ↔ app de feedback

Actualizado el 2026-11-10. La app de feedback (repo aparte en `~/Documents/feedback`, publicada en
https://video-feedback-b07.pages.dev) sirve para que el equipo vea un video y deje notas por segundo.
Lulo sube allí los videos y trae de vuelta las notas para que Claude las aplique.

## Cómo se usa

1. Debajo de cada video final o borrador hay un botón **«Subir a Feedback»**. Al pulsarlo se puede
   cambiar el proyecto (la carpeta en Feedback) y el nombre del video antes de subirlo.
2. Después el botón muestra **«En Feedback · N notas»**, que abre el video en la app de feedback.
   Ese enlace se comparte con el equipo.
3. El equipo deja notas en la app de feedback. Lulo revisa el bucket **cada 3 minutos** (y al abrir
   la bandeja). Cuando hay notas nuevas, el icono **Feedback** de la barra superior muestra cuántas.
4. **«Enviar notas a Claude»** (en el botón o en la bandeja) le pasa las notas al Claude que hizo el
   video, que las aplica y publica una versión nueva. Esa versión se sube otra vez con el botón.
5. La app de feedback muestra de qué servicio viene cada video, «Claude ✓» cuando Claude ya recibió
   las notas, y un enlace a la versión nueva.

No se envía nada a Claude automáticamente: la app de feedback guarda mientras se escribe, así que
un envío automático mandaría notas a medio escribir. Lo decide una persona (o Claude cuando se lo piden).

## A quién le llegan las notas

| Video subido desde | «Enviar a Claude» va a |
|---|---|
| Edición de video (borrador vN) | El chat «Claude · editor» de esa edición |
| Guion a video · Director (final vN) | El chat «Claude · director» de esa producción |
| Estudio Claude (video del chat) | El chat de ese proyecto del Estudio |
| Avatar Studio, UGC Studio, Guion a video manual, Proyectos | Una edición nueva con Claude a partir de ese video (requiere «Claude · mi suscripción» en el selector IA) |
| Subido por otra persona del equipo | No hay archivo local: Claude lo lee con `feedback_pendiente` en el Estudio Claude |

## Herramientas de Claude ($0)

| Dónde | Herramientas |
|---|---|
| Claude · editor | `ver_feedback` (notas de los borradores de esa edición), `marcar_feedback_revisado` |
| Claude · director | `ver_feedback`, `marcar_feedback_revisado` |
| Estudio Claude | `subir_a_feedback`, `ver_feedback` (de ese proyecto), `feedback_pendiente` (notas nuevas de **todos** los videos del equipo, para recogerlas y revisarlas), `marcar_feedback_revisado` |
| Claude Code en la terminal (MCP `lulo-studio`) | `feedback_pendiente`, `marcar_feedback_revisado` |

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
  - **Sincronizar**: `ListObjectsV2` de todo el bucket; solo se descargan los `.feedback.json` que
    cambiaron. También entran los videos subidos por otras personas, con `origen: null`.
  - **Claude**: `sendFeedbackToClaude` y `markReviewed`. Escriben `<video>.lulo.json` con metadatos
    `claude`, `destino`, `notas` y `siguiente`.
  - Una versión nueva del mismo origen (misma edición o producción) marca la anterior con `siguiente`.
- `frontend/src/app/api/feedback/route.ts`:
  - `GET [?sync=1]`: la bandeja.
  - `POST`: `estado`, `subir`, `claude`, `revisado`. Todo con `assertAppUiRequest`, igual que aprobar.
- UI:
  - `components/feedback/FeedbackButton.tsx`, colocado en `EditDetail`, `ProductionBar`,
    `ClaudeStudioView`, `AvatarWorkspace`, `UgcGeneratorView`, `TextToVideoView` y
    `ProjectsLibraryView`.
  - `components/feedback/FeedbackInbox.tsx`, en la barra superior.
- Lectura periódica: `startFeedbackPoller()` en `instrumentation.ts`, cada 3 minutos y solo si está
  configurado. Son unas 15 000 lecturas al mes, muy lejos del límite gratis de R2.

## App de feedback (cambios del 2026-11-10)

- `functions/_lib/util.js`: `LULO_SUFFIX` y `luloInfo()`.
- `GET /api/projects`: cada video trae `lulo` (origen, versión, persona, Claude, versión nueva) a partir
  de los metadatos del listado, sin descargar nada más.
- `GET /api/feedback/<key>`: añade el campo `lulo`. El JSON anterior no cambia; `PUT` lo ignora.
- `public/app.js`: etiquetas «Edición de video · v3», «Claude ✓» y «Hay versión nueva» en las tarjetas,
  y una barra de Lulo en el reproductor.
- Publicar: `cd ~/Documents/feedback && npx wrangler pages deploy --branch main` (con la sesión de
  `wrangler login`).

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
