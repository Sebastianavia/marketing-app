import { z } from 'zod';
import { VOICE_MODES, getBrollModel } from '@/config/broll-models';
import { getDirectorSkill } from '@/config/director-skills';
import { brollModelsFor } from './durations';
import { TAG_KINDS, findTag, sceneRefs, sceneTags } from './mentions';
import { ACTIVE_ORDER, STAGES, previousApproved, promptIsStale } from './stages';
import type { ActiveStageId, DirectorScene, DirectorState } from './types';

/**
 * Chat libre del Director (v2, paso 2). La IA responde con el contexto de la producción y, si la persona
 * pide un cambio, PROPONE una acción del motor. El código (no la IA) decide si se ejecuta sola o pide un clic:
 *   - $0 que toca una sola pieza o rellena algo vacío → se hace sola;
 *   - $0 que pisa mucho (rehacer todo el guion, ajustes que dejan el guion viejo…) → botón Hacerlo / No;
 *   - aprobar una etapa → siempre botón;
 *   - de pago (transcribir con ElevenLabs) → botón con precio.
 * Funciones puras salvo el esquema: el motor (engine.ts) hace la llamada.
 */

export const CHAT_ACTIONS = [
  'ninguna',
  'rehacer_escena',
  'rehacer_prompt',
  'generar_preguntas',
  'saltar_preguntas',
  'cambiar_ajustes',
  'generar_guion',
  'generar_prompts',
  'aprobar',
  'renombrar_etiqueta',
  'proponer_etiquetas',
  'transcribir_locucion',
] as const;

export type ChatActionKind = (typeof CHAT_ACTIONS)[number];

/** Respuesta fija de la IA (plana, con opcionales: la entienden igual Gemini y Claude). */
export const ChatReplySchema = z.object({
  respuesta: z.string().describe('Lo que le dices a la persona, en español, máximo 4 frases'),
  accion: z.object({
    tipo: z.enum(CHAT_ACTIONS).describe("Acción propuesta; 'ninguna' si solo es una pregunta"),
    escena: z.number().optional().describe('Número de escena (rehacer_escena, rehacer_prompt)'),
    indicacion: z.string().optional().describe('El pedido concreto, en palabras de la persona'),
    etapa: z.enum(['preguntas', 'ajustes', 'guion', 'prompts']).optional().describe('Solo para aprobar'),
    formato: z.enum(['9:16', '16:9', '1:1']).optional(),
    duracionSeg: z.number().optional().describe('Duración total del video en segundos'),
    modoVoz: z.enum(['voiceover', 'native', 'avatar']).optional(),
    soloFaltantes: z.boolean().optional().describe('generar_prompts: solo los que faltan o están desactualizados'),
    etiqueta: z.string().optional().describe('Mención sin @ de la etiqueta (renombrar_etiqueta)'),
    nuevoNombre: z.string().optional(),
    motor: z.enum(['gemini', 'elevenlabs']).optional().describe('transcribir_locucion'),
  }),
});

export type ChatReply = z.infer<typeof ChatReplySchema>;

/** Lo que manda la interfaz. */
export const ChatBody = z.object({
  mensaje: z.string().trim().min(1, 'Escribe un mensaje.').max(2000),
  historial: z
    .array(z.object({ rol: z.enum(['agente', 'tu']), texto: z.string().max(2000) }))
    .max(12)
    .default([]),
  /** Nodo del lienzo enfocado (p. ej. 'escena:e2'). */
  enfoque: z.string().max(60).nullable().optional(),
});

export type ChatInput = z.infer<typeof ChatBody>;

export type ActionBodyOut = Record<string, unknown> & { accion: string };

export interface ChatPlan {
  body: ActionBodyOut;
  ejecucion: 'auto' | 'confirmar';
  /** Qué se hará, para el botón o la nota del chat. */
  resumen: string;
  /** Texto del botón de confirmar. */
  boton: string;
  /** Costo a mostrar: '$0', '< 1 ¢', '≈ $0.004'… */
  costo: string;
}

