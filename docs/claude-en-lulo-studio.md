# Claude en Lulo Studio — guía para el equipo

Actualizado el 2026-11-04. Resume lo que cambió en la app para que **Claude** (con la suscripción
Pro/Max de cada persona) dirija y haga los videos, cómo usarlo y cómo dejarlo listo en Windows.
El detalle técnico de cada pieza está en `CLAUDE.md` (sección "Decisiones de arquitectura").

---

## 1. Cómo usa la app a Claude (sin clave de API)

- La app **no** usa el token de la suscripción: lanza el programa oficial **Claude Code** que cada
  persona tiene instalado y con la sesión iniciada en su PC (`claude` → `/login`). Así cada uno usa
  su propio plan. No se comparten cuentas.
- Usar el token de la suscripción en otras apps o en proxies tipo OmniRoute va **contra los
  términos de Anthropic** y puede acabar en el bloqueo de la cuenta. No lo hagan.
- El plan Pro tiene un **cupo** (ventana de 5 h y semanal). El selector «IA» de la barra superior
  muestra cuánto se ha usado. Si se agota, la app avisa y pregunta antes de pasar a algo de pago.

### Selector «IA» (barra superior)

| Opción | Qué hace |
|---|---|
| Gratis · Gemini | Como antes: claves de Gemini, $0. |
| **Claude · mi suscripción** | Claude Code de tu PC. $0 extra (gasta cupo del plan). Activa todo lo de esta guía. |
| Claude Haiku / Sonnet | Claude por OpenRouter, de pago por uso. |

---

## 2. Qué hace Claude en cada herramienta (con «Claude · mi suscripción»)

| Herramienta | Quién hace qué |
|---|---|
| **Estudio Claude** (nuevo, primera de la barra lateral) | Chat a pantalla completa: le pides un video y Claude elige y encadena las herramientas (UGC, avatar que habla, edición), te muestra el plan, los costos, pide aprobación y te entrega el video en el chat. |
| **Edición de video** | La app transcribe (ElevenLabs, ≈ $0,004/min) y **Claude hace la edición completa desde el principio**: mira el video, corta, pone gancho, subtítulos, zooms, efectos, pantalla dividida, color… El chat «Claude · editor» queda para pedir cambios. |
| **UGC Studio** | **Gemini** (gratis) arma el storyboard con sus 14 agentes; **Claude** lo revisa como jefe de producción, manda corregir escenas y corrige erratas directamente; decide en el chat; al montar, el video pasa solo al editor y Claude lo pule. Renderizar pide tu confirmación. |
| **Guion a video · Director** | Claude arma el proyecto desde la idea (ajustes, guion, prompts) y te guía. La generación del video (voz + tomas + montaje) está hecha pero **sin probar con dinero** (ver pendientes). |
| Mia, guiones, «Dar emoción», plan de escenas | Los escribe Claude. |

Con Gemini o Claude de pago en el selector, todo funciona como antes.

---

## 3. El dinero: siempre lo aprueba una persona

- **Estudio Claude**: tarjeta «Claude pide aprobar $X» dentro del chat (Aprobar / No).
- **Director**: botón amarillo «El Director pide $X» en la barra superior.
- **UGC Studio**: tarjeta de confirmación en su chat.
- Ningún Claude puede aprobarse un gasto: las rutas de aprobación solo aceptan la ventana de la app,
  y los Claude de la app tienen bloqueados los comandos con *approve*, *approvals*, *reject*,
  `localhost:3000`, `.env.local` y el token del Director.
- Todo queda en **Costos** (los renders de UGC Studio también, desde el 2026-11-04).

---

## 4. Seguridad de los Claude de la app

