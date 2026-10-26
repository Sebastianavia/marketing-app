# Plan: Guion a video con orquestador estilo Buzzy

Fuente: documento "Guion a video — orquestador estilo Buzzy" (26 oct 2026). Estudio hecho leyendo los skills internos de Buzzy (`ai-story`, `faceless-reels` y sus referencias) por su conector MCP, sin generar nada.
Va DESPUÉS de la Fase 3 del plan del Director (`docs/plan-agente-director.md`) y reutiliza sus producciones con aprobación.

## Idea
Guion a video tendrá dos modos: el **manual** actual (intacto) y un **modo Director**: una línea de etapas escrita en el código (no en el prompt), con pausas de aprobación, donde la IA solo "piensa y escribe" con respuestas en formato fijo (zod). Así el texto corre con **Gemini gratis** (orquestador existente, `lib/ai/orchestrator.ts`; plan B Haiku; "confidencial" → Claude) y solo se paga imagen/voz/video, siempre tras aprobar.

## Etapas (modo Director)
1. Idea: guion pegado / idea / PDF + 2 preguntas de dirección con opciones (Gemini, $0).
2. Ajustes: formato, duración, modo de voz (voiceover ElevenLabs / voz nativa / presentador HeyGen), avatar, presupuesto. Por defecto lo más barato.
3. Estilo (opcional): imagen de referencia (biblioteca pequeña o subida). Solo look, nunca contenido.
4. Guion por escenas: escenas con tiempos `[0.0s-5.0s]`, qué se ve, diálogo entre comillas (Gemini, $0). PAUSA.
5. Elenco y lugares: personas desde avatares guardados; fichas para lo que falte; fondos vacíos (sin gente). Frase común "misma película: época, color, grano, luz". PAUSA.
6. Imagen inicial por escena: Seedream/Nano Banana con fotos del avatar + fondo + bloque de realismo. Es el primer cuadro que se anima (nuestro sustituto de las referencias múltiples de Buzzy). PAUSA.
7. Prompt por escena: visible/editable; bloque de realismo; "no background music" (Gemini, $0).
8. Presupuesto + aprobación (Director, Fase 2). Nada de video se paga antes.
9. Clips: máx. 4 en paralelo; escenas con persona hablando → HeyGen; resto → image-to-video desde su imagen inicial. Revisión automática de cada clip contra los 9 síntomas (Gemini con video; confirmar si el nivel gratis lo permite). Si falla, proponer rehacer con costo, nombrando el síntoma.
10. Final: FFmpeg (fundidos, voz continua), música opcional (fuente pendiente), tarjeta en Proyectos + "Editar video".

## Cinco movimientos (copiados de Buzzy) — por chat o botones en cada tarjeta
Saltar · Aportar (gana sobre Saltar) · Adelantar (corre sin pausas pero muestra guion/prompts) · Rehacer (invalida todo lo posterior) · Cambiar de forma (generar ↔ subir). El chat (Gemini) traduce cualquier frase a uno de estos sobre la tarjeta correcta.

## Reglas de consistencia (de Buzzy)
- Guion primero, fichas después (derivadas del guion).
- A cada escena solo las fichas/fondo que aparecen en ella; el prompt dice qué imagen es quién.
- La foto de la persona es ancla de identidad, NUNCA primer cuadro del video (si no, todas las escenas empiezan iguales). Cada escena arranca ya en su propio lugar.
- Voz: Buzzy usa el clip 1 como referencia de voz (requiere modelos con video de referencia). Nosotros: ElevenLabs (voz en off continua o HeyGen).
- Presentador: por defecto cortes dentro de la misma escena entre la persona y lo que cuenta; primera y última escena empiezan/terminan con la persona.
- Música solo una vez sobre el video unido, nunca dentro de los clips.

## Bloque de realismo (pegar en TODO prompt de imagen y video)
Velocidad real 1x sin cámara lenta; cámara en mano con temblor, sin gimbal/dolly; grano y ruido de sensor, rango dinámico limitado, desenfoque real (no todo nítido); solo luces que existen en el lugar, sin contorno brillante, sin bloom, sin teal-and-orange, saturación moderada; piel con poros, imperfecciones, asimetría; lugares con desgaste, desorden y suciedad; encuadre algo descentrado.
Los 9 síntomas a revisar: cámara lenta falsa · luz de contorno/bloom · piel de plástico · colores saturados · movimientos de cámara perfectos · lugares demasiado limpios · todo enfocado · extras que se repiten · encuadre demasiado centrado.

## Límites frente a Buzzy
- Por OpenRouter hoy pasamos solo la imagen inicial (Veo 3.1 Lite, Kling 3.0, Hailuo, Wan 3.0); Buzzy usa Seedance 2.5 (30 imágenes, 10 audios, 10 videos de referencia) y MiniMax H3. Revisar si algún modelo de OpenRouter acepta más referencias.
- Veo puede rechazar fotos de personas (ya pasó); el reintento sin foto cambia la cara.
- No hay generador de música.

## Gemini gratis (verificado 26 oct 2026 en ai.google.dev)
- Con nivel gratis: Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite. La app usa 2.5 Flash; probar 3.6/3.8 Flash.
- Nivel gratis: Google usa los datos para mejorar sus productos.
- Límites por PROYECTO de Google (no por clave); números en AI Studio. Solo suman claves de proyectos distintos.
- Grounding con Google Search no disponible gratis en 3.x (no hace falta aquí).

## Fases
1. Línea de etapas y tarjetas, solo texto ($0): idea → preguntas → ajustes → guion → prompts; estados en `produccion.json`. Prueba: guion de 30 s sin gastar; rehacer escena 2 sin tocar las demás.
2. Chat del Director ($0): cinco movimientos. Prueba: "no quiero imágenes iniciales", "ya tengo el guion", "hazlo todo hasta los prompts".
3. Elenco, fondos, imágenes iniciales (centavos) + bloque de realismo. Prueba: 3 escenas con Santiago, que se parezca en las tres.
4. Clips, revisión automática, video final (dinero real). Prueba: ~15 s con presupuesto $2.

## Decisiones pendientes
- ¿Después de la Fase 3 del Director (recomendado) o antes?
- Modelo gratis: 2.5 Flash vs 3.6/3.8 Flash.
- Música: carpeta propia libre de derechos vs servicio.
- Biblioteca de estilos (6–10 imágenes) vs solo subir.
- ¿Usar Buzzy por su conector como motor para lo que nuestros modelos no logran (pagando créditos)?
