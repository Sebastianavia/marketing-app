import { BROLL_MODELS, getBrollModel, pickBrollDuration } from '@/config/broll-models';
import type { Aspect, DirectorScene, DirectorSceneType, DirectorSettings } from './types';

/**
 * Duraciones por escena según el modelo de video previsto (sirve en cliente y servidor).
 * - Toma de apoyo → el modelo de B-roll de los ajustes, con sus duraciones admitidas (pickBrollDuration).
 * - Persona habla (HeyGen Avatar IV) → libre: dura lo que dure el audio.
 * Así el presupuesto de la Fase 4 coincide con lo que se ve aquí.
 */

export const HEYGEN_MIN_SEG = 2;
export const HEYGEN_MAX_SEG = 60;

export interface DurationFit {
  duracionSeg: number;
  /** true si lo pedido no lo admite el modelo y se cambió. */
  ajustada: boolean;
  modelo: string;
  /** Texto corto con lo que admite el modelo, p. ej. "4, 6 u 8 s". */
  admitidas: string;
}

function listText(values: number[]): string {
  // Rango continuo (Kling 3–15) → "3 a 15 s"; si no, lista
  const continuous = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  if (continuous && values.length > 3) return `${values[0]} a ${values[values.length - 1]} s`;
  if (values.length === 1) return `${values[0]} s`;
  return `${values.slice(0, -1).join(', ')} u ${values[values.length - 1]} s`;
}

export function fitSceneDuration(tipo: DirectorSceneType, ajustes: Pick<DirectorSettings, 'modeloBroll'>, pedida: number): DurationFit {
  const wanted = Number.isFinite(pedida) && pedida > 0 ? pedida : 5;
  if (tipo === 'avatar') {
    // HeyGen es libre; solo se redondea a medio segundo y se acota
    const d = Math.min(HEYGEN_MAX_SEG, Math.max(HEYGEN_MIN_SEG, Math.round(wanted * 2) / 2));
    return { duracionSeg: d, ajustada: d !== wanted, modelo: 'HeyGen Avatar IV', admitidas: `libre (${HEYGEN_MIN_SEG} a ${HEYGEN_MAX_SEG} s)` };
  }
  const model = getBrollModel(ajustes.modeloBroll);
  const d = pickBrollDuration(model, Math.ceil(wanted - 1e-9));
  return { duracionSeg: d, ajustada: d !== wanted, modelo: model.name, admitidas: listText(model.durations) };
}

/** Texto para la persona sobre las duraciones admitidas de cada tipo (también va en las instrucciones a la IA). */
export function durationRules(ajustes: Pick<DirectorSettings, 'modeloBroll' | 'modoVoz'>): string {
  const m = getBrollModel(ajustes.modeloBroll);
  const broll = `tomas de apoyo (${m.name}): solo ${listText(m.durations)}`;
  return ajustes.modoVoz === 'avatar' ? `${broll}; persona hablando (HeyGen): libre, de ${HEYGEN_MIN_SEG} a ${HEYGEN_MAX_SEG} s` : broll;
}

/** Modelos de B-roll válidos para los ajustes (voz nativa exige audio; formato admitido). */
export function brollModelsFor(modoVoz: DirectorSettings['modoVoz'], formato: Aspect) {
  return BROLL_MODELS.filter((m) => (modoVoz !== 'native' || m.audio) && m.aspectRatios.includes(formato));
}

/** Vuelve a ajustar duraciones y recalcula inicio/fin en orden. Muta las escenas. */
export function retimeScenes(escenas: DirectorScene[], ajustes: Pick<DirectorSettings, 'modeloBroll'>) {
  let t = 0;
  escenas.forEach((s, i) => {
    const pedida = s.duracionPedidaSeg ?? s.duracionSeg;
    const fit = fitSceneDuration(s.tipo, ajustes, pedida);
    s.orden = i + 1;
    s.duracionSeg = fit.duracionSeg;
    s.duracionPedidaSeg = fit.ajustada ? pedida : undefined;
    s.inicio = round1(t);
    t += fit.duracionSeg;
    s.fin = round1(t);
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatTime(n: number) {
  return `${n.toFixed(1)}s`;
}
