import { getBrollModel, pickBrollDuration, type ClipAspect } from '@/config/broll-models';

/**
 * Cuerpo de POST https://api.apimart.ai/v1/videos/generations para los modelos de toma de apoyo de Apimart.
 * Función pura (sin red): la usan el runner y el script de prueba de payloads.
 * Docs: docs/apimart/grok-imagine-1.5-video-ext.md, docs/apimart/gemini-omni-flash-preview.md y
 * https://docs.apimart.ai/en/api-reference/videos/omni-flash-ext/generation.md (gemini-omni-1.1-flash-ext).
 * Seedance, MiniMax y Kling siguen en ApiMartClient (no pasan por aquí).
 */

export const APIMART_CLIP_MODELS = ['grok-imagine-1.5-video-ext', 'gemini-omni-1.1-flash-ext', 'gemini-omni-flash-preview'] as const;
export type ApimartClipModel = (typeof APIMART_CLIP_MODELS)[number];

export function isApimartClipModel(id: string): id is ApimartClipModel {
  return (APIMART_CLIP_MODELS as readonly string[]).includes(id);
}

export interface ApimartClipInput {
  model: string;
  prompt: string;
  /** Segundos pedidos: se ajustan a una duración admitida y se envían como entero. */
  durationSec: number;
  aspectRatio: ClipAspect;
  resolution?: string;
  /** Fotograma inicial (URL pública). */
  firstFrameUrl?: string;
  /** Referencias extra (fotos del avatar, producto…), URLs públicas. */
  referenceImageUrls?: string[];
  /** Video de referencia o a editar (Gemini Omni). */
  videoUrl?: string;
  /** Alargar un clip anterior (solo gemini-omni-flash-preview). */
  extendFromTaskId?: string;
}

/** Petición imposible de enviar: no se llamó a Apimart ni se gastó nada. */
export class ClipRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipRequestError';
  }
}

function publicUrls(urls: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) throw new ClipRequestError('Apimart solo acepta URLs públicas (http/https) para las imágenes y videos, no base64 ni rutas locales.');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function buildApimartVideoBody(input: ApimartClipInput): Record<string, unknown> {
  if (!isApimartClipModel(input.model)) throw new ClipRequestError(`"${input.model}" no es un modelo de toma de apoyo de Apimart.`);
  const spec = getBrollModel(input.model);
  const prompt = input.prompt.trim();
  if (!prompt) throw new ClipRequestError('Falta el prompt del clip.');
  const resolution = (input.resolution || spec.resolution).toLowerCase();
  if (!spec.resolutions.includes(resolution)) throw new ClipRequestError(`${spec.name} no admite ${resolution} (admite ${spec.resolutions.join(', ')}).`);
  if (!spec.aspectRatios.includes(input.aspectRatio)) throw new ClipRequestError(`${spec.name} no admite el formato ${input.aspectRatio}.`);
  // Duración entera y admitida (Grok 6–15, Omni 1.1 Ext 4/6/8/10)
  const duration = Math.round(pickBrollDuration(spec, Math.ceil(Math.max(1, input.durationSec) - 1e-9)));
  const first = publicUrls([input.firstFrameUrl])[0];
  const refs = publicUrls(input.referenceImageUrls ?? []).filter((u) => u !== first);
  const video = publicUrls([input.videoUrl])[0];

  switch (input.model) {
    case 'grok-imagine-1.5-video-ext': {
      if (video) throw new ClipRequestError('Grok Imagine no admite video de referencia.');
      const images = [first, ...refs].filter(Boolean).slice(0, spec.maxImages) as string[];
      return {
        model: input.model,
        prompt,
        size: input.aspectRatio,
        duration,
        resolution,
        ...(images.length ? { image_urls: images } : {}),
      };
    }
    case 'gemini-omni-1.1-flash-ext': {
      const body: Record<string, unknown> = { model: input.model, prompt, resolution, aspect_ratio: input.aspectRatio };
      if (first) {
        // Fotograma inicial: solo 1 imagen
        body.generation_type = 'frame';
        body.image_urls = [first];
      } else if (refs.length) {
        // Referencias: 1 o 3 (2 da unsupported_image_count)
        body.generation_type = 'reference';
        body.image_urls = refs.length >= 3 ? refs.slice(0, 3) : refs.slice(0, 1);
      }
      // `duration` y `video_urls` no pueden ir juntos
      if (video) body.video_urls = [video];
      else body.duration = duration;
      return body;
    }
    case 'gemini-omni-flash-preview': {
      if (video && input.extendFromTaskId) throw new ClipRequestError('video_urls y extend_from_task_id no pueden ir juntos.');
      const images = [first, ...refs].filter(Boolean).slice(0, spec.maxImages) as string[];
      // Sin parámetro de duración en la doc: el modelo decide (3–10 s)
      return {
        model: input.model,
        prompt,
        resolution: '720p',
        aspect_ratio: input.aspectRatio,
        ...(images.length ? { image_urls: images } : {}),
        ...(video ? { video_urls: [video] } : {}),
        ...(input.extendFromTaskId ? { extend_from_task_id: input.extendFromTaskId } : {}),
      };
    }
  }
}
