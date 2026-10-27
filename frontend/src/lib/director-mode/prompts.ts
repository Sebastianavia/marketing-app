import { VOICE_MODES } from '@/config/broll-models';
import { getDirectorSkill } from '@/config/director-skills';
import { durationRules } from './durations';
import type { DirectorScene, DirectorState } from './types';

/**
 * Instrucciones del modo Director y bloques fijos que se pegan en los prompts de video.
 * El bloque de realismo y los 9 síntomas salen del estudio de Buzzy (docs/plan-guion-a-video-buzzy.md)
 * y los reutilizarán las Fases 3 (imágenes) y 4 (clips y revisión).
 */

/** Se añade al final de TODO prompt de imagen y video (va en inglés: los modelos lo siguen mejor). */
export const REALISM_BLOCK =
  'Real-time 1x speed, no slow motion. Handheld camera with natural shake, no gimbal, no dolly. ' +
  'Visible film grain and sensor noise, limited dynamic range, real depth of field (not everything in focus). ' +
  'Only light sources that exist in the location, no rim light, no bloom, no teal-and-orange grade, moderate saturation. ' +
  'Skin with pores, imperfections and asymmetry. Places with wear, clutter and dirt. Slightly off-center framing.';

export const NO_MUSIC = 'No background music.';

/** Lo mismo en español, para la interfaz. */
export const REALISM_SUMMARY_ES =
  'Velocidad real sin cámara lenta · cámara en mano · grano y desenfoque real · solo luces del lugar, sin bloom ni colores saturados · ' +
  'piel con poros e imperfecciones · lugares con desgaste · encuadre algo descentrado · sin música de fondo.';

export const NINE_SYMPTOMS = [
  'cámara lenta falsa',
  'luz de contorno o bloom',
  'piel de plástico',
  'colores saturados',
  'movimientos de cámara perfectos',
  'lugares demasiado limpios',
  'todo enfocado',
  'extras que se repiten',
  'encuadre demasiado centrado',
] as const;

/**
 * Prompt final que recibirá el modelo de video (Fase 4). Las escenas de persona hablando (HeyGen)
 * solo llevan el movimiento: el bloque de realismo es para los modelos que generan la imagen.
 */
export function composeVideoPrompt(scene: DirectorScene, d: Pick<DirectorState, 'ajustes'>): string {
  const base = scene.prompt?.texto.trim() ?? '';
  if (scene.tipo === 'avatar') return base;
  const parts = [base.replace(/\.?\s*$/, '.')];
  if (d.ajustes.modoVoz === 'native' && scene.dialogo.trim()) {
    // Formato de diálogo de la guía de Veo (igual que el modo manual)
    parts.push(`The person speaks in Spanish, facing the camera, and says: "${scene.dialogo.trim()}"`);
  }
  parts.push(REALISM_BLOCK, NO_MUSIC);
  return parts.join(' ');
}

const ROLE = `Eres director creativo de videos de marketing cortos (TikTok, Reels, Shorts) en español neutro.
Trabajas por etapas fijas; en cada una devuelves SOLO lo que pide el formato.
No inventes datos, precios, cifras, testimonios ni promesas que no estén en el material.`;

function voiceModeText(d: DirectorState): string {
  const m = VOICE_MODES.find((v) => v.id === d.ajustes.modoVoz);
  return m ? `${m.label}: ${m.description}` : d.ajustes.modoVoz;
}

function material(d: DirectorState, hasPdf: boolean): string {
  const e = d.entrada;
  const kind = e.tipo === 'guion' ? 'GUION DE LA PERSONA' : e.tipo === 'idea' ? 'IDEA' : 'INDICACIONES SOBRE EL PDF';
  const parts: string[] = [];
  if (e.texto.trim()) parts.push(`${kind}:\n${e.texto.trim()}`);
  if (hasPdf) parts.push('MATERIAL: el PDF adjunto.');
  return parts.join('\n\n') || 'MATERIAL: el PDF adjunto.';
}

function answers(d: DirectorState): string {
  const done = d.preguntas.filter((q) => q.respuesta?.trim());
  if (!done.length) return '';
  return `\nDECISIONES DE DIRECCIÓN:\n${done.map((q) => `- ${q.pregunta} → ${q.respuesta}`).join('\n')}`;
}

function settingsText(d: DirectorState): string {
  const a = d.ajustes;
  return `AJUSTES:
- Formato ${a.formato}, duración total objetivo ${a.duracionSeg} s.
- Modo de voz: ${voiceModeText(d)}
- Duraciones admitidas por escena: ${durationRules(a)}.${a.avatarNombre ? `\n- Persona del video: el avatar «${a.avatarNombre}».` : ''}`;
}

/** Bloque de la plantilla elegida (skill) para cada etapa; vacío si no hay. */
function skillBlock(d: DirectorState, part: 'preguntas' | 'guion' | 'prompts'): string {
  const s = getDirectorSkill(d.skill);
  if (!s) return '';
  const text = part === 'preguntas' ? `Pregunta sobre ${s.preguntasSobre}` : part === 'guion' ? s.formaGuion : s.notaPrompts;
  return `
TIPO DE VIDEO: ${s.nombre}. ${text}
`;
}

// ---------- Etapa 2: preguntas ----------

export function questionsPrompt(d: DirectorState, hasPdf: boolean) {
  return {
    system: ROLE,
    prompt: `Antes de escribir el guion, haz exactamente 2 preguntas de dirección a la persona, cada una con 3 opciones cortas y distintas.
- Solo decisiones que cambian el video: enfoque o ángulo, tono, a quién le habla, gancho de apertura, llamado a la acción.
- No preguntes por formato, duración, voz ni presupuesto (se eligen en otro paso).
- Opciones concretas, de 2 a 8 palabras, basadas en el material.
${skillBlock(d, 'preguntas')}
${material(d, hasPdf)}`,
  };
}

