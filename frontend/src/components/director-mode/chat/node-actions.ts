import { VOICE_MODES, getBrollModel } from '@/config/broll-models';
import { STAGES, currentStage, promptIsStale } from '@/lib/director-mode/stages';
import { tagKindLabel } from '@/lib/director-mode/mentions';
import type { DirectorRef, DirectorScene, DirectorState, DirectorTag } from '@/lib/director-mode/types';
import { parseNodeId } from '../canvas/build-graph';

/**
 * Chat enfocado (paso 1, sin IA nueva): el nodo elegido decide a qué acción del motor va lo que escribes,
 * y el agente narra el resultado leyendo el estado antes y después. Funciones puras.
 */

export interface Focus {
  kind: 'idea' | 'direccion' | 'escena' | 'prompt' | 'guion-pendiente' | 'etiqueta' | 'referencias' | 'locucion' | 'ninguno';
  scene?: DirectorScene;
  tag?: DirectorTag;
  /** Nombre corto para la cabecera del chat. */
  label: string;
}

export function focusOf(d: DirectorState, nodeId: string | null): Focus {
  const p = parseNodeId(nodeId);
  if (!p) return { kind: 'ninguno', label: '' };
  if (p.kind === 'idea') return { kind: 'idea', label: 'Idea' };
  if (p.kind === 'direccion') return { kind: 'direccion', label: 'Dirección' };
  if (p.kind === 'guion-pendiente') return { kind: 'guion-pendiente', label: 'Guion' };
  if (p.kind === 'sueltas' || p.kind === 'referencias') return { kind: 'referencias', label: 'Referencias' };
  if (p.kind === 'locucion') return d.locucion ? { kind: 'locucion', label: 'Tu locución' } : { kind: 'ninguno', label: '' };
  if (p.kind === 'etiqueta') {
    const tag = d.etiquetas?.find((t) => t.id === p.sceneId);
    return tag ? { kind: 'etiqueta', tag, label: `@${tag.mencion}` } : { kind: 'ninguno', label: '' };
  }
  const scene = d.guion?.escenas.find((s) => s.id === p.sceneId);
  if (!scene) return { kind: 'ninguno', label: '' };
  if (p.kind === 'escena') return { kind: 'escena', scene, label: `Escena ${scene.orden}` };
  if (p.kind === 'prompt') return { kind: 'prompt', scene, label: `Prompt ${scene.orden}` };
  return { kind: 'ninguno', label: '' };
}

/**
 * Texto de ayuda de la caja según el enfoque. Todo lo escrito va al chat libre (el Director entiende
 * si es una pregunta o un cambio); el nodo enfocado le dice sobre qué pieza se habla.
 */
export function composerPlaceholder(f: Focus): string {
  if (f.kind === 'escena' && f.scene) return `Cambia la escena ${f.scene.orden} («hazla de noche») o pregúntame algo…`;
  if (f.kind === 'prompt' && f.scene) return `Cambia el prompt ${f.scene.orden} («plano más cerrado») o pregúntame algo…`;
  if (f.kind === 'etiqueta' && f.tag) return `Pregúntame por @${f.tag.mencion} o pide un cambio…`;
  return 'Pregúntame por el proyecto o pide un cambio («haz el video de 20 s»)…';
}

/** Clave de "ocupado" de una acción (la misma que usan los botones de las tarjetas). */
export function busyKeyFor(body: Record<string, unknown> & { accion: string }): string {
  if ((body.accion === 'rehacer_escena' || body.accion === 'rehacer_prompt') && typeof body.escenaId === 'string') return `${body.accion}:${body.escenaId}`;
  if (body.accion === 'guardar_etiqueta' && typeof body.etiquetaId === 'string') return `guardar_etiqueta:${body.etiquetaId}`;
  return body.accion;
}

const STAGE_NAME = Object.fromEntries(STAGES.map((s) => [s.id, s.nombre]));

function costText(d: DirectorState, etapa: 'preguntas' | 'guion' | 'prompts') {
  const st = d.etapas[etapa];
  if (!st.modelo) return '';
  return ` (${st.modelo}, ${st.costoUSD ? `$${st.costoUSD.toFixed(4)}` : '$0'})`;
}