export type PlanResult = { plan: ChatPlan; motivo?: undefined } | { plan: null; motivo?: string };

// ---------------------------------------------------------------------------
// Contexto e instrucciones
// ---------------------------------------------------------------------------

const STAGE_NAME = Object.fromEntries(STAGES.map((s) => [s.id, s.nombre]));
const STATE_ES: Record<string, string> = {
  bloqueada: 'bloqueada',
  pendiente: 'pendiente',
  por_revisar: 'por revisar',
  aprobada: 'aprobada',
  desactualizada: 'desactualizada',
  error: 'con error',
};

function sceneLine(d: DirectorState, s: DirectorScene): string {
  const prompt = !s.prompt ? 'sin prompt' : promptIsStale(s, d) ? 'prompt desactualizado' : 'prompt al día';
  const tags = sceneTags(d, s).map((t) => `@${t.mencion}`);
  const own = sceneRefs(d, s.id).length;
  return `${s.orden}. [${s.inicio.toFixed(1)}–${s.fin.toFixed(1)} s, ${s.duracionSeg} s] ${s.tipo === 'avatar' ? 'persona habla' : 'toma de apoyo'} · Se ve: ${s.queSeVe} · Dice: "${s.dialogo}" · ${prompt}${tags.length ? ` · usa ${tags.join(', ')}` : ''}${own ? ` · ${own} referencia(s) propias` : ''}`;
}

/** Resumen de la producción para la IA. */
export function chatContext(d: DirectorState, nombre: string): string {
  const skill = getDirectorSkill(d.skill);
  const a = d.ajustes;
  const parts: string[] = [];
  parts.push(`PROYECTO «${nombre}»${skill ? ` · plantilla ${skill.nombre}` : ''}${d.confidencial ? ' · confidencial' : ''}`);
  parts.push(`ETAPAS: ${ACTIVE_ORDER.map((s) => `${STAGE_NAME[s]}: ${STATE_ES[d.etapas[s].estado]}`).join(' · ')}. Imágenes iniciales, clips y video final llegan en fases posteriores (todavía no se generan).`);
  const e = d.entrada;
  const kind = e.tipo === 'guion' ? `GUION PEGADO${e.mantenerPalabras ? ' (mantener sus palabras)' : ''}` : e.tipo === 'idea' ? 'IDEA' : 'INDICACIONES SOBRE EL PDF';
  if (e.texto.trim()) parts.push(`${kind}:\n${e.texto.trim().slice(0, 3000)}`);
  if (e.tipo === 'pdf' || (d.referencias ?? []).some((r) => r.medio === 'pdf')) parts.push('MATERIAL: los PDF adjuntos.');
  if (d.preguntas.length) parts.push(`PREGUNTAS DE DIRECCIÓN:\n${d.preguntas.map((q) => `- ${q.pregunta} → ${q.respuesta ?? '(sin responder)'}`).join('\n')}`);
  else parts.push('PREGUNTAS DE DIRECCIÓN: ninguna todavía.');
  parts.push(
    `AJUSTES: ${a.formato} · ${a.duracionSeg} s · ${VOICE_MODES.find((v) => v.id === a.modoVoz)?.label} · modelo ${getBrollModel(a.modeloBroll).name}${a.avatarNombre ? ` · avatar «${a.avatarNombre}»` : ''} · presupuesto $${a.presupuestoUSD}`
  );
  const escenas = d.guion?.escenas ?? [];
  if (escenas.length) {
    parts.push(`GUION «${d.guion!.titulo}» (${escenas.length} escenas):\n${escenas.map((s) => sceneLine(d, s)).join('\n')}`);
    const withPrompt = escenas.filter((s) => s.prompt);
    if (withPrompt.length) parts.push(`PROMPTS DE VIDEO:\n${withPrompt.map((s) => `${s.orden}. ${s.prompt!.texto.slice(0, 300)}`).join('\n')}`);
  } else parts.push('GUION: todavía no hay.');
  const tags = d.etiquetas ?? [];
  const refs = d.referencias ?? [];
  if (tags.length || refs.length) {
    const tagLines = tags.map((t) => {
      const k = TAG_KINDS.find((x) => x.id === t.tipo)!.label.toLowerCase();
      const n = refs.filter((r) => r.etiquetaId === t.id).length;
      return `- @${t.mencion} (${k}${t.confirmada ? '' : ', propuesta sin confirmar'}${t.avatarNombre ? `, avatar «${t.avatarNombre}»` : ''}, ${n} archivo(s)): ${t.descripcion || 'sin descripción'}`;
    });
    const loose = refs.filter((r) => !r.etiquetaId);
    parts.push(
      `REFERENCIAS (${refs.length} archivos):\n${tagLines.join('\n')}${loose.length ? `\n- Sin etiqueta: ${loose.map((r) => `${r.nombreOriginal} (${r.medio})`).join(', ')}` : ''}`
    );
  }
  const loc = d.locucion;
  if (loc) {
    const t = loc.transcripcion;
    parts.push(
      `LOCUCIÓN PROPIA: ${loc.duracionSeg.toFixed(1)} s${loc.usarComoVoz ? ', se usará como voz en off' : ''}. ${
        t ? `Transcrita con ${t.motor} (${t.frases.length} frases).` : 'Todavía sin transcribir.'
      }`
    );
  }
  return parts.join('\n\n');
}

