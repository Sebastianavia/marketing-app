/**
 * Límites de la capa gratuita de Google AI Studio por familia de modelo.
 *
 * La API de Gemini NO expone la cuota restante, así que el router lleva la cuenta
 * localmente contra estos valores. Son conservadores a propósito: cuando Google
 * responde un 429 con el límite real (QuotaFailure.quotaValue), el tracker lo
 * aprende y sobrescribe el valor para ese slot (llave + modelo).
 */

export interface GeminiRateLimits {
  rpm: number; // requests por minuto
  tpm: number; // tokens por minuto
  rpd: number; // requests por día (se reinicia a medianoche hora del Pacífico)
}

export const GEMINI_FREE_TIER_LIMITS: { match: RegExp; limits: GeminiRateLimits }[] = [
  { match: /pro/, limits: { rpm: 5, tpm: 125_000, rpd: 100 } },
  { match: /flash-lite/, limits: { rpm: 15, tpm: 250_000, rpd: 1000 } },
  { match: /flash/, limits: { rpm: 10, tpm: 250_000, rpd: 250 } },
];

export const DEFAULT_GEMINI_LIMITS: GeminiRateLimits = { rpm: 5, tpm: 125_000, rpd: 100 };

export function getDefaultLimits(model: string): GeminiRateLimits {
  return GEMINI_FREE_TIER_LIMITS.find((l) => l.match.test(model))?.limits ?? DEFAULT_GEMINI_LIMITS;
}

/** Cuántos modelos distintos se usan por llave (los N más recientes con capa gratuita). */
export const GEMINI_MODELS_PER_KEY = 3;

/** Modelos gratuitos adicionales (los siguientes más recientes) que solo se usan como reserva. */
export const GEMINI_RESERVE_MODELS = 2;

/** Cambio preventivo: si al slot le queda menos de este % de RPD, se salta al siguiente. */
export const GEMINI_RPD_SWITCH_THRESHOLD = 0.15;

/** Modelos de respaldo si el descubrimiento falla (sin red, llaves inválidas...). */
export const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

/** Patrones de modelos que no son de texto/chat general y se excluyen del descubrimiento. */
export const GEMINI_EXCLUDED_MODEL_PATTERN =
  /tts|image|lyria|robotics|computer-use|deep-research|antigravity|customtools|transcribe|omni|gemma|embedding|aqa|banana|veo|imagen|live|audio|latest/;