| | macOS / Linux | Windows |
|---|---|---|
| Comandos (FFmpeg, Python, descargas) | **Aislados** (sandbox de Claude Code): solo escriben en la carpeta del proyecto y en la de herramientas, no leen el resto de tu carpeta personal, sin localhost, red solo a sitios de descargas | **Con todos tus permisos** (Windows no tiene sandbox; decisión del dueño). Se apaga con `LULO_CLAUDE_BASH_SIN_AISLAMIENTO=0` en `.env.local` |
| Claves de `.env.local` | No llegan a Claude (entorno con lista blanca) | Igual |
| Aprobar gastos | Bloqueado | Bloqueado por reglas (no por sandbox) |
| Lectura/escritura con sus herramientas de archivos | Solo su carpeta | Solo su carpeta |

Descargas permitidas en macOS/Linux: PyPI, GitHub, Hugging Face, npm, Google Fonts y sitios
oficiales de FFmpeg. Más dominios: `LULO_CLAUDE_DOMINIOS=dominio1.com,dominio2.com`.

---

## 5. Dejarlo listo en Windows (PC de Sebas)

1. **Actualizar el código**: `git pull` en `master`, luego en `frontend`: `npm install`.
2. **Claude Code** (instalador nativo recomendado, deja `claude.exe` en `%USERPROFILE%\.local\bin`):
   abrir PowerShell → instalar desde https://claude.com/claude-code → ejecutar `claude` → `/login`
   con la cuenta Pro/Max propia. Comprobar con `claude auth status`.
   - Si se instaló con npm (`claude.cmd`) también funciona; la app lo detecta.
   - Si la app no lo encuentra: `CLAUDE_CLI_PATH=C:\ruta\a\claude.exe` en `frontend\.env.local`.