/** Primer mensaje al abrir un borrador sin conversación guardada. */
export function greeting(d: DirectorState, nombre: string): string {
  const cur = currentStage(d);
  const where = cur ? `Vamos en «${STAGE_NAME[cur]}».` : 'Las etapas de texto están aprobadas; las imágenes y los clips llegan en las Fases 3 y 4.';
  return `Abrí «${nombre}». ${where} Pregúntame lo que quieras del proyecto o pídeme un cambio; si tocas una escena o un prompt del lienzo, hablamos de esa pieza.`;
}

/** Lo que dice el agente después de una acción que salió bien. */
export function narrate(accion: string, before: DirectorState, after: DirectorState, body: Record<string, unknown>, aviso?: string): string {
  const refsText = narrateRefs(accion, before, after, body);
  if (refsText) return aviso ? `${refsText} ${aviso}` : refsText;
  const sceneOf = (st: DirectorState) => st.guion?.escenas.find((s) => s.id === body.escenaId);
  let t: string;
  switch (accion) {
    case 'guardar_idea':
      t = 'Guardé la idea. Lo que venía después quedó desactualizado: revísalo o rehazlo.';
      break;
    case 'generar_preguntas':
      t = `Te dejo ${after.preguntas.length} preguntas de dirección${costText(after, 'preguntas')}. Elige una opción o escribe la tuya.`;
      break;
    case 'responder_preguntas':
      t = 'Anotado. Ahora revisa los ajustes: vienen con los valores de la plantilla.';
      break;
    case 'saltar_preguntas':
      t = 'Sin preguntas, entonces. Revisa los ajustes para seguir.';
      break;
    case 'guardar_ajustes': {
      const a = after.ajustes;
      t = `Ajustes guardados: ${a.formato} · ${a.duracionSeg} s · ${VOICE_MODES.find((v) => v.id === a.modoVoz)?.label} · ${getBrollModel(a.modeloBroll).name}.`;
      break;
    }
    case 'generar_guion': {
      const es = after.guion?.escenas ?? [];
      const total = es.reduce((x, s) => x + s.duracionSeg, 0);
      t = `Escribí el guion: ${es.length} escenas, ${total} s (objetivo ${after.ajustes.duracionSeg} s)${costText(after, 'guion')}. Revísalo en el lienzo y apruébalo, o toca una escena para cambiarla.`;
      break;
    }
    case 'rehacer_escena': {
      const s = sceneOf(after);
      const hadPrompt = Boolean(sceneOf(before)?.prompt);
      t = `Rehice la escena ${s?.orden ?? ''}${costText(after, 'guion')}.${hadPrompt ? ' Su prompt quedó desactualizado.' : ''} Las demás escenas no cambiaron.`;
      break;
    }
    case 'editar_escena': {
      const s = sceneOf(after);
      t = `Guardé tus cambios en la escena ${s?.orden ?? ''}.${s?.duracionPedidaSeg !== undefined ? ` El modelo la ajustó a ${s.duracionSeg} s.` : ''}${s && s.prompt && promptIsStale(s, after) ? ' Su prompt quedó desactualizado.' : ''}`;
      break;
    }
    case 'generar_prompts': {
      const n = (after.guion?.escenas ?? []).filter((s, i) => s.prompt?.texto !== before.guion?.escenas[i]?.prompt?.texto).length;
      t = `Escribí ${n} ${n === 1 ? 'prompt' : 'prompts'}${costText(after, 'prompts')}. Al usarlos se añade el bloque de realismo.`;
      break;
    }
    case 'rehacer_prompt':
      t = `Rehice el prompt de la escena ${sceneOf(after)?.orden ?? ''}${costText(after, 'prompts')}.`;
      break;
    case 'editar_prompt':
      t = `Guardé tu prompt de la escena ${sceneOf(after)?.orden ?? ''}.`;
      break;
    case 'aprobar':
      t =
        body.etapa === 'guion'
          ? 'Guion aprobado. Cuando quieras, escribo un prompt por escena.'
          : body.etapa === 'prompts'
          ? 'Prompts aprobados. Hasta aquí llega esta fase: no se ha gastado nada en video.'
          : `Etapa «${STAGE_NAME[String(body.etapa)] ?? body.etapa}» aprobada.`;
      break;
    default:
      t = 'Hecho.';
  }
  return aviso ? `${t} ${aviso}` : t;
}

const refName = (st: DirectorState, id: unknown) => st.referencias?.find((r) => r.id === id)?.nombreOriginal ?? 'el archivo';
const tagName = (st: DirectorState, id: unknown) => {
  const t = st.etiquetas?.find((x) => x.id === id);
  return t ? `@${t.mencion}` : 'la etiqueta';
};

