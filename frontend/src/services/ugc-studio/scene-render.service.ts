import fs from 'fs/promises';
import path from 'path';
import { OpenRouterVideoService } from '@/services/openrouter/openrouter-video.service';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { extractLastFrame, makeTempDir } from '@/lib/video/ffmpeg';
import { PipelineError } from '@/types/pipeline.types';
import {
  continuesWithReferences,
  sentReferenceIds,
  Storyboard,
  StoryboardScene,
  StudioSettings,
  UGC_VIDEO_MODEL,
  UgcReference,
} from '@/types/ugc-studio.types';

/**
 * Render de una escena aprobada con heygen/heygen-video-1 vía OpenRouter.
 *
 * Continuidad:
 * - "apertura" / "corte_con_referencias": input_references = referencias asignadas a la escena.
 * - "continua": frame_images[first_frame] = último fotograma de la escena anterior.
 *   (OpenRouter ignora input_references si hay frame_images, así que nunca se mezclan.)
 */

// Precio en vivo: tarifa de lista (/videos/models) × (1 − descuento vigente del endpoint).
// Caché corta para no consultar en cada clic, pero reflejar promociones casi al instante.
const PRICING_TTL_MS = 60 * 1000;
// Respaldo si OpenRouter no responde: tarifas de lista sin descuento (verificadas el 2026-10-14)
const FALLBACK_RATES: Record<string, number> = {
  duration_seconds_480p: 0.02,
  duration_seconds_768p: 0.036,
  reference_duration_seconds_480p: 0.07,
  reference_duration_seconds_768p: 0.1,
  reference_input_images: 0.04,
};
// heygen cobra reference_input_images solo a partir de la tercera imagen
const FREE_REFERENCE_IMAGES = 2;

export interface LivePricing {
  skus: Record<string, number>; // tarifas de lista
  discount: number; // 0..1 (0.5 = 50% de descuento)
  live: boolean; // false = OpenRouter no respondió y se usa el respaldo
}

let pricingCache: { at: number; pricing: LivePricing } | null = null;

export async function getLivePricing(): Promise<LivePricing> {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.pricing;
  const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ''}` };
  try {
    const [modelsRes, endpointsRes] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/videos/models', { headers, signal: AbortSignal.timeout(15_000) }),
      fetch(`https://openrouter.ai/api/v1/models/${UGC_VIDEO_MODEL}/endpoints`, { headers, signal: AbortSignal.timeout(15_000) }),
    ]);
    const models = await modelsRes.json();
    const model = (models.data || models).find((m: { id: string }) => m.id === UGC_VIDEO_MODEL);
    const skus = Object.fromEntries(
      Object.entries(model?.pricing_skus ?? {}).map(([k, v]) => [k, Number(v)])
    ) as Record<string, number>;
    if (Object.keys(skus).length === 0) throw new Error('OpenRouter no devolvió precios para el modelo');

    // Sin descuento si el endpoint no responde: mejor sobreestimar que cobrar más de lo mostrado
    const endpoints = endpointsRes.ok ? await endpointsRes.json() : null;
    const rawDiscount = Number(endpoints?.data?.endpoints?.[0]?.pricing?.discount ?? 0);
    const discount = Number.isFinite(rawDiscount) ? Math.min(1, Math.max(0, rawDiscount)) : 0;

    const pricing = { skus, discount, live: true };
    pricingCache = { at: Date.now(), pricing };
    return pricing;
  } catch (err) {
    console.warn('[SceneRender] No se pudieron leer precios en vivo, usando respaldo:', err);
    return { skus: FALLBACK_RATES, discount: 0, live: false };
  }
}

/** Tarifa por segundo ya con descuento, para una resolución y con/sin referencias. */
export function ratePerSecond(pricing: LivePricing, resolution: StudioSettings['resolution'], withReferences: boolean): number {
  const sku = `${withReferences ? 'reference_' : ''}duration_seconds_${resolution}`;
  const list = pricing.skus[sku] ?? FALLBACK_RATES[sku] ?? 0.07;
  return Number((list * (1 - pricing.discount)).toFixed(4));
}

export interface SceneRenderPlan {
  firstFrameUrl?: string;
  continuityReference: boolean; // el último fotograma va como primera referencia (escena continua con producto)
  referenceUrls: string[];
  ratePerSecondUSD: number;
  discount: number;
  livePricing: boolean;
  estimatedCostUSD: number;
}

