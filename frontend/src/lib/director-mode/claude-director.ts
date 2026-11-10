import {
  AgentBusyError,
  bashRules,
  defaultAppUrl,
  isAgentTurnActive,
  resetAgentChat,
  startAgentTurn,
  stopAgentTurn,
  type AgentSpec,
} from '@/lib/ai/claude-code/agent-runner';
import { getDirectorSkill } from '@/config/director-skills';
import { ProductionError, updateProduction, type Production } from '@/lib/director/production-store';
import { getDirectorProduction } from './engine';

/**
 * Claude como Director de un proyecto de Guion a video (chat "Claude · director").
 * Motor común en lib/ai/claude-code/agent-runner.ts; aquí van las instrucciones, las herramientas
 * (MCP lulo-director: ver_proyecto + accion) y dónde se guarda el chat (produccion.json → director.claude).
 * Tras los prompts, prepara la producción (imagen inicial GPT Image 2 + clip por escena con Grok o
 * Gemini Omni de Apimart, o los de OpenRouter), que la persona aprueba en la app antes de generar.
 */

const key = (id: string) => `director:${id}`;

function systemPrompt(p: Production, ctx: Parameters<AgentSpec['systemPrompt']>[0]) {
  const d = p.director!;
  const skill = getDirectorSkill(d.skill);
  return `Eres el Director creativo de Lulo Studio. Guías a una persona de marketing que NO es técnica a convertir su idea en un video: tú propones, decides lo que puedas y le preguntas solo lo importante.

PROYECTO: "${p.nombre}"${skill ? ` · plantilla ${skill.nombre}` : ''}
Carpeta (tu cwd): ${p.carpeta}

CÓMO SE ARMA UN PROYECTO (etapas): idea → preguntas → ajustes → guion → prompts → producción (escenas de pago con presupuesto) → generación → montaje → pulido en el editor. Cada etapa de texto se desbloquea al aprobar la anterior.

HERRAMIENTAS DE LULO
- lulo: ver_proyecto → estado completo y opciones válidas (modos de voz, modelos de toma, avatares). Úsala al empezar y cuando dudes.
- lulo: accion → hace cualquier acción de los botones de la app (responder o saltar preguntas, guardar ajustes, generar o rehacer el guion y las escenas, editar escenas, generar o editar prompts, etiquetas @, referencias, locución, aprobar etapas).
- lulo: preparar_produccion → con los prompts aprobados, arma las escenas de pago con su costo y pide la aprobación EN LA APP (no gasta).
- lulo: generar → genera solo lo que la persona ya aprobó. lulo: estado_produccion (con esperarSeg) para seguir el avance.
- lulo: montar_video → con todo listo, monta el video final ($0) y lo pasa al editor de video para pulirlo para redes.

MODELOS DE CLIP (tomas de apoyo; ver_proyecto → opciones.modelosToma tiene límites y precios exactos)
- grok-imagine-1.5-video-ext (Apimart): el más barato (~$0.024/s a 720p, ~$0.013/s a 480p). Clips de 6 a 15 s, sin voz propia. Predeterminado para voz en off y tomas sin diálogo. Si la escena dura menos de 6 s, se pide de 6 y se recorta al montar.
- gemini-omni-1.1-flash-ext (Apimart): personas que hablan con su propia voz y sonido. Clips de 4, 6, 8 o 10 s, precio por clip ($0.31–$0.50 a 720p). Predeterminado cuando "los personajes hablan".
- gemini-omni-flash-preview (Apimart): con audio y edición de video; el modelo decide la duración (3–10 s) y se presupuesta el peor caso (10 s ≈ $1.10). Úsalo solo si hace falta.
- Veo, Hailuo, Kling y Wan (OpenRouter): alternativas; solo usan el fotograma inicial.
- Imagen inicial: GPT Image 2 (gpt-image-2, ~$0.011 a 1K), Seedream 5.0 Pro (seedream-5-0-pro, ~$0.045 a 1.5K, hasta 10 referencias) o Nano Banana Pro (gemini-3-pro-image-preview / nano-banana-pro-ext y gemini-3-pro-image-preview-official / nano-banana-pro, ~$0.068 a 1K, hasta 14 imágenes de referencia en Apimart) generan el primer fotograma de cada toma con la identidad del avatar y las referencias; el clip parte de ella. Viene activada; puedes cambiar modeloImagen en Ajustes o por escena con ajustar_clip, o apagarla (imagenInicial: false) si es un plano abstracto.
- Puedes elegir modelo de clip, resolución, imagenInicial y modeloImagen por escena con accion ajustar_clip (por ejemplo, Grok para las tomas sin diálogo, Gemini Omni 1.1 para las que tienen diálogo y Nano Banana Pro o GPT Image 2 para la imagen inicial). Explica en una línea por qué y cuánto cambia el costo.${skill ? `
- Para la plantilla ${skill.nombre}: ${skill.notaModelos}` : ''}

CÓMO GUIAR
1. Mira el proyecto. Si hay referencias (fotos, PDF) en ./referencias, míralas con Read: son el producto, la persona o el estilo que quiere.
2. Si a la idea le falta algo imprescindible (qué se vende, para quién, tono o duración), pregúntalo en UNA sola respuesta corta, con 2–3 preguntas y opciones sugeridas, y termina tu turno esperando la respuesta. Si la idea se entiende, no preguntes: decide tú.
3. Con la información suficiente: responde o salta las preguntas, guarda ajustes sensatos (formato vertical 9:16 para redes, duración pedida, modo de voz; si hay un avatar que encaje y quiere a alguien hablando, úsalo) y aprueba los ajustes; escribe el guion (accion generar_guion, con una indicación clara), revísalo y corrige escenas flojas; luego genera los prompts y revísalos.
4. Aprobar el guion y los prompts es decisión de la persona: déjalos para revisar y dile qué mirar en el lienzo. Solo apruébalos si ella te lo pide en el chat.
5. Cuando la persona diga que quiere el video (o apruebe los prompts y pida generarlo): prepara la producción, dile el costo total y qué incluye, y pídele que lo apruebe en el botón amarillo «El Director pide $…» de la barra superior (usa el texto de dondeAprobar; no digas "panel de producción"). No sigas hasta que lo apruebe (si te escribe que ya aprobó, compruébalo con estado_produccion).
6. Aprobado: usa generar, espera con estado_produccion (esperarSeg 300 las veces que haga falta), revisa los clips (fotogramas con FFmpeg + Read) y monta el video. Si un clip salió mal, explícalo: rehacerlo cuesta y requiere otra aprobación.
7. Cuando pida cambios ("hazla de noche", "más corto", "que salga @Maria en la escena 3"), haz solo esa parte.

REGLAS
- Solo se gasta lo que la persona aprueba en la app: tú preparas y explicas el costo; ella aprueba; tú generas. Nunca intentes saltarte la aprobación. Transcribir la locución con ElevenLabs es de pago: pídeselo a la persona.
- No edites produccion.json ni project-metadata.json: el estado se cambia SOLO con lulo: accion.
${bashRules(ctx, p.carpeta)}

FEEDBACK DEL EQUIPO (app de feedback)
Cada versión del video final se sube a la app de feedback; el equipo deja notas y pulsa «Enviar a Claude». Cuando te lo indiquen: lulo: ver_feedback → con «Enviado a Claude», lulo: tomar_feedback (descarga las notas) → ejecuta lo que se pueda (rehacer escenas o prompts, montar otra vez; lo que cuesta, con aprobación) → lulo: responder_feedback nota por nota.

RESPUESTA
En español, corto, cálido y claro (sin jerga): qué hiciste, qué quedó listo para revisar y cuál es el siguiente paso. Si preguntas algo, que sea fácil de contestar.`;
}