function focusText(d: DirectorState, enfoque?: string | null): string {
  if (!enfoque) return 'ENFOQUE: ninguno (la persona habla del proyecto en general).';
  const [kind, ref] = enfoque.split(':');
  const s = d.guion?.escenas.find((x) => x.id === ref);
  if (kind === 'escena' && s) return `ENFOQUE: la persona tiene seleccionada la ESCENA ${s.orden}. Si pide un cambio sin decir dónde, es sobre esa escena.`;
  if (kind === 'prompt' && s) return `ENFOQUE: la persona tiene seleccionado el PROMPT de la escena ${s.orden}. Si pide un cambio sin decir dónde, es sobre ese prompt.`;
  if (kind === 'etiqueta') {
    const t = d.etiquetas?.find((x) => x.id === ref);
    if (t) return `ENFOQUE: la etiqueta @${t.mencion}.`;
  }
  if (kind === 'idea') return 'ENFOQUE: la idea.';
  if (kind === 'direccion') return 'ENFOQUE: preguntas y ajustes.';
  return 'ENFOQUE: ninguno.';
}

const ACTIONS_HELP = `ACCIONES QUE PUEDES PROPONER (campo accion.tipo):
- ninguna: solo respondes (dudas, consejos, explicar algo).
- rehacer_escena (escena, indicacion): reescribe solo esa escena del guion.
- rehacer_prompt (escena, indicacion): reescribe solo el prompt de video de esa escena.
- generar_preguntas: pide las 2 preguntas de dirección. saltar_preguntas: seguir sin ellas.
- cambiar_ajustes (formato, duracionSeg, modoVoz): voiceover = voz en off; native = los personajes hablan (voz del modelo); avatar = presentador HeyGen.
- generar_guion (indicacion opcional): escribe o rehace TODO el guion.
- generar_prompts (soloFaltantes): escribe los prompts de video.
- aprobar (etapa): aprobar preguntas, ajustes, guion o prompts (la persona confirma con un botón).
- renombrar_etiqueta (etiqueta, nuevoNombre).
- proponer_etiquetas: mirar las fotos sin etiqueta y proponer personajes, lugares, productos o estilo.
- transcribir_locucion (motor 'gemini' gratis aproximado o 'elevenlabs' preciso de pago): transcribe la locución propia.`;