/** Escenas cuyo prompt pasó de al día a desactualizado. */
function newlyStale(before: DirectorState, after: DirectorState): number[] {
  return (after.guion?.escenas ?? [])
    .filter((s) => {
      const b = before.guion?.escenas.find((x) => x.id === s.id);
      return s.prompt && promptIsStale(s, after) && b && !promptIsStale(b, before);
    })
    .map((s) => s.orden);
}

function staleNote(before: DirectorState, after: DirectorState): string {
  const n = newlyStale(before, after);
  if (!n.length) return '';
  return n.length === 1 ? ` El prompt de la escena ${n[0]} quedó desactualizado.` : ` Los prompts de las escenas ${n.join(', ')} quedaron desactualizados.`;
}

/** Narración de las acciones de referencias y etiquetas (null si no es una de ellas). */
export function narrateRefs(accion: string, before: DirectorState, after: DirectorState, body: Record<string, unknown>): string | null {
  const beforeIds = new Set((before.etiquetas ?? []).map((t) => t.id));
  const stale = () => staleNote(before, after);
  switch (accion) {
    case 'proponer_etiquetas': {
      const fresh = (after.etiquetas ?? []).filter((t) => !beforeIds.has(t.id));
      const list = fresh.map((t) => `@${t.mencion} (${tagKindLabel(t.tipo).label.toLowerCase()})`).join(', ');
      return fresh.length
        ? `Miré las fotos y propongo ${fresh.length === 1 ? 'esta etiqueta' : 'estas etiquetas'}: ${list}. Corrígelas si hace falta y confírmalas; luego puedes nombrarlas con @ en el guion y en las escenas.${stale()}`
        : `Las fotos encajan en etiquetas que ya existían.${stale()}`;
    }
    case 'guardar_etiqueta': {
      const created = (after.etiquetas ?? []).find((t) => !beforeIds.has(t.id));
      if (created) return `Creé @${created.mencion} (${tagKindLabel(created.tipo).label.toLowerCase()}).${stale()}`;
      const t = after.etiquetas?.find((x) => x.id === body.etiquetaId);
      const old = before.etiquetas?.find((x) => x.id === body.etiquetaId);
      const renamed = t && old && old.mencion !== t.mencion ? ` Las @${old.mencion} del guion pasan a @${t.mencion}.` : '';
      return `Guardé @${t?.mencion ?? ''}${old && !old.confirmada ? ' y quedó confirmada' : ''}.${renamed}${stale()}`;
    }
    case 'borrar_etiqueta':
      return `Borré ${tagName(before, body.etiquetaId)}: sus archivos quedan sin etiqueta.${stale()}`;
    case 'unir_etiquetas':
      return `Uní ${tagName(before, body.desde)} con ${tagName(after, body.hacia)}.${stale()}`;
    case 'mover_referencia': {
      const name = `«${refName(after, body.refId)}»`;
      if (body.etiquetaId === null) return `${name} quedó sin etiqueta.${stale()}`;
      if (typeof body.etiquetaId === 'string') return `${name} ahora es de ${tagName(after, body.etiquetaId)}.${stale()}`;
      if (body.escenaId === null) return `${name} ahora sirve para todo el proyecto.${stale()}`;
      return `Listo.${stale()}`;
    }
    case 'borrar_referencia':
      return `Quité «${refName(before, body.refId)}» (queda en referencias/_borradas).${stale()}`;
    case 'usar_locucion': {
      const loc = after.locucion;
      if (!loc) return 'Listo.';
      if (!loc.usarComoVoz) return 'Tu locución queda como referencia: la voz se generará con ElevenLabs.';
      const scriptNote = after.guion?.escenas.length && after.etapas.guion.estado === 'desactualizada' ? ' El guion quedó desactualizado: rehazlo para alinearlo al audio.' : '';
      return `Tomé «${refName(after, loc.refId)}» como locución (${loc.duracionSeg.toFixed(1)} s). El video dura ${after.ajustes.duracionSeg} s y usará tu audio en vez de generar voz (se aplica al montar, en la Fase 4).${loc.transcripcion ? '' : ' Transcríbela para repartir las escenas sobre el audio.'}${scriptNote}`;
    }
    case 'quitar_locucion':
      return 'Dejé de usar la locución; el audio sigue en Referencias.';
    case 'transcribir_locucion': {
      const t = after.locucion?.transcripcion;
      if (!t) return 'Listo.';
      const how = t.motor === 'gemini' ? `Gemini (gratis, aproximada${t.ajustadaASilencios ? '; ajusté los cortes a los silencios del audio' : ''})` : `ElevenLabs (precisa, $${t.costoUSD.toFixed(4)})`;
      const next = before.guion?.escenas.length
        ? ' El guion quedó desactualizado: rehazlo para repartirlo sobre tu audio.'
        : ' Cuando escribas el guion, las escenas se repartirán sobre estas frases.';
      return `Transcribí tu locución con ${how}: ${t.frases.length} frases. Revisa las palabras en la tarjeta de la locución.${next}`;
    }
    case 'editar_transcripcion':
      return `Guardé las palabras corregidas; los tiempos no cambian.${stale()}`;
    default:
      return null;
  }
}

