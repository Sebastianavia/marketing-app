# Pruebas pendientes en Windows

Todo esto se probó en macOS, pero falta probarlo en un PC con Windows. Marca cada punto al probarlo y anota lo que falle (con el mensaje de error y la ruta).
Antes de empezar, prepara el equipo con la guía `docs/claude-en-lulo-studio.md`: Git for Windows, FFmpeg «full» con libass, Node 22 o más y Claude Code con la sesión iniciada.

## 0. Arranque

- [ ] `cd frontend; npm install; npm run dev` arranca sin errores y abre en http://localhost:3000.
- [ ] En el selector IA aparece «Claude · mi suscripción» y `GET /api/system/claude-code` dice instalado, con sesión.
- [ ] Edición de video → **Herramientas**:
  - [ ] Detecta Python, FFmpeg y HyperFrames.
  - [ ] «Preparar herramientas de Claude» instala numpy, scipy, opencv, fonttools y pillow en `%APPDATA%\LuloStudio\claude-herramientas\py` (mediapipe puede fallar con Python ≥ 3.13; anotarlo).
  - [ ] `npx hyperframes browser ensure` descarga Chrome.

## 1. Claude en la app (suscripción, sin sandbox en Windows)

- [ ] **Claude lanza bien:** Mia con «Claude (mi suscripción)» responde. `claude.cmd` o `claude.exe` se lanzan por cross-spawn y las rutas con espacios funcionan (`D:\github\app- marketing`).
- [ ] **Chat del editor:** sobre un video corto real, el primer pase completo termina:
  - mira fotogramas;
  - escucha el audio;
  - escribe el plan;
  - renderiza;
  - publica un borrador.
- [ ] **Bash corre sin aislamiento** (modo `sin_aislamiento`). Comprueba:
  - [ ] Claude no puede leer `.env.local`.
  - [ ] Claude no puede llamar a `localhost:3000`.
  - [ ] Claude no puede aprobar gastos.
- [ ] **Herramientas de Python de Claude:** instala paquetes con `<python> -m pip install --target …\py` y luego los encuentra (`PYTHONPATH` con `;`).
- [ ] **Material y adjuntos:**
  - [ ] Elegir una carpeta de material funciona.
  - [ ] Adjuntar archivos y pegar con Ctrl+V en todos los chats (editor, Director, Estudio Claude, UGC) funciona.
  - [ ] Claude lee la carpeta de material.
- [ ] **Skills de video:** el plugin `lulo-video` carga las skills y `revisar_html_video` / `renderizar_html_video` renderizan HyperFrames (Chrome headless, `npx.cmd`).
- [ ] Director y Estudio Claude: un turno completo cada uno.

## 2. Editor de video: lo nuevo del 10 al 12 de noviembre

- [ ] **Edición dirigida por Claude:**
  - [ ] Cámara, transiciones, subtítulos `pop`/`caja_activa`, palabras clave con efecto, elementos (capa, flotante, pantalla dividida), efectos de sonido sintetizados y música generada.
  - [ ] Las fuentes de `%APPDATA%\LuloStudio\fuentes` salen bien en los subtítulos (libass).
- [ ] **Fase 1 (estructura):**
  - [ ] Arranque en frío con destello y swish.
  - [ ] Silencio dramático (fotograma congelado + silencio total).
  - [ ] Bucle.
  - [ ] Barra de progreso y contador «PASO n/N».
- [ ] **Fase 2 (sonido):**
  - [ ] `beats_musica` con música generada y con un MP3 propio.
  - [ ] Efectos de voz (teléfono, eco…) por tramo.
  - [ ] Ambientes de fondo.
  - [ ] Cámara lenta en un clip de apoyo.
  - [ ] Volumen final (−14 Instagram, −13 TikTok).
  - [ ] **Filtros de FFmpeg:** que el FFmpeg de Windows tenga `deesser`, `acrusher` y `aecho` (`ffmpeg -filters`).
