/**
 * Modelos de imagen→video para las tomas de apoyo (B-roll) del flujo por escenas.
 * Datos de OpenRouter GET /api/v1/videos/models, consultado el 12 oct 2026.
 * Precio = USD por segundo a la resolución indicada y sin audio (la voz la pone ElevenLabs).
 */
export interface BrollModelSpec {
  id: string;
  name: string;
  /** Duraciones admitidas por clip, en segundos. */
  durations: number[];
  resolution: string;
  aspectRatios: Array<'9:16' | '16:9' | '1:1'>;
  pricePerSecond: number;
  note: string;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const BROLL_MODELS: BrollModelSpec[] = [
  {
    id: 'google/veo-3.1-lite',
    name: 'Veo 3.1 Lite',
    durations: [4, 6, 8],
    resolution: '720p',
    aspectRatios: ['16:9', '9:16'],
    pricePerSecond: 0.03,
    note: 'El más barato. Clips de 4, 6 u 8 s.',
  },
  {
    id: 'minimax/hailuo-3-max',
    name: 'Hailuo 3 Max',
    durations: range(5, 15),
    resolution: '768p',
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.08,
    note: 'Clips de 5 a 15 s.',
  },
  {
    id: 'kwaivgi/kling-v3.0-std',
    name: 'Kling 3.0 Standard',
    durations: range(3, 15),
    resolution: '720p',
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.084,
    note: 'Clips de 3 a 15 s.',
  },
  {
    id: 'alibaba/wan-3.0',
    name: 'Wan 3.0',
    durations: range(2, 30),
    resolution: '720p',
    aspectRatios: ['9:16', '16:9', '1:1'],
    pricePerSecond: 0.1,
    note: 'Clips de 2 a 30 s.',
  },
];

export const DEFAULT_BROLL_MODEL = 'google/veo-3.1-lite';

export function getBrollModel(id: string | undefined): BrollModelSpec {
  return BROLL_MODELS.find((m) => m.id === id) ?? BROLL_MODELS[0];
}

/** Duración a pedir: la menor admitida que cubre lo necesario (o la máxima si nada alcanza). */
export function pickBrollDuration(model: BrollModelSpec, neededSeconds: number): number {
  return model.durations.find((d) => d >= neededSeconds) ?? model.durations[model.durations.length - 1];
}
