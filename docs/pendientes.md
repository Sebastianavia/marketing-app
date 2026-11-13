# Pendientes (mapeo)

Lo que está programado pero falta probar o terminar. Al resolver un punto, márcalo con la fecha y una línea de resultado.
Lo que solo falta probar en Windows está aparte, en `docs/pruebas-windows.md` (issue #2).

## 1. Pruebas con dinero (ElevenLabs): requieren aprobar un gasto

Funcionan con la aprobación de gasto del editor (tarjeta amarilla en la tarjeta del borrador). Hazlas con un video corto para gastar poco.

- [ ] **Doblaje (`doblar_video`):** ElevenLabs Dubbing v1 sin marca de agua, $0,50/min (lista oficial del 13 nov 2026).
  - [ ] **Pedírselo a Claude:** en el chat de una edición con borrador de unos 30 s, escribe «dobla el video a inglés», que debería costar unos $0,25. Aprueba la tarjeta.
  - [ ] **Comprobar la API:** `POST /v1/dubbing` acepta los campos que enviamos (`watermark=false`, `source_lang=es`, `num_speakers=1`, `highest_resolution`).
  - [ ] **Comprobar el estado:** `GET /v1/dubbing/{id}` devuelve `status: "dubbed"`. El nombre de ese estado se tomó de la documentación sin probarlo.
  - [ ] **Comprobar la descarga:** `GET /v1/dubbing/{id}/audio/en` devuelve MP4 o MP3; las dos ramas están programadas.
  - [ ] **Comprobar el resultado:** la variante «Doblaje inglés» aparece en Publicar, con subtítulos en inglés y el estilo del video.
  - [ ] **Comprobar el cobro:** en Costos aparecen el doblaje y la transcripción, y el saldo descontado de la aprobación es el correcto.
  - [ ] **Si algo falla:** revisar `lib/editor/paid.ts → dubDraft`.
- [ ] **Corregir una palabra (`corregir_palabra`):** voz clonada con `eleven_multilingual_v2`, por caracteres (céntimos).
  - [ ] Necesita una voz clonada de la persona del video en Voice Studio.
  - [ ] Pídele a Claude «corrige la palabra X en el segundo N con mi voz» y aprueba.
  - [ ] Escuchar el empalme: tempo y volumen. Que el labio quede tapado con un cambio de plano o un elemento.
- [ ] **Director:** generación y montaje (proyecto de las zapatillas, ≈ $0,61 pendiente de aprobar).
- [ ] **Estudio Claude:** render, montaje y edición, y video de avatar (`avatar_video`).

## 1b. Cortes limpios (Fase 8): probar con un video real con apuntador

- [ ] **Edición nueva con un video donde alguien dicte detrás de cámara.** Comprobar:
  - [ ] En la revisión salen «Voz de fondo» y el motivo «te dictan… y lo repites en…».
  - [ ] En el borrador no se oye al apuntador.
  - [ ] La separación de hablantes llegó de verdad desde Scribe (`palabras[].h` en el JSON de la edición).
- [ ] **Escuchar las dos zonas sospechosas del video de Santi**, guardadas en `~/LuloStudio_Projects/Pruebas editor viral/Fase 8 - posible voz de fondo…mp3`. Si son voz de Santi (un «mm»), hay que afinar el detector; si es otra persona, está bien cortado.
- [ ] **Ajustar si hace falta:** el umbral de labios (12 % de movimiento) y el de tono (35 %), en `lib/editor/voices.ts`.

## 1c. Estándar ETM (marca «Santiago Ruiz»)

- [x] **Marca «Santiago Ruiz» creada en la pestaña «Marcas»** con el estándar ETM v1 pegado (13 nov 2026).
- [ ] **Corregir sus colores y su fuente:** primario #0A0A0B, acento #F4581C, texto #F6EFE6, fuente Sora SemiBold. Hoy tiene los de Lulo por defecto (lima y blanco), que el estándar prohíbe y que usan la intro, el cierre y la caja de Instagram.
- [x] **Cerrar lo que el motor no cumplía del estándar (Fase 9, 13 nov 2026).** Hecho:
  - corte por palabra;
  - subtítulos bajo el mentón;
  - fuentes;
  - caja de comentarios de Instagram;
  - aire final y sobre la cabeza;
  - barrido;
  - sombra suave;
  - verificar el audio final.

  Lo que queda está en `ENGINE_LIMITS`, en `frontend/src/lib/editor/brand-standard.ts`.
- [ ] Probar una edición real de ETM de principio a fin y revisar el checklist del punto 11 del estándar.

## 2. Datos compartidos del equipo (R2): sin estrenar en modo compartido

Se activan desde la app. Si no aparece el aviso «solo en este PC», ya está compartido. Después, un compañero comprueba que lo ve.

- [ ] Manual de edición (pestaña Manual).
- [ ] Biblioteca de audio (pestaña Audio): subir un audio con su licencia.
- [ ] Marcas (pestaña Marcas): crear la de Lulo Studio con su logo.
- [ ] Métricas del equipo (`_lulo/metricas.json`) y fichas de referencias (`_lulo/referencias.json`).

## 3. Funciones por terminar

- [ ] **Seguir objetos que no sean la persona** (un producto): seguidor de OpenCV. La Fase 4 solo sigue cara y manos.
- [ ] **Métricas automáticas** (API de YouTube Analytics y cuentas profesionales de TikTok/Instagram). Hoy se cargan desde una captura o un CSV.
- [ ] **Doblaje:** los textos del kit y los gráficos siguen en español. Claude lo avisa, pero no los traduce.
- [ ] **Render con internet:** el kit de gráficos carga GSAP desde jsDelivr; sin conexión fallaría. Opción: guardar GSAP en local.
- [ ] Recorte de persona con PyTorch (RVM) y Whisper local: sin probar.
- [ ] Cliente MCP de Buzzy (falta la URL y la clave).
- [ ] Campañas automáticas (Fase 2 del plan general).
- [ ] Login con Google: hoy solo es fachada.
- [ ] Genjutsu (clonación y reemplazo): sigue simulado.
