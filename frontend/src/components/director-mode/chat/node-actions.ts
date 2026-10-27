import { VOICE_MODES, getBrollModel } from '@/config/broll-models';
import { STAGES, currentStage, promptIsStale } from '@/lib/director-mode/stages';
import type { DirectorScene, DirectorState } from '@/lib/director-mode/types';
import { parseNodeId } from '../canvas/build-graph';

/**
 * Chat enfocado (paso 1, sin IA nueva): el nodo elegido decide a qué acción del motor va lo que escribes,
 * y el agente narra el resultado leyendo el estado antes y después. Funciones puras.
 */

export interface Focus {
  kind: 'idea' | 'direccion' | 'escena' | 'prompt' | 'guion-pendiente' | 'ninguno';
  scene?: DirectorScene;
  /** Nombre corto para la cabecera del chat. */
  label: string;
}

export function focusOf(d: DirectorState, nodeId: string | null): Focus {
  const p = parseNodeId(nodeId);
  if (!p) return { kind: 'ninguno', label: '' };
  if (p.kind === 'idea') return { kind: 'idea', label: 'Idea' };
  if (p.kind === 'direccion') return { kind: 'direccion', label: 'Dirección' };
  if (p.kind === 'guion-pendiente') return { kind: 'guion-pendiente', label: 'Guion' };
  const scene = d.guion?.escenas.find((s) => s.id === p.sceneId);
  if (!scene) return { kind: 'ninguno', label: '' };
  if (p.kind === 'escena') return { kind: 'escena', scene, label: `Escena ${scene.orden}` };
  if (p.kind === 'prompt') return { kind: 'prompt', scene, label: `Prompt ${scene.orden}` };
  return { kind: 'ninguno', label: '' };
}

export interface Composer {
  enabled: boolean;
  placeholder: string;
  /** Acción a la que va el texto (con el texto como indicación). */
  toBody?: (texto: string) => Record<string, unknown> & { accion: string };
  busyKey?: string;
}

export function composerFor(d: DirectorState, f: Focus): Composer {
  if (f.kind === 'escena' && f.scene) {
    const s = f.scene;
    const ok = d.etapas.guion.estado !== 'bloqueada';
    return {
      enabled: ok,
      placeholder: ok ? `¿Qué cambio en la escena ${s.orden}? (p. ej. «hazla de noche»)` : 'El guion está bloqueado: aprueba lo anterior.',
      toBody: (texto) => ({ accion: 'rehacer_escena', escenaId: s.id, indicacion: texto }),
      busyKey: `rehacer_escena:${s.id}`,
    };
  }
  if (f.kind === 'prompt' && f.scene) {
    const s = f.scene;
    const ok = d.etapas.guion.estado === 'aprobada';
    return {
      enabled: ok,
      placeholder: ok ? `¿Qué cambio en el prompt ${s.orden}? (p. ej. «plano más cerrado»)` : 'Aprueba el guion para escribir prompts.',
      toBody: (texto) => ({ accion: 'rehacer_prompt', escenaId: s.id, indicacion: texto }),
      busyKey: `rehacer_prompt:${s.id}`,
    };
  }
  if (f.kind === 'idea') return { enabled: false, placeholder: 'Edita la idea con el formulario de arriba.' };
  if (f.kind === 'direccion') return { enabled: false, placeholder: 'Responde o cambia los ajustes arriba.' };
  return { enabled: false, placeholder: 'Toca una escena o un prompt del lienzo para pedir un cambio.' };
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
  return `Abrí «${nombre}». ${where} Toca una escena o un prompt del lienzo para pedirme un cambio.`;
}

/** Lo que dice el agente después de una acción que salió bien. */
export function narrate(accion: string, before: DirectorState, after: DirectorState, body: Record<string, unknown>, aviso?: string): string {
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
      t = `Guardé tus cambios en la escena ${s?.orden ?? ''}.${s?.duracionPedidaSeg !== undefined ? ` El modelo la ajustó a ${s.duracionSeg} s.` : ''}${s && s.prompt && promptIsStale(s) ? ' Su prompt quedó desactualizado.' : ''}`;
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
    default:
      return null;
  }
}