3. **Git for Windows** (https://git-scm.com): Claude Code lo usa para ejecutar comandos. Sin él,
   Claude solo usa las herramientas de Lulo (no FFmpeg/Python propios). Si está en otra ruta:
   `CLAUDE_CODE_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe`.
4. **FFmpeg con libass** (subtítulos del editor): la versión «full» de gyan.dev. Si no está en el
   PATH: `FFMPEG_PATH=` y `FFPROBE_PATH=` en `.env.local`. Evitar FFmpeg 8.0 / 8.0.1 (bug en `aselect`).
5. **Carpeta de proyectos**: `D:\LuloStudio_Projects` (o `C:\…` si no hay D:). Se cambia en
   Proyectos → ajustes de carpeta; debe ser una ruta completa.
6. Arrancar: `cd frontend; npm run dev` → http://localhost:3000 → selector «IA» → «Claude · mi
   suscripción» (debe decir «Plan pro» o «max»).
7. **Regla manual pendiente** (Claude Code no puede editar ese archivo): en `.claude/settings.json`,
   dentro de `"deny"`, añadir `"Bash(*api/studio*approvals*)"` y
   `"PowerShell(*api/studio*approvals*)"`, para que Claude Code en la terminal tampoco apruebe
   gastos del Estudio Claude.
8. **Skills de video (HyperFrames) en los Claude de la app** (2026-11-10):
   - **Node 22 o más** (`node -v`); con Node 20 la app arranca, pero HyperFrames no y Claude lo dice.
   - `ffprobe` junto a `ffmpeg` en el PATH (viene en la versión «full» de gyan.dev) o `FFPROBE_PATH`.
   - Nada más que instalar: las skills vienen con `git pull` (`.agents/skills/`) y la app las copia sola a
     `%APPDATA%\LuloStudio\claude-skills\lulo-video\` en el primer turno de Claude. La primera vez
     que se renderiza, `npx` descarga `hyperframes@0.9.28` y un Chrome propio (un par de minutos).
   - Probar: Estudio Claude → «con HyperFrames haz un título animado vertical de 3 s que diga Lulo
     Studio, renderízalo en draft y muéstramelo». Debe usar la skill `hyperframes`, `revisar_html_video`
     y `renderizar_html_video` y enseñar el video. Luego en una edición: «añade un título animado al
     inicio con HyperFrames» → nueva versión del borrador.
   - Si falla, mirar el texto del error en el chat (Node, FFmpeg/ffprobe o descarga de Chrome bloqueada
     por el antivirus/proxy) y probar a mano en PowerShell: `npx -y hyperframes@0.9.28 doctor`.

9. **Material para Claude** (2026-11-10): en Edición de video, Guion a video (Director) y Estudio Claude
   hay un botón de adjuntar en el chat y «Carpeta de material» (también al crear). Elige una carpeta
   concreta (p. ej. `D:\Material\Campaña X`): no se aceptan discos enteros, la carpeta personal, la
   del código ni `AppData`. Claude la lee y copia lo que usa a su carpeta; en Windows no hay aislamiento,
   así que no guardes ahí nada que no quieras que Claude pueda ver. En UGC, el botón de carpeta del chat
   deja elegir fotos de referencia de esa carpeta.

### Lo que se corrigió pensando en Windows

- Una sola variable `PATH`/`Path` al lanzar Claude (antes podía no encontrar FFmpeg/Python).
- Reglas de permisos con rutas en el formato que usa Claude Code en Windows (`/c/Users/...`).
- Configuración del MCP y permisos en archivos, no en la línea de comandos (límite de 8191
  caracteres de `cmd.exe` con `claude.cmd`); esquemas JSON largos van en el mensaje.
- Comprobación de «archivo dentro de la carpeta» sin distinguir mayúsculas.
- La carpeta de proyectos por defecto ya no crea `C:\…` relativo en macOS/Linux.
- Skills de video: `.gitattributes` fuerza LF en `.agents/skills` y `.claude/skills` (los `.sh` con CRLF
  fallan en Git Bash); `npx.cmd` vía cross-spawn con rutas con espacios; al cortar un render se mata el
  árbol entero (`taskkill /T`, si no Chrome queda vivo); la copia del plugin reintenta si Windows tiene
  la carpeta bloqueada y, si no puede, sigue con la anterior; solo se pasan a HyperFrames rutas de
  FFmpeg/ffprobe que existen; rutas de las skills < 160 caracteres (límite 260).

> Todo esto se probó en macOS. **En Windows no se ha probado todavía**: es el primer paso pendiente.

---

## 6. Variables nuevas de `.env.local` (todas opcionales)

| Variable | Para qué |
|---|---|
| `CLAUDE_CODE_MODEL` | Modelo de Claude Code (`sonnet` por defecto; `opus`/`haiku` según el plan). |
| `CLAUDE_CLI_PATH` | Ruta a `claude`/`claude.exe` si la app no lo encuentra. |
| `LULO_CLAUDE_DOMINIOS` | Dominios extra para descargas de Claude (macOS/Linux). |
| `LULO_CLAUDE_BASH_SIN_AISLAMIENTO=0` | Windows: apagar los comandos de Claude (solo herramientas de Lulo). |
| `FFMPEG_PATH`, `FFPROBE_PATH` | FFmpeg completo si no está en el PATH. |
| `LULO_HYPERFRAMES_VERSION` | Versión de HyperFrames para los Claude de la app (por defecto `0.9.28`). |

---

## 7. Estado y pendientes

| Servicio | Estado |
|---|---|
| UGC Studio | ✅ Probado con dinero real (UGC de Lulo Studio, 768p, $0,75). |
| Edición de video con Claude | ✅ Probado (videos de 10–15 s): primer pase, cambios por chat, pantalla dividida, efectos. |
| Estudio Claude | 🟡 Probado hasta la aprobación del render; falta render + montaje + edición desde el estudio. |
| Director · generación | 🟡 Preparar y aprobar probados; generar y montar sin probar (≈ $0,61 del proyecto de zapatillas). |
| Avatar Studio desde el Estudio | 🟡 Conectado (2026-11-05): Claude elige avatar o foto, voz y texto, pide aprobación y genera. Costo y listas probados; el video sin probar con dinero. |
| Voz, Imágenes desde el Estudio | 🧪 Funcionan en su pantalla; aún no se pueden usar desde el Estudio (la voz sí se usa dentro del avatar). |
| Genjutsu, Buzzy | 🚧 En construcción. |

Pendiente: probar todo en Windows; un video real hablando a cámara de 30–60 s en el editor;
funciones avanzadas del editor (recorte de persona con PyTorch, Whisper local, caras con OpenCV).
