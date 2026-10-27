import { UGC_MODELS_CATALOG } from './ugc-models.config';
import { ELEVEN_MODELS } from './elevenlabs-models';
import { BROLL_MODELS } from './broll-models';

/**
 * Tarifas para calcular el costo de cada generación (USD).
 * Fuente: docs/finops/analisis-finops-api-first.md (precios oficiales al 10 oct 2026).
 * Son estimaciones: el valor exacto lo cobra cada proveedor según tu plan.
 * Si un proveedor cambia precios, se actualiza aquí y todo el registro lo usa.
 */

/** Video: USD por segundo de video generado. */
export const VIDEO_RATES_PER_SECOND: Record<string, number> = {
  'heygen/avatar-iv': 0.05, // OpenRouter
  ...Object.fromEntries(UGC_MODELS_CATALOG.map((m) => [m.id, m.costPerSecondUSD])),
  ...Object.fromEntries(BROLL_MODELS.map((m) => [m.id, m.pricePerSecond])),
};

/**
 * Texto a voz (ElevenLabs, API directa): USD por cada 1.000 caracteres.
 * Sale de config/elevenlabs-models.ts (precios de lista de elevenlabs.io/pricing/api).
 */
export const TTS_RATES_PER_1K_CHARS: Record<string, number> = {
  ...Object.fromEntries(ELEVEN_MODELS.map((m) => [m.id, m.pricePer1k])),
  eleven_turbo_v2_5: 0.04, // retirado, se mantiene para filas antiguas
  default: 0.08,
};

/** Guiones con LLM: costo aproximado por guion. Gemini usa la cuota gratuita del pool. */
export const SCRIPT_COST_ESTIMATES: Record<string, number> = {
  'gemini-2.5-flash': 0,
  'gemini-3.6-flash': 0,
  'gemini-3.8-flash': 0,
  // Los guiones por OpenRouter se calculan con tokens reales (config/llm-models.ts)
  default: 0.02,
};

/**
 * Voz a texto (ElevenLabs Speech to Text, API directa): USD por HORA de audio.
 * Fuente: elevenlabs.io/pricing/api (consultado el 27 oct 2026): Scribe v2 por lotes $0.22/h en todos los planes,
 * sin mínimo indicado. Lo usa "video desde mi audio" del modo Director.
 */
export const STT_RATES_PER_HOUR: Record<string, number> = {
  scribe_v2: 0.22,
};

export const DEFAULT_STT_MODEL = 'scribe_v2';

export function sttCost(seconds: number, model: string = DEFAULT_STT_MODEL): number {
  const rate = STT_RATES_PER_HOUR[model] ?? STT_RATES_PER_HOUR[DEFAULT_STT_MODEL];
  return (Math.max(0, seconds) / 3600) * rate;
}

export function videoRate(model: string, withAudio = false): number {
  if (withAudio) {
    const b = BROLL_MODELS.find((m) => m.id === model);
    if (b?.pricePerSecondAudio) return b.pricePerSecondAudio;
  }
  return VIDEO_RATES_PER_SECOND[model] ?? 0.05;
}

export function ttsCost(modelId: string | undefined, characters: number): number {
  const rate = TTS_RATES_PER_1K_CHARS[modelId || 'default'] ?? TTS_RATES_PER_1K_CHARS.default;
  return (characters / 1000) * rate;
}

export function scriptCost(model: string): number {
  return SCRIPT_COST_ESTIMATES[model] ?? SCRIPT_COST_ESTIMATES.default;
}
