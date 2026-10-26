/**
 * Modelos de voz de ElevenLabs y los ajustes que admite cada uno.
 * Fuentes (consultadas el 12 oct 2026):
 * - Precios API: https://elevenlabs.io/pricing/api
 * - Ajustes por modelo: https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
 * - Eleven v4: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
 * - Límites de caracteres: https://elevenlabs.io/docs/overview/models
 *
 * Se comparte entre cliente y servidor: no importar nada de Node aquí.
 */

export type ElevenModelId =
  | 'eleven_v4_turbo'
  | 'eleven_flash_v2_5'
  | 'eleven_v4'
  | 'eleven_v3'
  | 'eleven_multilingual_v2';

export interface ElevenModelSpec {
  id: ElevenModelId;
  name: string;
  description: string;
  /** USD por 1.000 caracteres, precio de lista de la API. */
  pricePer1k: number;
  /** Máximo de caracteres por petición. */
  charLimit: number;
  /** Admite etiquetas de emoción entre corchetes: [excited], [sighs]… */
  audioTags: boolean;
  /** Admite pausas <break time="1.0s" /> (hasta 3 s). */
  breakTags: boolean;
  controls: {
    /** 'continuous' = deslizador 0–1; 'modes' = Creativo / Natural / Robusto (v3). */
    stability: 'continuous' | 'modes';
    similarity: boolean;
    style: boolean;
    speed: boolean;
    speakerBoost: boolean;
  };
  /** Cómo se consigue emoción con este modelo, en una línea. */
  emotionHint: string;
}

/** Ordenados del más barato al más caro. */
export const ELEVEN_MODELS: ElevenModelSpec[] = [
  {
    id: 'eleven_v4_turbo',
    name: 'Eleven v4 Turbo',
    description: 'Variante rápida de v4. Emoción con etiquetas, 90+ idiomas.',
    pricePer1k: 0.04,
    // ElevenLabs no publica un límite propio para v4 Turbo; se usa el de v4.
    charLimit: 10_000,
    audioTags: true,
    breakTags: false,
    controls: { stability: 'continuous', similarity: true, style: false, speed: false, speakerBoost: false },
    emotionHint: 'Usa etiquetas como [excited] o [sighs], puntos suspensivos y MAYÚSCULAS.',
  },
  {
    id: 'eleven_flash_v2_5',
    name: 'Flash v2.5',
    description: 'El más rápido, sin etiquetas de emoción. 32 idiomas.',
    pricePer1k: 0.04,
    charLimit: 40_000,
    audioTags: false,
    breakTags: true,
    controls: { stability: 'continuous', similarity: true, style: true, speed: true, speakerBoost: true },
    emotionHint: 'Sin etiquetas: baja la estabilidad, sube el estilo y usa la puntuación.',
  },
  {
    id: 'eleven_v4',
    name: 'Eleven v4',
    description: 'El más expresivo de ElevenLabs. Emoción con etiquetas, 90+ idiomas.',
    pricePer1k: 0.08,
    charLimit: 10_000,
    audioTags: true,
    breakTags: false,
    controls: { stability: 'continuous', similarity: true, style: false, speed: false, speakerBoost: false },
    emotionHint: 'Usa etiquetas como [excited] o [sighs], puntos suspensivos y MAYÚSCULAS.',
  },
  {
    id: 'eleven_v3',
    name: 'Eleven v3',
    description: 'Generación anterior a v4. Emoción con etiquetas, 70+ idiomas.',
    pricePer1k: 0.08,
    charLimit: 5_000,
    audioTags: true,
    breakTags: false,
    controls: { stability: 'modes', similarity: false, style: false, speed: false, speakerBoost: false },
    emotionHint: 'Usa etiquetas y el modo Creativo o Natural; Robusto responde menos a las etiquetas.',
  },
  {
    id: 'eleven_multilingual_v2',
    name: 'Multilingual v2',
    description: 'El más estable en textos largos y el más fiel al timbre. 29 idiomas.',
    pricePer1k: 0.08,
    charLimit: 10_000,
    audioTags: false,
    breakTags: true,
    controls: { stability: 'continuous', similarity: true, style: true, speed: true, speakerBoost: true },
    emotionHint: 'Sin etiquetas: baja la estabilidad, sube el estilo y usa la puntuación.',
  },
];

/** Predeterminado: el más barato que además admite etiquetas de emoción. */
export const DEFAULT_ELEVEN_MODEL: ElevenModelId = 'eleven_v4_turbo';

export function getElevenModel(id: string | undefined | null): ElevenModelSpec {
  return ELEVEN_MODELS.find((m) => m.id === id) ?? ELEVEN_MODELS.find((m) => m.id === DEFAULT_ELEVEN_MODEL)!;
}

export function isKnownElevenModel(id: string | undefined | null): id is ElevenModelId {
  return ELEVEN_MODELS.some((m) => m.id === id);
}

export interface VoiceSettingsState {
  stability: number; // 0–1
  similarityBoost: number; // 0–1
  style: number; // 0–1
  speed: number; // 0.7–1.2
  useSpeakerBoost: boolean;
}

/** Valores que la guía de ElevenLabs cita como los más comunes (50 / 75 / 0). */
export const DEFAULT_VOICE_SETTINGS: VoiceSettingsState = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
};

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;

export const V3_STABILITY_MODES = [
  { value: 0, label: 'Creativo' },
  { value: 0.5, label: 'Natural' },
  { value: 1, label: 'Robusto' },
] as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Convierte los ajustes de la interfaz en los que acepta la API para ese modelo
 * (formato camelCase del SDK oficial). Lo que el modelo no admite no se envía.
 */
export function buildApiVoiceSettings(
  modelId: string,
  input: Partial<VoiceSettingsState> & { similarity_boost?: number; use_speaker_boost?: boolean } = {}
): Record<string, number | boolean> {
  const spec = getElevenModel(modelId);
  const d = DEFAULT_VOICE_SETTINGS;
  const out: Record<string, number | boolean> = {};

  let stability = clamp(num(input.stability, d.stability), 0, 1);
  if (spec.controls.stability === 'modes') {
    // v3 solo acepta los tres modos: se usa el más cercano
    stability = V3_STABILITY_MODES.reduce((best, m) =>
      Math.abs(m.value - stability) < Math.abs(best.value - stability) ? m : best
    ).value;
  }
  out.stability = stability;

  if (spec.controls.similarity) {
    out.similarityBoost = clamp(num(input.similarityBoost ?? input.similarity_boost, d.similarityBoost), 0, 1);
  }
  if (spec.controls.style) {
    out.style = clamp(num(input.style, d.style), 0, 1);
  }
  if (spec.controls.speed) {
    out.speed = clamp(num(input.speed, d.speed), SPEED_MIN, SPEED_MAX);
  }
  if (spec.controls.speakerBoost) {
    const sb = input.useSpeakerBoost ?? input.use_speaker_boost;
    out.useSpeakerBoost = typeof sb === 'boolean' ? sb : d.useSpeakerBoost;
  }
  return out;
}

const TAG_RE = /\[[^\]\n]{1,60}\]/g;

export function hasAudioTags(text: string): boolean {
  return /\[[^\]\n]{1,60}\]/.test(text);
}

/** Quita las etiquetas [..] para modelos que no las admiten. */
export function stripAudioTags(text: string): string {
  return text.replace(TAG_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?…])/g, '$1').trim();
}