- [ ] **Fase 3 (gráficos):**
  - [ ] `kit_grafico` renderiza las 8 piezas a `.mov` transparente (HyperFrames + Chrome en Windows; necesita internet para cargar GSAP).
  - [ ] La capa se ve encima del video en el render final.
  - [ ] `disenar_portada` recorta a la persona con MediaPipe (`python\lulo_cutout.py`).
  - [ ] Las anotaciones sobre pausas (`pausas[].capa`) se ven.
- [ ] **Fase 4 (imagen y cámara):** ver la sección 4.

## 3. Datos compartidos del equipo (R2)

Se prueba igual en Mac y en Windows, pero hace falta un segundo PC para comprobar que se comparte:

- [ ] **Manual de edición (pestaña «Manual»):** las reglas que añade un PC aparecen en el otro.
- [ ] **Biblioteca de audio (pestaña «Audio»):**
  - [ ] Subir un MP3 con su licencia.
  - [ ] Verlo en el otro PC.
  - [ ] Claude lo usa como `biblioteca:<id>`.
- [ ] **Marcas (pestaña «Marcas»):**
  - [ ] Crear una marca con logo en un PC.
  - [ ] Usarla para una intro o un cierre en el otro.
- [ ] **App de feedback:** subir una versión, dejar notas, «Extraer notas y feedback» → Claude responde.

## 4. Fase 4 · Imagen y cámara

- [ ] **Pista de persona** (`python\lulo_person.py`):
  - [ ] Con el kit de herramientas de Claude instalado, `pista_persona` responde. En Mac tarda unos 19 s por minuto: anotar cuánto tarda en Windows.
  - [ ] Si mediapipe no se instaló (Python ≥ 3.13), el aviso es claro y el render sigue sin esos efectos.
  - [ ] La primera vez se descarga `pose_landmark_lite.tflite` dentro de `claude-herramientas\py*\mediapipe`: comprobar que hay permiso de escritura.
- [ ] **Reencuadre:** con `camara` en zoom 1,3, la cámara sigue la cara.
- [ ] **Seguimiento:** un sticker del kit (creado en x=0,5, y=0,5) con `seguir: mano_izquierda` sigue la mano.
- [ ] **Efectos con la persona:**
  - [ ] Fondo desenfocado.
  - [ ] Fondo cambiado (color e imagen).
  - [ ] Clon.
  - [ ] Elemento detrás de la persona (`detrasDePersona`).
- [ ] **Estabilizar e igualar la luz:**
  - [ ] `analizar_imagen` mide el temblor; necesita `vidstabdetect`: comprobar con `ffmpeg -filters | findstr vidstab`.
  - [ ] Sin vidstab, `estabilizar` usa `deshake` y el video sigue a 1080×1920.
  - [ ] `igualarLuz` funciona.

## 4b. Fases 5, 6 y 7 (con un borrador real)

- [ ] **Publicar → Exportar (TikTok, Reels, Shorts):** se descarga el MP4 y el `.srt` abre en un editor.
- [ ] **Claude:**
  - [ ] `crear_variante` (A/B y corta).
  - [ ] `texto_post`: se ve y se copia.
- [ ] **Nota de retención:** aparece sola tras renderizar.
- [ ] **Métricas:** adjuntar una captura de retención en el chat y pedir «analiza estas métricas».
- [ ] **Referencias:** `analizar_referencia` con un enlace. Necesita `yt-dlp` en Windows: `winget install yt-dlp`.
- [ ] **Subtítulos en dos idiomas:** `segundoIdioma`.
- [ ] **De pago (aprobar a propósito con poco dinero):**
  - [ ] `corregir_palabra` con una voz clonada.
  - [ ] `doblar_video` a inglés con un video corto (unos $0,25 por 30 s).

## 5. Empaquetado

- [ ] Rutas con espacios y tildes en la carpeta de proyectos (`D:\LuloStudio_Projects\Ediciones\Título con tildes …`).
- [ ] Ningún comando se pasa de los 8191 caracteres de `cmd.exe` (los ajustes y el MCP van en archivos).