/** Lo que dice el agente tras subir archivos con + Ref. */
export function narrateUpload(after: DirectorState, nuevas: string[], escenaOrden?: number, tag?: string): string {
  const refs = (after.referencias ?? []).filter((r) => nuevas.includes(r.id));
  const n = (m: DirectorRef['medio']) => refs.filter((r) => r.medio === m).length;
  const parts = [
    n('imagen') ? `${n('imagen')} ${n('imagen') === 1 ? 'foto' : 'fotos'}` : '',
    n('audio') ? `${n('audio')} ${n('audio') === 1 ? 'audio' : 'audios'}` : '',
    n('pdf') ? `${n('pdf')} PDF` : '',
  ].filter(Boolean);
  const where = tag ? ` en ${tag}` : escenaOrden ? ` solo para la escena ${escenaOrden}` : ' para todo el proyecto';
  let t = `Guardé ${parts.join(', ')}${where}, en la carpeta «referencias» de la producción.`;
  if (n('pdf')) t += ' Los PDF los leo como material.';
  if (n('audio') && !tag) t += ' ¿Qué es cada audio? Elígelo en Referencias.';
  return t;
}

/** Texto del mensaje de la persona cuando usa un botón (para que la conversación se lea completa). */
export function userEcho(body: Record<string, unknown>, d: DirectorState): string | null {
  const scene = d.guion?.escenas.find((s) => s.id === body.escenaId);
  switch (body.accion) {
    case 'generar_preguntas':
      return 'Hazme las preguntas.';
    case 'saltar_preguntas':
      return 'Salta las preguntas.';
    case 'responder_preguntas':
      return Object.values((body.respuestas as Record<string, string>) ?? {}).filter(Boolean).join(' · ') || 'Sin preferencia.';
    case 'generar_guion':
      return d.guion ? 'Rehaz todo el guion.' : 'Escribe el guion.';
    case 'generar_prompts':
      return body.soloFaltantes ? 'Escribe los prompts que faltan.' : 'Escribe los prompts.';
    case 'aprobar':
      return `Apruebo ${body.etapa === 'guion' ? 'el guion' : body.etapa === 'prompts' ? 'los prompts' : `«${STAGE_NAME[String(body.etapa)] ?? body.etapa}»`}.`;
    case 'rehacer_escena':
      return (body.indicacion as string)?.trim() || `Rehaz la escena ${scene?.orden ?? ''}.`;
    case 'rehacer_prompt':
      return (body.indicacion as string)?.trim() || `Rehaz el prompt ${scene?.orden ?? ''}.`;
    case 'editar_escena':
      return `Edité la escena ${scene?.orden ?? ''} a mano.`;
    case 'editar_prompt':
      return `Edité el prompt ${scene?.orden ?? ''} a mano.`;
    case 'guardar_ajustes':
      return 'Guarda estos ajustes.';
    case 'guardar_idea':
      return 'Cambié la idea.';
    case 'proponer_etiquetas':
      return 'Propón etiquetas para las fotos.';
    case 'usar_locucion':
      return body.usarComoVoz === false ? 'Usa mi audio solo como referencia.' : 'Usa este audio como locución del video.';
    case 'transcribir_locucion':
      return body.motor === 'elevenlabs' ? 'Transcribe mi locución con ElevenLabs.' : 'Transcribe mi locución.';
    case 'guardar_etiqueta':
      return `Guarda la etiqueta «${String(body.nombre ?? '')}».`;
    default:
      return null;
  }
}
