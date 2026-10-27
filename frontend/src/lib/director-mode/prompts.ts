import { VOICE_MODES } from '@/config/broll-models';
import { getDirectorSkill } from '@/config/director-skills';
import { durationRules } from './durations';
import { TAG_KINDS, sceneTags } from './mentions';
import type { DirectorScene, DirectorState, DirectorTag } from './types';

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
  if (hasPdf) parts.push('MATERIAL: los PDF adjuntos.');
  return parts.join('\n\n') || 'MATERIAL: los PDF adjuntos.';
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

/** Etiquetas visuales (las de voz y música no salen en imagen). */
function visualTags(d: DirectorState): DirectorTag[] {
  return (d.etiquetas ?? []).filter((t) => t.tipo !== 'voz' && t.tipo !== 'musica');
}

function tagLine(t: DirectorTag): string {
  const kind = TAG_KINDS.find((k) => k.id === t.tipo)?.label.toLowerCase() ?? t.tipo;
  return `- @${t.mencion} (${kind}${t.nombre !== t.mencion ? `, «${t.nombre}»` : ''}): ${t.descripcion.trim() || 'sin descripción'}`;
}

/** Referencias del proyecto (etiquetas con fotos) para cada etapa; vacío si no hay. */
function tagsBlock(d: DirectorState, part: 'preguntas' | 'guion' | 'prompts'): string {
  const tags = visualTags(d);
  if (!tags.length) return '';
  const list = tags.map(tagLine).join('\n');
  if (part === 'guion') {
    return `
REFERENCIAS DEL PROYECTO (personajes, lugares, productos y estilo, con fotos):
${list}
- Cuando en una escena aparezca algo de esta lista, nómbralo en "queSeVe" con su @ exacto (p. ej. «@${tags[0].mencion} …»).
- No inventes @ nuevos y nunca pongas @ en el diálogo.
`;
  }
  if (part === 'prompts') {
    return `
REFERENCIAS DEL PROYECTO (el sistema usará sus fotos para mantener el mismo aspecto en todas las escenas):
${list}
- En el prompt (en inglés) NO escribas '@': describe a cada persona, lugar o producto con su descripción, igual en todas las escenas.
- Las de tipo estilo solo marcan el look (color, luz, encuadre), nunca el contenido.
`;
  }
  return `
REFERENCIAS QUE SUBIÓ LA PERSONA:
${list}
`;
}

/** Qué etiquetas usa cada escena (las que nombra con @ y las subidas solo para ella). */
function sceneTagsText(d: DirectorState, scenes: DirectorScene[]): string {
  const lines = scenes
    .map((s) => ({ s, tags: sceneTags(d, s).filter((t) => t.tipo !== 'voz' && t.tipo !== 'musica') }))
    .filter((x) => x.tags.length)
    .map((x) => `- Escena ${x.s.orden}: ${x.tags.map((t) => `@${t.mencion}`).join(', ')}`);
  return lines.length ? `\nREFERENCIAS POR ESCENA:\n${lines.join('\n')}\n` : '';
}

// ---------- Etapa 2: preguntas ----------