export function chatPrompt(d: DirectorState, nombre: string, input: ChatInput) {
  const history = input.historial
    .slice(-12)
    .map((m) => `${m.rol === 'tu' ? 'PERSONA' : 'DIRECTOR'}: ${m.texto.slice(0, 600)}`)
    .join('\n');
  return {
    system: `Eres el Director: el asistente que guía a la persona en su video de marketing corto (TikTok, Reels, Shorts) dentro de Lulo Studio.
Respondes en español neutro, breve (máximo 4 frases), claro y sin tecnicismos.
Puedes resolver dudas sobre el proyecto y sobre cómo usar el modo Director; si la persona pide un CAMBIO, propones UNA acción.
No inventes datos, precios ni promesas que no estén en el material.`,
    prompt: `${chatContext(d, nombre)}

${focusText(d, input.enfoque)}

${ACTIONS_HELP}

REGLAS:
- Solo acciones de la lista. Si pide algo que todavía no existe (imágenes, clips, música, video final), explícalo y usa 'ninguna'.
- Si el pedido es sobre una escena, pon su número en "escena".
- "indicacion": el pedido concreto en palabras de la persona (p. ej. «de noche, luz de lámparas»). Puedes nombrar etiquetas con su @.
- En "respuesta" di en una frase qué vas a hacer (p. ej. «Rehago la escena 2 de noche; las demás no cambian.»). No digas que ya está hecho.
- Si la etapa necesaria no está lista (p. ej. rehacer una escena sin guion), explica qué falta y usa 'ninguna'.
${history ? `\nCONVERSACIÓN RECIENTE:\n${history}\n` : ''}
MENSAJE DE LA PERSONA:
${input.mensaje}`,
  };
}

// ---------------------------------------------------------------------------
// De la propuesta a una acción del motor (lo decide el código)
// ---------------------------------------------------------------------------

const STAGE_FOR: Partial<Record<ChatActionKind, ActiveStageId>> = {
  rehacer_escena: 'guion',
  rehacer_prompt: 'prompts',
  generar_preguntas: 'preguntas',
  saltar_preguntas: 'preguntas',
  cambiar_ajustes: 'ajustes',
  generar_guion: 'guion',
  generar_prompts: 'prompts',
};

const MISSING: Record<ActiveStageId, string> = {
  idea: 'la idea',
  preguntas: 'las preguntas de dirección (respóndelas o sáltalas)',
  ajustes: 'los ajustes',
  guion: 'el guion',
  prompts: 'los prompts',
};

export interface PlanOptions {
  /** Etiqueta de costo del texto: '$0' con Gemini gratis, '< 1 ¢' con Claude. */
  textCost: string;
  /** Costo de transcribir con ElevenLabs, si hay locución (texto ya formateado). */
  elevenCost?: string;
  /** Nodo enfocado, por si la IA no dijo la escena. */
  enfoque?: string | null;
}

function sceneFor(d: DirectorState, n: number | undefined, enfoque?: string | null): DirectorScene | undefined {
  const escenas = d.guion?.escenas ?? [];
  if (n !== undefined) return escenas.find((s) => s.orden === Math.round(n));
  const ref = enfoque?.split(':')[1];
  return escenas.find((s) => s.id === ref);
}

const auto = (body: ActionBodyOut, resumen: string, costo: string): PlanResult => ({ plan: { body, ejecucion: 'auto', resumen, boton: resumen, costo } });
const ask = (body: ActionBodyOut, resumen: string, boton: string, costo: string): PlanResult => ({ plan: { body, ejecucion: 'confirmar', resumen, boton, costo } });

