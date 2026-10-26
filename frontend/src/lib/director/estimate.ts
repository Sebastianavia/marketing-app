import { BROLL_MODELS, DEFAULT_BROLL_MODEL, brollRate, getBrollModel, pickBrollDuration } from '@/config/broll-models';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '@/config/image-models';
import { ELEVEN_MODELS, DEFAULT_ELEVEN_MODEL } from '@/config/elevenlabs-models';
import { ttsCost, videoRate } from '@/config/cost-rates';

/**
 * Calculadora de costos del Director (pura, sin E/S).
 * Usa las mismas tarifas que la app registra en Costos: config/cost-rates.ts y los catálogos de modelos.
 */

/** Modelo de avatar con labios sincronizados (OpenRouter). */
export const AVATAR_MODEL = 'heygen/avatar-iv';
/** Presupuesto por producción si el guion no dice otro. */
export const DEFAULT_BUDGET_USD = 3;
/** Caracteres por segundo de locución en español (aprox.) para pasar de texto a segundos y al revés. */
const CHARS_PER_SECOND = 15;

export type SceneType = 'avatar' | 'toma_de_apoyo' | 'imagen' | 'voz';

export interface SceneInput {
  tipo: SceneType;
  duracionSeg?: number;
  texto?: string;
  modelo?: string;
  modeloVoz?: string;
  conAudio?: boolean;
  resolucion?: string;
  cantidad?: number;
}

export interface SceneEstimate {
  escena: number;
  tipo: SceneType;
  detalle: string;
  costoUSD: number;
  /** Lo mismo con el modelo más barato que sirve (si es distinto). */
  costoMasBaratoUSD: number;
  alternativa?: string;
}

export interface CostEstimate {
  escenas: SceneEstimate[];
  totalUSD: number;
  totalMasBaratoUSD: number;
  presupuestoUSD: number;
  dentroDelPresupuesto: boolean;
  suposiciones: string[];
  alternativas: string[];
}

export class EstimateError extends Error {}

const usd = (n: number) => Math.round(n * 10000) / 10000;
const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function cheapestTts() {
  return [...ELEVEN_MODELS].sort((a, b) => a.pricePer1k - b.pricePer1k)[0];
}

function resolveTts(id: string | undefined) {
  const model = ELEVEN_MODELS.find((m) => m.id === (id || DEFAULT_ELEVEN_MODEL));
  if (!model) {
    throw new EstimateError(`Modelo de voz desconocido: "${id}". Válidos: ${ELEVEN_MODELS.map((m) => m.id).join(', ')}.`);
  }
  return model;
}

/** Caracteres de la locución: los del texto o, si no hay, los que caben en la duración. */
function voiceChars(scene: SceneInput, n: number, assumptions: string[]): number {
  const text = scene.texto?.trim();
  if (text) return text.length;
  if (scene.duracionSeg) {
    assumptions.push(`Escena ${n}: sin texto, se calculan ~${CHARS_PER_SECOND} caracteres por segundo de voz.`);
    return Math.ceil(scene.duracionSeg * CHARS_PER_SECOND);
  }
  throw new EstimateError(`Escena ${n}: indica "texto" o "duracionSeg" para calcular la voz.`);
}

function estimateAvatar(scene: SceneInput, n: number, assumptions: string[]): SceneEstimate {
  if (scene.modelo && scene.modelo !== AVATAR_MODEL) {
    throw new EstimateError(`Escena ${n}: el único modelo de avatar es "${AVATAR_MODEL}".`);
  }
  const chars = voiceChars(scene, n, assumptions);
  let seconds = scene.duracionSeg;
  if (!seconds) {
    seconds = Math.max(1, Math.ceil(chars / CHARS_PER_SECOND));
    assumptions.push(`Escena ${n}: duración calculada por el texto (~${seconds} s).`);
  }
  const tts = resolveTts(scene.modeloVoz);
  const video = seconds * videoRate(AVATAR_MODEL);
  const voice = ttsCost(tts.id, chars);
  const cheapVoice = ttsCost(cheapestTts().id, chars);
  return {
    escena: n,
    tipo: 'avatar',
    detalle: `HeyGen Avatar IV ${seconds} s (${money(video)}) + voz ${tts.name}, ${chars} caracteres (${money(voice)})`,
    costoUSD: usd(video + voice),
    costoMasBaratoUSD: usd(video + cheapVoice),
    alternativa: cheapVoice < voice ? `voz ${cheapestTts().name}` : undefined,
  };
}

