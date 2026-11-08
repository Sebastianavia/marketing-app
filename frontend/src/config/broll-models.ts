/**
 * Modelos de imagen→video para las tomas de apoyo (B-roll) de Guion a video (manual y Director).
 * - OpenRouter: datos de GET /api/v1/videos/models, consultado el 12 oct 2026.
 * - Apimart: docs de docs.apimart.ai y precios de GET https://api.apimart.ai/api/pricing/model?model=<id>
 *   (pública, sin clave), consultados el 8 nov 2026. Se usa el precio de LISTA (`resolution_prices` /
 *   `resolution_duration_prices`) para estimar por lo alto; Apimart muestra un 20 % menos como precio
 *   pagado según el nivel de la cuenta. El costo REAL sale de `data.cost` de la tarea terminada.
 * Precio = USD por segundo a la resolución indicada y sin audio (la voz la pone ElevenLabs).
 */

export type VideoProvider = 'openrouter' | 'apimart';
export type ClipAspect = '9:16' | '16:9' | '1:1';

export interface BrollModelSpec {
  id: string;
  name: string;
  provider: VideoProvider;
  /** Duraciones admitidas por clip, en segundos. */
  durations: number[];
  /** Resolución predeterminada. */
  resolution: string;
  /** Resoluciones que se pueden elegir (la primera no tiene por qué ser la predeterminada). */
  resolutions: string[];
  aspectRatios: ClipAspect[];
  /** USD/s a la resolución predeterminada y sin audio (lo que se muestra en listas). */
  pricePerSecond: number;
  /** USD/s por resolución (si cambia con la resolución). */
  pricePerSecondByRes?: Record<string, number>;
  /** Precio por clip completo: resolución → duración → USD (Gemini Omni 1.1 Ext cobra por tramo). */
  clipPrice?: Record<string, Record<number, number>>;
  /** Genera su propio audio (voz/diálogo). */
  audio: boolean;
  /** USD/s con audio activado (modo "los personajes hablan"). */
  pricePerSecondAudio?: number;
  /** Imágenes que admite por clip (fotograma inicial + referencias). */
  maxImages: number;
  /** Admite un video de referencia (video_urls). */
  videoRef: boolean;
  /**
   * El proveedor no deja elegir la duración (la decide el modelo dentro de `durations`).
   * No se envía `duration` y se estima el peor caso: la duración máxima.
   */
  durationByModel?: boolean;
  /** Lo que aún no está confirmado en la documentación del proveedor. */
  porConfirmar?: string;
  note: string;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const BROLL_MODELS: BrollModelSpec[] = [
  {
    id: 'grok-imagine-1.5-video-ext',
    name: 'Grok Imagine 1.5',
    provider: 'apimart',
    durations: range(6, 15),
    resolution: '720p',
    resolutions: ['480p', '720p'],
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.0239,
    pricePerSecondByRes: { '480p': 0.01275, '720p': 0.0239 },
    audio: false,
    maxImages: 7,
    videoRef: false,
    porConfirmar: 'La doc no dice si genera audio, ni si con varias imágenes la primera se usa como fotograma inicial.',
    note: 'El más barato. Clips de 6 a 15 s, sin voz.',
  },
  {
    id: 'gemini-omni-1.1-flash-ext',
    name: 'Gemini Omni 1.1 Flash',
    provider: 'apimart',
    durations: [4, 6, 8, 10],
    resolution: '720p',
    resolutions: ['360p', '720p', '1080p', '4k'],
    aspectRatios: ['9:16', '16:9'],
    // Por clip (lista): 720p y 1080p cuestan lo mismo
    clipPrice: {
      '360p': { 4: 0.1875, 6: 0.21875, 8: 0.25, 10: 0.28125 },
      '720p': { 4: 0.3125, 6: 0.375, 8: 0.4375, 10: 0.5 },
      '1080p': { 4: 0.3125, 6: 0.375, 8: 0.4375, 10: 0.5 },
      '4k': { 4: 0.9375, 6: 1, 8: 1.0625, 10: 1.125 },
    },
    pricePerSecond: 0.0625,
    audio: true,
    pricePerSecondAudio: 0.0625,
    // Con fotograma inicial (generation_type "frame") solo 1 imagen; como referencias, 1 o 3
    maxImages: 3,
    videoRef: true,
    porConfirmar: 'La doc de la versión Ext no dice si el clip trae audio (la versión oficial sí).',
    note: 'Con audio y personas que hablan. Clips de 4, 6, 8 o 10 s; precio por clip.',
  },
  {
    id: 'gemini-omni-flash-preview',
    name: 'Gemini Omni Flash (preview)',
    provider: 'apimart',
    durations: range(3, 10),
    resolution: '720p',
    resolutions: ['720p'],
    aspectRatios: ['9:16', '16:9'],
    pricePerSecond: 0.11,
    audio: true,
    pricePerSecondAudio: 0.11,
    maxImages: 16,
    videoRef: true,
    durationByModel: true,
    porConfirmar: 'La doc no tiene parámetro de duración: el modelo decide entre 3 y 10 s y se estima el peor caso (10 s).',
    note: 'Con audio y edición de video. Dura de 3 a 10 s (lo decide el modelo).',
  },
  {
    id: 'google/veo-3.1-lite',
    name: 'Veo 3.1 Lite',
    provider: 'openrouter',
    durations: [4, 6, 8],
    resolution: '720p',
    resolutions: ['720p'],
    aspectRatios: ['16:9', '9:16'],
    pricePerSecond: 0.03,
    audio: true,
    pricePerSecondAudio: 0.05,
    maxImages: 1,
    videoRef: false,
    note: 'Clips de 4, 6 u 8 s.',
  },
  {
    id: 'minimax/hailuo-3-max',
    name: 'Hailuo 3 Max',
    provider: 'openrouter',
    durations: range(5, 15),
    resolution: '768p',
    resolutions: ['768p'],
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.08,
    audio: false,
    maxImages: 1,
    videoRef: false,
    note: 'Clips de 5 a 15 s.',
  },
  {
    id: 'kwaivgi/kling-v3.0-std',
    name: 'Kling 3.0 Standard',
    provider: 'openrouter',
    durations: range(3, 15),
    resolution: '720p',
    resolutions: ['720p'],
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.084,
    audio: true,
    pricePerSecondAudio: 0.126,
    maxImages: 1,
    videoRef: false,
    note: 'Clips de 3 a 15 s.',
  },
  {
    id: 'alibaba/wan-3.0',
    name: 'Wan 3.0',
    provider: 'openrouter',
    durations: range(2, 30),
    resolution: '720p',
    resolutions: ['720p'],
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.1,
    audio: true,
    // El catálogo no distingue precio con o sin audio para Wan 3.0
    pricePerSecondAudio: 0.1,
    maxImages: 1,
    videoRef: false,
    note: 'Clips de 2 a 30 s.',
  },
];

/** Predeterminado sin voz propia (voz en off, presentador): Grok a 720p. */
export const DEFAULT_BROLL_MODEL = 'grok-imagine-1.5-video-ext';
/** Predeterminado cuando los personajes hablan (el modelo pone la voz). */
export const DEFAULT_NATIVE_BROLL_MODEL = 'gemini-omni-1.1-flash-ext';

export function getBrollModel(id: string | undefined): BrollModelSpec {
  return BROLL_MODELS.find((m) => m.id === id) ?? BROLL_MODELS[0];
}

export function isBrollModel(id: string | undefined): boolean {
  return BROLL_MODELS.some((m) => m.id === id);
}

/** Proveedor de un modelo de video (los que no están en el catálogo de B-roll, como HeyGen, van por OpenRouter). */
export function videoProviderOf(modelId: string): VideoProvider {
  return BROLL_MODELS.find((m) => m.id === modelId)?.provider ?? 'openrouter';
}

/** Modelo predeterminado según el modo de voz. */
export function defaultBrollModelFor(modoVoz: VoiceMode): string {
  return modoVoz === 'native' ? DEFAULT_NATIVE_BROLL_MODEL : DEFAULT_BROLL_MODEL;
}

/** Duración a pedir: la menor admitida que cubre lo necesario (o la máxima si nada alcanza). */
export function pickBrollDuration(model: BrollModelSpec, neededSeconds: number): number {
  return model.durations.find((d) => d >= neededSeconds) ?? model.durations[model.durations.length - 1];
}

/** Resolución válida para el modelo (la pedida si la admite; si no, la predeterminada). */
export function brollResolution(model: BrollModelSpec, wanted?: string | null): string {
  const w = wanted?.toLowerCase();
  return w && model.resolutions.includes(w) ? w : model.resolution;
}

/** Cómo suena el video por escenas. */
export type VoiceMode = 'voiceover' | 'native' | 'avatar';

export const VOICE_MODES: Array<{ id: VoiceMode; label: string; description: string }> = [
  {
    id: 'voiceover',
    label: 'Voz en off',
    description: 'Solo tomas de apoyo; nadie habla a cámara. La voz de ElevenLabs suena de fondo durante todo el video.',
  },
  {
    id: 'native',
    label: 'Los personajes hablan',
    description: 'Sin ElevenLabs: el modelo de video genera a la persona y su propia voz en cada clip.',
  },
  {
    id: 'avatar',
    label: 'Tu persona habla con tu voz',
    description: 'Tu foto con labios sincronizados (HeyGen) y tu voz de ElevenLabs; tomas de apoyo entre medio.',
  },
];

/** Precio por segundo del modelo según lleve audio propio o no (y la resolución, si cambia el precio). */
export function brollRate(model: BrollModelSpec, withAudio: boolean, resolution?: string): number {
  if (withAudio && model.pricePerSecondAudio) return model.pricePerSecondAudio;
  const res = brollResolution(model, resolution);
  return model.pricePerSecondByRes?.[res] ?? model.pricePerSecond;
}

/**
 * Costo estimado (USD) de UN clip de `seconds` segundos (ya ajustados a una duración admitida).
 * Los modelos que eligen su duración se estiman por su máximo; los de precio por tramo usan su tabla.
 */
export function clipCostUSD(model: BrollModelSpec, seconds: number, o: { withAudio?: boolean; resolution?: string } = {}): number {
  const res = brollResolution(model, o.resolution);
  const max = model.durations[model.durations.length - 1];
  const billed = model.durationByModel ? max : pickBrollDuration(model, Math.ceil(seconds - 1e-9));
  const table = model.clipPrice?.[res];
  if (table) return table[billed] ?? Math.max(...Object.values(table));
  return billed * brollRate(model, !!o.withAudio, res);
}

/** Segundos que se cobran por un clip (los modelos que eligen duración, el máximo). */
export function billedClipSeconds(model: BrollModelSpec, seconds: number): number {
  return model.durationByModel ? model.durations[model.durations.length - 1] : pickBrollDuration(model, Math.ceil(seconds - 1e-9));
}

export interface ClipChoice {
  formato: ClipAspect;
  resolucion?: string | null;
  conAudio?: boolean;
  /** Duración que se pedirá (ya ajustada). */
  duracionSeg?: number;
}

/** Devuelve por qué la combinación no vale (texto para la persona) o null si vale. Cliente y servidor. */
export function clipChoiceProblem(model: BrollModelSpec, c: ClipChoice): string | null {
  if (!model.aspectRatios.includes(c.formato)) return `${model.name} no admite el formato ${c.formato} (admite ${model.aspectRatios.join(', ')}).`;
  if (c.resolucion && !model.resolutions.includes(c.resolucion.toLowerCase())) {
    return `${model.name} no admite ${c.resolucion} (admite ${model.resolutions.join(', ')}).`;
  }
  if (c.conAudio && !model.audio) return `${model.name} no genera voz propia; para que los personajes hablen usa uno con audio.`;
  const max = model.durations[model.durations.length - 1];
  if (c.duracionSeg && c.duracionSeg > max) return `${model.name} genera hasta ${max} s por clip.`;
  return null;
}

/** Texto corto con el precio para selectores ("$0.024/s" o "$0.31–$0.50 por clip"). */
export function brollPriceLabel(model: BrollModelSpec, withAudio = false, resolution?: string): string {
  const res = brollResolution(model, resolution);
  const table = model.clipPrice?.[res];
  if (table) {
    const v = Object.values(table);
    return `$${Math.min(...v).toFixed(2)}–$${Math.max(...v).toFixed(2)} por clip`;
  }
  return `$${brollRate(model, withAudio, res).toFixed(3)}/s`;
}