export function planChatAction(d: DirectorState, a: ChatReply['accion'], o: PlanOptions): PlanResult {
  const kind = a.tipo;
  if (kind === 'ninguna') return { plan: null };
  const needs = STAGE_FOR[kind];
  if (needs && !previousApproved(d, needs)) {
    const falta = ACTIVE_ORDER.slice(0, ACTIVE_ORDER.indexOf(needs)).find((s) => d.etapas[s].estado !== 'aprobada')!;
    return { plan: null, motivo: `Para eso primero hay que aprobar ${MISSING[falta]}.` };
  }
  const indicacion = (a.indicacion ?? '').trim().slice(0, 1000);
  const hasScript = Boolean(d.guion?.escenas.length);

  switch (kind) {
    case 'rehacer_escena':
    case 'rehacer_prompt': {
      const s = sceneFor(d, a.escena, o.enfoque);
      if (!s) return { plan: null, motivo: hasScript ? 'No encuentro esa escena.' : 'Todavía no hay guion.' };
      const isScene = kind === 'rehacer_escena';
      return auto({ accion: kind, escenaId: s.id, indicacion }, `${isScene ? 'Rehacer la escena' : 'Rehacer el prompt'} ${s.orden}${indicacion ? `: «${indicacion}»` : ''}`, o.textCost);
    }
    case 'generar_preguntas': {
      const body = { accion: 'generar_preguntas' };
      return d.preguntas.length || hasScript
        ? ask(body, 'Pedir preguntas nuevas (lo que viene después quedará desactualizado)', 'Pedir preguntas nuevas', o.textCost)
        : auto(body, 'Pedir las preguntas de dirección', o.textCost);
    }
    case 'saltar_preguntas': {
      const body = { accion: 'saltar_preguntas' };
      return hasScript ? ask(body, 'Seguir sin preguntas (el guion quedará desactualizado)', 'Saltar las preguntas', '$0') : auto(body, 'Seguir sin preguntas', '$0');
    }
    case 'cambiar_ajustes': {
      const cur = d.ajustes;
      const formato = a.formato ?? cur.formato;
      const modoVoz = a.modoVoz ?? cur.modoVoz;
      const duracionSeg = a.duracionSeg !== undefined ? Math.min(180, Math.max(5, Math.round(a.duracionSeg))) : cur.duracionSeg;
      if (d.locucion?.usarComoVoz && a.duracionSeg !== undefined && duracionSeg !== Math.round(d.locucion.duracionSeg)) {
        return { plan: null, motivo: 'La duración la fija tu locución. Quita la locución si quieres otra duración.' };
      }
      const models = brollModelsFor(modoVoz, formato);
      if (!models.length) return { plan: null, motivo: 'Ningún modelo de video admite esa combinación de formato y voz.' };
      const modeloBroll = models.some((m) => m.id === cur.modeloBroll) ? cur.modeloBroll : models[0].id;
      const changes: string[] = [];
      if (formato !== cur.formato) changes.push(`formato ${formato}`);
      if (duracionSeg !== cur.duracionSeg) changes.push(`${duracionSeg} s`);
      if (modoVoz !== cur.modoVoz) changes.push(VOICE_MODES.find((v) => v.id === modoVoz)?.label ?? modoVoz);
      if (modeloBroll !== cur.modeloBroll) changes.push(`modelo ${getBrollModel(modeloBroll).name}`);
      if (!changes.length) return { plan: null, motivo: 'Los ajustes ya son esos.' };
      const body = {
        accion: 'guardar_ajustes',
        ajustes: { formato, duracionSeg, modoVoz, modeloBroll, avatarId: cur.avatarId, presupuestoUSD: cur.presupuestoUSD },
      };
      const resumen = `Cambiar ajustes: ${changes.join(', ')}`;
      const content = formato !== cur.formato || duracionSeg !== cur.duracionSeg || modoVoz !== cur.modoVoz;
      return hasScript && content ? ask(body, `${resumen} (el guion quedará desactualizado)`, 'Cambiar ajustes', '$0') : auto(body, resumen, '$0');
    }
    case 'generar_guion': {
      const body = { accion: 'generar_guion', ...(indicacion ? { indicacion } : {}) };
      return hasScript
        ? ask(body, `Rehacer todo el guion${indicacion ? `: «${indicacion}»` : ''} (los prompts quedarán desactualizados)`, 'Rehacer el guion', o.textCost)
        : auto(body, `Escribir el guion${indicacion ? `: «${indicacion}»` : ''}`, o.textCost);
    }
    case 'generar_prompts': {
      const escenas = d.guion?.escenas ?? [];
      const stale = escenas.filter((s) => promptIsStale(s, d));
      const any = escenas.some((s) => s.prompt);
      if (a.soloFaltantes || (any && stale.length && stale.length < escenas.length)) {
        if (!stale.length) return { plan: null, motivo: 'Todos los prompts están al día.' };
        return auto({ accion: 'generar_prompts', soloFaltantes: true }, `Escribir los ${stale.length} prompts que faltan`, o.textCost);
      }
      const body = { accion: 'generar_prompts', soloFaltantes: false };
      return any ? ask(body, 'Rehacer todos los prompts', 'Rehacer los prompts', o.textCost) : auto(body, 'Escribir los prompts', o.textCost);
    }
    case 'aprobar': {
      const etapa = a.etapa;
      if (!etapa) return { plan: null, motivo: '¿Qué etapa quieres aprobar?' };
      if (d.etapas[etapa].estado === 'aprobada') return { plan: null, motivo: `«${STAGE_NAME[etapa]}» ya está aprobada.` };
      return ask({ accion: 'aprobar', etapa }, `Aprobar «${STAGE_NAME[etapa]}»`, `Aprobar ${etapa === 'guion' ? 'el guion' : etapa === 'prompts' ? 'los prompts' : etapa}`, '$0');
    }
    case 'renombrar_etiqueta': {
      const t = a.etiqueta ? findTag(d.etiquetas, a.etiqueta.replace(/^@/, '')) : undefined;
      const nombre = (a.nuevoNombre ?? '').trim().slice(0, 60);
      if (!t || !nombre) return { plan: null, motivo: t ? '¿Qué nombre nuevo le pongo?' : 'No encuentro esa etiqueta.' };
      return auto(
        { accion: 'guardar_etiqueta', etiquetaId: t.id, tipo: t.tipo, nombre, descripcion: t.descripcion, avatarId: t.avatarId ?? null },
        `Renombrar @${t.mencion} a «${nombre}»`,
        '$0'
      );
    }
    case 'proponer_etiquetas': {
      const loose = (d.referencias ?? []).filter((r) => r.medio === 'imagen' && !r.etiquetaId);
      if (!loose.length) return { plan: null, motivo: 'No hay fotos sin etiqueta.' };
      return auto({ accion: 'proponer_etiquetas', refIds: loose.map((r) => r.id) }, `Proponer etiquetas para ${loose.length} foto(s)`, o.textCost);
    }
    case 'transcribir_locucion': {
      if (!d.locucion) return { plan: null, motivo: 'Primero sube tu locución con + Ref y elige «Locución del video».' };
      const motor = a.motor === 'elevenlabs' || d.confidencial ? 'elevenlabs' : 'gemini';
      const body = { accion: 'transcribir_locucion', motor };
      if (motor === 'elevenlabs') {
        return ask(body, `Transcribir con ElevenLabs (preciso, de pago)${d.confidencial ? '; con Confidencial no se usa Gemini' : ''}`, 'Transcribir con ElevenLabs', o.elevenCost ?? 'de pago');
      }
      return d.locucion.transcripcion ? ask(body, 'Volver a transcribir con Gemini (gratis, aproximado)', 'Transcribir de nuevo', '$0') : auto(body, 'Transcribir con Gemini (gratis, aproximado)', '$0');
    }
  }
  return { plan: null };
}
