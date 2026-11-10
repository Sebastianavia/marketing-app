# Actualizar y probar Lulo Studio (último cambio: app de feedback)

Guía para traer los últimos cambios a tu PC y probar el flujo nuevo:
**Lulo Studio → app de feedback → Claude → versión nueva**.

> Las claves **no** están en el repo. Pídeselas al dueño por privado.

---

## 1. Requisitos (una sola vez)

- **Node.js 20 o más** y **Git**.
- **Claude Code** con tu sesión iniciada (plan Pro o Max), para que Claude haga las correcciones.
  En Windows, desde PowerShell:
  ```powershell
  irm https://claude.ai/install.ps1 | iex
  claude          # dentro escribe /login y entra con tu cuenta
  ```
- **Windows:**
  - **Git for Windows** (https://git-scm.com), que Claude Code usa para ejecutar comandos.
  - **FFmpeg «full»** (con libass), para los subtítulos del editor.
  - Detalle completo en [`docs/claude-en-lulo-studio.md`](docs/claude-en-lulo-studio.md).

## 2. Traer los cambios

En la carpeta del proyecto:

```bash
git pull
cd frontend
npm install
```

`npm install` es necesario porque hay una dependencia nueva para subir videos a Cloudflare
(`@aws-sdk/lib-storage`).

## 3. Añadir las claves de la app de feedback

Abre `frontend/.env.local` y pega al final (los tres primeros valores te los pasa el dueño):

```
FEEDBACK_R2_ENDPOINT=
FEEDBACK_R2_ACCESS_KEY_ID=
FEEDBACK_R2_SECRET_ACCESS_KEY=
FEEDBACK_R2_BUCKET=video-feedback
FEEDBACK_APP_URL=https://video-feedback-b07.pages.dev
```

- No compartas este archivo ni lo subas al repo (ya está en `.gitignore`).
- Si faltan estas variables, Lulo funciona igual, pero no aparece la bandeja **Feedback** y subir un
  video da un aviso.

## 4. Arrancar

```bash
npm run dev
```

1. Abre http://localhost:3000.
2. En el selector **IA** de la barra superior, elige **«Claude · mi suscripción»**. Debe decir tu plan
   (Pro o Max). Si no, revisa el paso 1.

## 5. Probar el flujo

1. Haz o abre un video. Lo más fácil: **Edición de video**, con una edición que ya tenga un borrador.
2. Debajo del video, pulsa **«Subir a Feedback»** y luego **Subir**.
3. Abre la app de feedback: https://video-feedback-b07.pages.dev (prueba también desde el celular).
   1. Entra al video, que aparece en **«Para revisar»**.
   2. Escribe tu nombre.
   3. Deja 1 o 2 notas en algún segundo (botón **+ Nota**) y, si quieres, un feedback general.
   4. Pulsa **«Enviar a Claude»**.
4. Vuelve a Lulo. En el bloque **Feedback** del video, pulsa **↻**, o abre la bandeja **Feedback** de
   la barra superior. Debe decir **«Enviado a Claude»**.
5. Pulsa **«Extraer notas y feedback»**. Claude descarga las notas, hace las correcciones y publica una
   versión nueva.
   - En la app de feedback, el video pasa a «Claude trabajando» y luego a «Claude respondió», con su
     respuesta nota por nota.
6. Cuando esté lista, pulsa **«Subir esta versión a Feedback»**. Se sube como versión siguiente en el
   mismo proyecto, la anterior queda como «Versión anterior» y el equipo puede seguir comentando.

Lulo **no** consulta la app de feedback en segundo plano. Para ver el estado más reciente, abre la
bandeja o pulsa **↻**.

## 6. Si algo falla

Avisa al dueño con:

- una captura del error en la app;
- lo que sale en la terminal donde corre `npm run dev` (las últimas líneas);
- tu sistema (Windows, Mac) y la salida de `claude --version`.

Errores típicos:

| Mensaje | Qué hacer |
|---|---|
| «Falta configurar la app de feedback» | Revisa las variables del paso 3 y reinicia `npm run dev` |
| «El equipo todavía no ha enviado sus notas a Claude» | En la app de feedback falta pulsar «Enviar a Claude» |
| «Elige «Claude · mi suscripción»» | Cámbialo en el selector **IA** (paso 4) |
| Claude no responde o pide iniciar sesión | En una terminal: `claude` y luego `/login` |

Más detalle técnico: [`docs/feedback.md`](docs/feedback.md).