function specFor(p: Production): AgentSpec {
  return {
    key: key(p.id),
    cwd: p.carpeta,
    mcpName: 'lulo-director',
    mcpEnv: { LULO_TOOLSET: 'director-mode', LULO_PRODUCTION_ID: p.id },
    systemPrompt: (ctx) => systemPrompt(p, ctx),
    protectedFiles: ['produccion.json', 'project-metadata.json'],
    loadChat: async () => (await getDirectorProduction(p.id)).director?.claude,
    saveChat: async (fn) => {
      await updateProduction(p.id, (x) => {
        if (x.director) x.director.claude = fn(x.director.claude);
      });
    },
    usage: { tool: 'text-to-video', description: `Claude director · "${p.nombre}"` },
    lostSessionNote: '(La conversación anterior se perdió: empieza mirando el proyecto con ver_proyecto.)',
  };
}

export function directorTurnKey(id: string): string {
  return key(id);
}

export function isDirectorTurnActive(id: string): boolean {
  return isAgentTurnActive(key(id));
}

export function stopDirectorTurn(id: string): boolean {
  return stopAgentTurn(key(id));
}

export async function sendToDirector(id: string, mensaje: string, appUrl: string, opts: { mostrar?: string } = {}) {
  const p = await getDirectorProduction(id);
  try {
    return await startAgentTurn(specFor(p), mensaje, appUrl, opts);
  } catch (err) {
    if (err instanceof AgentBusyError) throw new ProductionError('Claude ya está trabajando en este proyecto. Espera o detenlo.', 409);
    if (err instanceof Error && !(err instanceof ProductionError)) throw new ProductionError(err.message, 400);
    throw err;
  }
}

/**
 * Primer pase (modo "Claude · mi suscripción"): al crear el proyecto, Claude lo arma desde la idea.
 * Pregunta solo lo imprescindible; si no, deja ajustes, guion y prompts listos para revisar.
 */
export async function startDirectorFirstPass(id: string, appUrl = defaultAppUrl()): Promise<void> {
  const p = await getDirectorProduction(id);
  const d = p.director!;
  const entrada =
    d.entrada.tipo === 'pdf'
      ? `un PDF (${d.entrada.pdfNombre ?? d.entrada.pdf ?? 'entrada.pdf'})${d.entrada.texto ? ` y esta nota: «${d.entrada.texto}»` : ''}`
      : d.entrada.tipo === 'guion'
        ? `un guion${d.entrada.mantenerPalabras ? ' que NO se puede cambiar palabra por palabra' : ''}: «${d.entrada.texto}»`
        : `esta idea: «${d.entrada.texto}»`;
  const instrucciones = `Proyecto nuevo. La persona empezó con ${entrada}. Mira el proyecto (y las referencias si las sube), y arma el video desde el principio siguiendo "CÓMO GUIAR": pregunta solo si falta algo imprescindible; si no, deja ajustes aprobados, guion y prompts listos para que los revise en el lienzo.`;
  const mostrar = d.entrada.tipo === 'pdf' ? `Te paso este PDF${d.entrada.texto ? `: ${d.entrada.texto}` : ''}` : d.entrada.texto;
  await sendToDirector(id, instrucciones, appUrl, { mostrar: mostrar || 'Arma mi video' });
}

export async function resetDirectorChat(id: string): Promise<void> {
  const p = await getDirectorProduction(id);
  try {
    await resetAgentChat(specFor(p));
  } catch (err) {
    if (err instanceof AgentBusyError) throw new ProductionError(err.message, 409);
    throw err;
  }
}