function estimateBroll(scene: SceneInput, n: number, assumptions: string[]): SceneEstimate {
  const id = scene.modelo || DEFAULT_BROLL_MODEL;
  if (!BROLL_MODELS.some((m) => m.id === id)) {
    throw new EstimateError(`Escena ${n}: modelo de toma de apoyo desconocido "${id}". Válidos: ${BROLL_MODELS.map((m) => m.id).join(', ')}.`);
  }
  const model = getBrollModel(id);
  const withAudio = !!scene.conAudio;
  if (withAudio && !model.audio) {
    throw new EstimateError(`Escena ${n}: ${model.name} no genera audio propio. Usa uno con audio: ${BROLL_MODELS.filter((m) => m.audio).map((m) => m.id).join(', ')}.`);
  }
  let needed = scene.duracionSeg;
  if (!needed) {
    needed = 6;
    assumptions.push(`Escena ${n}: sin duración, se suponen 6 s.`);
  }

  // Se cobra la duración del clip que se pide, no la que se usa en el montaje.
  const billed = (m: typeof model) => {
    const max = m.durations[m.durations.length - 1];
    const clips = Math.ceil(needed / max);
    const per = pickBrollDuration(m, Math.min(needed, max));
    return { clips, seconds: clips * per };
  };
  const b = billed(model);
  if (b.seconds !== needed) {
    assumptions.push(`Escena ${n}: ${model.name} cobra ${b.seconds} s (${b.clips > 1 ? `${b.clips} clips` : 'duración admitida más cercana'}) para cubrir ${needed} s.`);
  }
  const cost = b.seconds * brollRate(model, withAudio);

  const candidates = BROLL_MODELS.filter((m) => !withAudio || m.audio).map((m) => ({
    m,
    cost: billed(m).seconds * brollRate(m, withAudio),
  }));
  const cheapest = candidates.sort((a, c) => a.cost - c.cost)[0];

  return {
    escena: n,
    tipo: 'toma_de_apoyo',
    detalle: `${model.name} ${b.seconds} s${withAudio ? ' con audio' : ''} (${model.resolution})`,
    costoUSD: usd(cost),
    costoMasBaratoUSD: usd(Math.min(cost, cheapest.cost)),
    alternativa: cheapest.cost < cost ? cheapest.m.name : undefined,
  };
}

function estimateImage(scene: SceneInput, n: number): SceneEstimate {
  const id = scene.modelo || DEFAULT_IMAGE_MODEL;
  const model = IMAGE_MODELS.find((m) => m.id === id);
  if (!model) {
    throw new EstimateError(`Escena ${n}: modelo de imagen desconocido "${id}". Válidos: ${IMAGE_MODELS.map((m) => m.id).join(', ')}.`);
  }
  const res = scene.resolucion || model.resolutions[0];
  if (!model.resolutions.includes(res)) {
    throw new EstimateError(`Escena ${n}: ${model.name} admite ${model.resolutions.join(', ')}.`);
  }
  const qty = scene.cantidad ?? 1;
  const cost = model.pricePerImage[res] * qty;
  const cheapest = IMAGE_MODELS.map((m) => ({ m, price: Math.min(...Object.values(m.pricePerImage)) })).sort(
    (a, b) => a.price - b.price,
  )[0];
  const cheapCost = cheapest.price * qty;
  return {
    escena: n,
    tipo: 'imagen',
    detalle: `${qty} × ${model.name} ${res}`,
    costoUSD: usd(cost),
    costoMasBaratoUSD: usd(Math.min(cost, cheapCost)),
    alternativa: cheapCost < cost ? cheapest.m.name : undefined,
  };
}

function estimateVoice(scene: SceneInput, n: number, assumptions: string[]): SceneEstimate {
  const tts = resolveTts(scene.modelo || scene.modeloVoz);
  const chars = voiceChars(scene, n, assumptions);
  if (chars > tts.charLimit) {
    assumptions.push(`Escena ${n}: ${chars} caracteres superan el máximo por petición de ${tts.name} (${tts.charLimit}); se dividirá en partes.`);
  }
  const cost = ttsCost(tts.id, chars);
  const cheap = ttsCost(cheapestTts().id, chars);
  return {
    escena: n,
    tipo: 'voz',
    detalle: `Voz ${tts.name}, ${chars} caracteres`,
    costoUSD: usd(cost),
    costoMasBaratoUSD: usd(Math.min(cost, cheap)),
    alternativa: cheap < cost ? cheapestTts().name : undefined,
  };
}

export function estimatePlan(scenes: SceneInput[], budgetUSD = DEFAULT_BUDGET_USD): CostEstimate {
  if (scenes.length === 0) throw new EstimateError('Añade al menos una escena.');
  const assumptions: string[] = [];
  const rows = scenes.map((s, i) => {
    const n = i + 1;
    switch (s.tipo) {
      case 'avatar':
        return estimateAvatar(s, n, assumptions);
      case 'toma_de_apoyo':
        return estimateBroll(s, n, assumptions);
      case 'imagen':
        return estimateImage(s, n);
      case 'voz':
        return estimateVoice(s, n, assumptions);
    }
  });

  const total = usd(rows.reduce((sum, r) => sum + r.costoUSD, 0));
  const cheapTotal = usd(rows.reduce((sum, r) => sum + r.costoMasBaratoUSD, 0));
  const alternatives: string[] = [];
  if (total > budgetUSD) {
    if (cheapTotal < total) {
      const changes = rows.filter((r) => r.alternativa).map((r) => `escena ${r.escena} → ${r.alternativa}`);
      alternatives.push(`Con los modelos más baratos (${changes.join('; ')}) costaría ${money(cheapTotal)}.`);
    }
    if (cheapTotal > budgetUSD) {
      alternatives.push('Aun así supera el presupuesto: acorta escenas o cambia escenas de avatar por tomas de apoyo con voz en off.');
    }
  }

  return {
    escenas: rows,
    totalUSD: total,
    totalMasBaratoUSD: cheapTotal,
    presupuestoUSD: budgetUSD,
    dentroDelPresupuesto: total <= budgetUSD,
    suposiciones: assumptions,
    alternativas: alternatives,
  };
}