export async function planSceneRender(
  storyboard: Storyboard,
  scene: StoryboardScene,
  references: UgcReference[],
  settings: StudioSettings
): Promise<SceneRenderPlan> {
  let firstFrameUrl: string | undefined;
  let referenceUrls: string[] = [];
  const continuityReference = continuesWithReferences(scene, references);

  if (scene.transition.type === 'continua') {
    const previous = storyboard.scenes.find((s) => s.index === scene.index - 1);
    if (!previous?.render?.lastFrameUrl) {
      throw new Error(
        `La escena ${scene.index} continúa desde la escena ${scene.index - 1}: renderiza primero la escena anterior para encadenar el primer fotograma.`
      );
    }
    if (continuityReference) {
      const ids = sentReferenceIds(storyboard.scenes, scene, references);
      // El último fotograma primero: el prompt le pide al modelo arrancar exactamente como esa imagen
      referenceUrls = [previous.render.lastFrameUrl, ...references.filter((r) => ids.includes(r.id)).map((r) => r.url)];
    } else {
      firstFrameUrl = previous.render.lastFrameUrl;
    }
  } else {
    const ids = sentReferenceIds(storyboard.scenes, scene, references);
    const assigned = references.filter((r) => ids.includes(r.id));
    // Si el director no asignó ninguna, al menos el personaje principal mantiene la identidad
    const chosen = assigned.length > 0 ? assigned : references.filter((r) => r.role === 'personaje');
    referenceUrls = chosen.map((r) => r.url);
  }

  const pricing = await getLivePricing();
  const withReferences = referenceUrls.length > 0;
  const ratePerSecondUSD = ratePerSecond(pricing, settings.resolution, withReferences);
  const extraImages = Math.max(0, referenceUrls.length - FREE_REFERENCE_IMAGES);
  const imagesCost = extraImages * (pricing.skus.reference_input_images ?? FALLBACK_RATES.reference_input_images) * (1 - pricing.discount);

  return {
    firstFrameUrl,
    continuityReference,
    referenceUrls,
    ratePerSecondUSD,
    discount: pricing.discount,
    livePricing: pricing.live,
    estimatedCostUSD: Number((ratePerSecondUSD * scene.durationSeconds + imagesCost).toFixed(4)),
  };
}

// Renders en curso por escena: evita pagar dos veces la misma escena (doble clic, dos pestañas)
const RENDER_LOCK_MS = 20 * 60 * 1000;
const activeRenders: Map<string, { taskId: string; at: number }> =
  ((globalThis as any).__ugcActiveRenders ??= new Map());

export function getActiveRender(sceneId: string): string | undefined {
  const entry = activeRenders.get(sceneId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > RENDER_LOCK_MS) {
    activeRenders.delete(sceneId);
    return undefined;
  }
  return entry.taskId;
}

function releaseRender(taskId: string): void {
  for (const [sceneId, entry] of activeRenders) if (entry.taskId === taskId) activeRenders.delete(sceneId);
}

export async function dispatchSceneRender(
  storyboard: Storyboard,
  scene: StoryboardScene,
  plan: SceneRenderPlan,
  settings: StudioSettings
): Promise<string> {
  const service = new OpenRouterVideoService();
  if (!service.isConfigured) throw new Error('OPENROUTER_API_KEY no está configurada.');
  const taskId = await service.createGenerativeVideoTask({
    model: UGC_VIDEO_MODEL,
    prompt: plan.continuityReference
      ? `The video starts exactly like the first reference image: same person, outfit, setting, lighting and framing, with exactly the same exposure, white balance, contrast and color grading. The other reference images show the character and the product, which must look exactly like them. ${scene.videoPrompt}`
      : scene.videoPrompt,
    durationSeconds: scene.durationSeconds,
    resolution: settings.resolution,
    aspectRatio: settings.aspectRatio,
    seed: scene.seed ?? storyboard.seed,
    firstFrameUrl: plan.firstFrameUrl,
    referenceUrls: plan.referenceUrls,
  });
  activeRenders.set(scene.id, { taskId, at: Date.now() });
  return taskId;
}

export interface SceneRenderStatus {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  lastFrameUrl?: string;
  costUSD?: number;
  error?: string;
}

// Un mismo taskId se finaliza una sola vez aunque la UI siga consultando
const finalizing = (globalThis as unknown as { __ugcFinalizing?: Map<string, Promise<SceneRenderStatus>> }).__ugcFinalizing ??
  new Map<string, Promise<SceneRenderStatus>>();
(globalThis as any).__ugcFinalizing = finalizing;

export async function getSceneRenderStatus(taskId: string): Promise<SceneRenderStatus> {
  const pending = finalizing.get(taskId);
  if (pending) return pending;

  const service = new OpenRouterVideoService();
  let status: Awaited<ReturnType<OpenRouterVideoService['getGenerativeVideoStatus']>>;
  try {
    status = await service.getGenerativeVideoStatus(taskId);
  } catch (err) {
    // Un error definitivo de OpenRouter cierra el render; uno pasajero se propaga para reintentar
    if (err instanceof PipelineError && !err.isRecoverable) {
      releaseRender(taskId);
      return { status: 'failed', error: err.message };
    }
    throw err;
  }
  if (status.status === 'failed') releaseRender(taskId);
  if (status.status !== 'completed') {
    return { status: status.status, error: status.error };
  }
  if (!status.contentUrl) {
    releaseRender(taskId);
    return { status: 'failed', error: 'OpenRouter completó la tarea pero no entregó el video.' };
  }

  const job = (async (): Promise<SceneRenderStatus> => {
    const dir = await makeTempDir();
    try {
      const videoBuffer = await service.downloadVideo(status.contentUrl!);
      const videoFile = path.join(dir, `${taskId}.mp4`);
      await fs.writeFile(videoFile, videoBuffer);
      const frame = await extractLastFrame(videoFile);

      const [video, lastFrame] = await Promise.all([
        cloudinaryStorageService.uploadVideo(videoBuffer, `${taskId}.mp4`),
        cloudinaryStorageService.uploadImage(frame, `${taskId}_last.jpg`, 'lulo-studio/ugc-studio/frames'),
      ]);
      releaseRender(taskId);
      return { status: 'completed', videoUrl: video.publicUrl, lastFrameUrl: lastFrame.publicUrl, costUSD: status.costUSD };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  })();

  finalizing.set(taskId, job);
  job.catch(() => finalizing.delete(taskId)); // permitir reintento si falló la subida
  return job;
}