// ---------- Etapa 5: guion ----------

function sceneRules(d: DirectorState): string {
  const mode = d.ajustes.modoVoz;
  const typeRule =
    mode === 'avatar'
      ? `- tipo 'avatar' = la persona habla a cámara (HeyGen, con su voz). tipo 'broll' = toma de apoyo sin nadie hablando a cámara.
- La primera y la última escena son 'avatar'. Alterna con 'broll' para mostrar lo que se cuenta.`
      : mode === 'native'
      ? `- TODAS las escenas son 'broll'. En cada una una persona dice el diálogo a cámara (el modelo de video genera su voz).
- Describe SIEMPRE a la misma persona con los mismos rasgos y ropa en "queSeVe".
- Cada diálogo debe poder decirse en la duración de su escena (unos 15 caracteres por segundo).`
      : `- TODAS las escenas son 'broll': nadie habla a cámara. El diálogo es la voz en off que suena encima.`;
  return `REGLAS DE LAS ESCENAS:
${typeRule}
- duracionSeg: elige SOLO entre las duraciones admitidas. La suma debe acercarse a la duración objetivo.
- queSeVe: una sola toma concreta y filmable (sujeto, acción, lugar, plano). Sin texto en pantalla ni logotipos inventados.
- dialogo: el texto exacto que se dice en la escena (puede estar vacío si la escena es solo imagen).
- Cada escena empieza ya en su propio lugar (no repitas el mismo encuadre de arranque).
- No uses etiquetas entre corchetes.`;
}

export function scriptPrompt(d: DirectorState, hasPdf: boolean) {
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const task = keep
    ? `Divide el GUION DE LA PERSONA en escenas consecutivas. Usa el texto EXACTO: no cambies, quites ni añadas palabras (solo puntuación y mayúsculas). La unión de todos los diálogos, en orden, debe ser el guion completo.`
    : `Escribe el guion por escenas de un video de unos ${d.ajustes.duracionSeg} segundos (aprox. ${Math.round(d.ajustes.duracionSeg * 15)} caracteres de diálogo en total), basado SOLO en el material.`;
  return {
    system: ROLE,
    prompt: `${task}
${skillBlock(d, 'guion')}
${settingsText(d)}
${answers(d)}

${sceneRules(d)}

${material(d, hasPdf)}`,
  };
}

function scriptSummary(scenes: DirectorScene[]): string {
  return scenes
    .map((s) => `${s.orden}. [${s.inicio.toFixed(1)}s-${s.fin.toFixed(1)}s] ${s.tipo} · Se ve: ${s.queSeVe} · Dice: "${s.dialogo}"`)
    .join('\n');
}

export function redoScenePrompt(d: DirectorState, scene: DirectorScene, indicacion: string, hasPdf: boolean) {
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  return {
    system: ROLE,
    prompt: `Reescribe SOLO la escena ${scene.orden} de este guion. Las demás escenas no cambian: la nueva debe encajar entre la anterior y la siguiente.
${keep ? `- El diálogo debe tener EXACTAMENTE las mismas palabras que ahora: "${scene.dialogo}". Solo puedes cambiar "queSeVe", la duración y la puntuación.` : ''}
${indicacion.trim() ? `- Pedido de la persona: ${indicacion.trim()}` : '- Propón una versión distinta y mejor que la actual.'}
${d.ajustes.modoVoz === 'avatar' ? '' : "- El tipo debe ser 'broll'."}
${skillBlock(d, 'guion')}
${settingsText(d)}
${answers(d)}

${sceneRules(d)}

GUION ACTUAL:
${scriptSummary(d.guion?.escenas ?? [])}

${material(d, hasPdf)}`,
  };
}

// ---------- Etapa 8: prompts ----------

const PROMPT_RULES = `REGLAS DE LOS PROMPTS (en inglés, porque los modelos de video lo siguen mejor):
- Escenas 'broll': un solo plano concreto y filmable: sujeto, acción, lugar, plano y movimiento de cámara sencillo, 40 a 80 palabras.
  No escribas el diálogo ni pidas texto en pantalla, música o subtítulos. No describas estilo de luz ni color: eso lo añade el sistema.
  Si sale una persona, describe sus rasgos, edad aproximada y ropa igual en todas las escenas.
- Escenas 'avatar' (HeyGen, la persona ya habla con su voz): solo movimiento del cuerpo y gestos naturales mientras habla, 10 a 25 palabras.`;

export function promptsPrompt(d: DirectorState, scenes: DirectorScene[]) {
  return {
    system: ROLE,
    prompt: `Escribe el prompt de video de cada escena indicada.

${PROMPT_RULES}
${skillBlock(d, 'prompts')}
${settingsText(d)}

GUION COMPLETO (para mantener la continuidad):
${scriptSummary(d.guion?.escenas ?? [])}

ESCRIBE LOS PROMPTS DE LAS ESCENAS: ${scenes.map((s) => s.orden).join(', ')}`,
  };
}

export function redoPromptPrompt(d: DirectorState, scene: DirectorScene, indicacion: string) {
  return {
    system: ROLE,
    prompt: `Reescribe el prompt de video de la escena ${scene.orden}.
${indicacion.trim() ? `Pedido de la persona: ${indicacion.trim()}` : 'Propón una versión distinta y mejor.'}
${scene.prompt ? `Prompt actual: ${scene.prompt.texto}` : ''}

${PROMPT_RULES}
${skillBlock(d, 'prompts')}
${settingsText(d)}

GUION COMPLETO:
${scriptSummary(d.guion?.escenas ?? [])}`,
  };
}