export function questionsPrompt(d: DirectorState, hasPdf: boolean) {
  return {
    system: ROLE,
    prompt: `Antes de escribir el guion, haz exactamente 2 preguntas de dirección a la persona, cada una con 3 opciones cortas y distintas.
- Solo decisiones que cambian el video: enfoque o ángulo, tono, a quién le habla, gancho de apertura, llamado a la acción.
- No preguntes por formato, duración, voz ni presupuesto (se eligen en otro paso).
- Opciones concretas, de 2 a 8 palabras, basadas en el material.
${skillBlock(d, 'preguntas')}${tagsBlock(d, 'preguntas')}
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

export function scriptPrompt(d: DirectorState, hasPdf: boolean, indicacion = '') {
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  const task = keep
    ? `Divide el GUION DE LA PERSONA en escenas consecutivas. Usa el texto EXACTO: no cambies, quites ni añadas palabras (solo puntuación y mayúsculas). La unión de todos los diálogos, en orden, debe ser el guion completo.`
    : `Escribe el guion por escenas de un video de unos ${d.ajustes.duracionSeg} segundos (aprox. ${Math.round(d.ajustes.duracionSeg * 15)} caracteres de diálogo en total), basado SOLO en el material.`;
  return {
    system: ROLE,
    prompt: `${task}${indicacion.trim() ? `\n- Pedido de la persona para este guion: ${indicacion.trim()}` : ''}
${skillBlock(d, 'guion')}${tagsBlock(d, 'guion')}
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

export function redoScenePrompt(d: DirectorState, scene: DirectorScene, indicacion: string, hasPdf: boolean, aligned = false) {
  const keep = d.entrada.tipo === 'guion' && d.entrada.mantenerPalabras;
  return {
    system: ROLE,
    prompt: `Reescribe SOLO la escena ${scene.orden} de este guion. Las demás escenas no cambian: la nueva debe encajar entre la anterior y la siguiente.
${
  aligned
    ? `- La escena sigue la locución de la persona: el diálogo ("${scene.dialogo}") y la duración (${scene.duracionSeg} s) NO cambian. Cambia solo "queSeVe" (y el tipo si hace falta); devuelve el mismo diálogo y la misma duración.`
    : keep
    ? `- El diálogo debe tener EXACTAMENTE las mismas palabras que ahora: "${scene.dialogo}". Solo puedes cambiar "queSeVe", la duración y la puntuación.`
    : ''
}
${indicacion.trim() ? `- Pedido de la persona: ${indicacion.trim()}` : '- Propón una versión distinta y mejor que la actual.'}
${d.ajustes.modoVoz === 'avatar' ? '' : "- El tipo debe ser 'broll'."}
${skillBlock(d, 'guion')}${tagsBlock(d, 'guion')}${sceneTagsText(d, [scene])}
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
${skillBlock(d, 'prompts')}${tagsBlock(d, 'prompts')}${sceneTagsText(d, scenes)}
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
${skillBlock(d, 'prompts')}${tagsBlock(d, 'prompts')}${sceneTagsText(d, [scene])}
${settingsText(d)}

GUION COMPLETO:
${scriptSummary(d.guion?.escenas ?? [])}`,
  };
}

// ---------- Locución propia: transcribir y repartir en escenas ----------

export function transcriptionPrompt(totalSeg: number) {
  return {
    system: 'Eres un transcriptor profesional. Devuelves solo lo que pide el formato.',
    prompt: `Transcribe EXACTAMENTE lo que se dice en este audio (dura ${totalSeg.toFixed(1)} s), en su idioma, sin resumir, corregir ni traducir.
Divide la transcripción en frases cortas, de unos 2 a 6 segundos cada una, cortando en pausas naturales.
Para cada frase da "inicio" y "fin" en SEGUNDOS desde el comienzo del audio (con decimales), lo más precisos que puedas.
Las frases van en orden, no se solapan y no pasan de ${totalSeg.toFixed(1)} s. No incluyas ruidos ni música.`,
  };
}

export function alignedScriptPrompt(d: DirectorState, frases: Array<{ texto: string; inicio: number; fin: number }>, maxBrollSeg: number, indicacion = '', hasPdf = false) {
  const lista = frases.map((f, i) => `${i + 1}. [${f.inicio.toFixed(1)}–${f.fin.toFixed(1)} s] ${f.texto}`).join('\n');
  const mode = d.ajustes.modoVoz;
  const typeRule =
    mode === 'avatar'
      ? `- tipo 'avatar' = la persona habla a cámara con este audio (HeyGen); 'broll' = toma de apoyo. La primera y la última escena son 'avatar'.`
      : `- TODAS las escenas son 'broll': nadie habla a cámara; el audio suena encima.`;
  return {
    system: ROLE,
    prompt: `La persona grabó su locución. Reparte sus frases en escenas de video: cada escena toma frases CONSECUTIVAS (desde, hasta, ambos incluidos) y dice qué se ve mientras suenan.${indicacion.trim() ? `\n- Pedido de la persona: ${indicacion.trim()}` : ''}
${skillBlock(d, 'guion')}${tagsBlock(d, 'guion')}
REGLAS:
- Cubre TODAS las frases, en orden, sin huecos ni repeticiones: la primera escena empieza en la frase 1 y la última termina en la frase ${frases.length}.
- Cada toma de apoyo ('broll') debe durar como máximo ${maxBrollSeg} s (suma de sus frases). Cambia de escena cuando cambia la idea.
${typeRule}
- queSeVe: una sola toma concreta y filmable (sujeto, acción, lugar, plano) que ilustra lo que se dice. Sin texto en pantalla.
- Cada escena empieza ya en su propio lugar (no repitas el mismo encuadre de arranque).
${answers(d)}

FRASES DE LA LOCUCIÓN:
${lista}

${material(d, hasPdf)}`,
  };
}

// ---------- Referencias: proponer etiquetas (visión) ----------

export function tagProposalPrompt(d: DirectorState, n: number) {
  const existing = visualTags(d);
  const context = d.entrada.texto.trim().slice(0, 600);
  return {
    system: ROLE,
    prompt: `Te paso ${n} ${n === 1 ? 'foto' : 'fotos'} numeradas del 1 al ${n}, en el orden en que van adjuntas. La persona las subió como referencia para su video.
Agrúpalas: las fotos de una misma persona, lugar o producto van juntas en un grupo.
- tipo: personaje (una persona), lugar (un sitio o fondo), producto (un objeto o marca que se muestra), estilo (una imagen que solo sirve por su look: color, luz, encuadre).
- nombre: corto, en español. Personaje: un nombre propio sencillo si no se sabe cuál es (p. ej. «Valentina»). Lugar: «Cocina», «Spa». Producto: su nombre si se lee.
- descripcion: en inglés, 10 a 30 palabras, solo lo visible y estable (edad aproximada, pelo, ropa, rasgos; materiales y luz del lugar; forma y color del producto). Sin juicios.
- Cada foto va en un solo grupo.
${existing.length ? `\nETIQUETAS QUE YA EXISTEN (si una foto es de una de ellas, pon su mención sin @ en "existente"):\n${existing.map(tagLine).join('\n')}\n` : ''}
${context ? `CONTEXTO DEL VIDEO: ${context}` : ''}`,
  };
}
