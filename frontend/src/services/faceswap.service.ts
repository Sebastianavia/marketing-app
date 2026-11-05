import { ApiMartClient, ApiMartError, type ApiMartSeedanceVideoPayload } from '@/lib/ai/apimart';
import {
  FaceSwapJobRequest,
  FaceSwapJobResponse,
  FaceSwapStatusResponse,
  SeedanceModelId,
  SeedanceResolution,
  SeedanceSize,
  SeedanceTaskResult,
  SeedanceTransformInput,
} from '@/types/faceswap.types';

/**
 * Servicio y Orquestador de Clonación y Reemplazo ("Genjutsu"):
 * - Motor 1 (Activo): Seedance 2.0 Multimodal vía Apimart (`POST /v1/videos/generations` + `GET /v1/tasks/{task_id}`)
 * - Motor 2 (Preparado): Runway Inpainting / Edición por capas
 */

export const SEEDANCE_MODELS: Array<{
  id: SeedanceModelId;
  name: string;
  resolutions: SeedanceResolution[];
  costPerSecondUSD: number;
  badge: string;
  description: string;
}> = [
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0 (Estándar)',
    resolutions: ['480p', '720p', '1080p', '4k'],
    costPerSecondUSD: 0.066,
    badge: 'Máxima Calidad · Hasta 4K',
    description: 'Soporte multimodal completo (video + rostro + objeto + voz) y resoluciones hasta 1080p/4K.',
  },
  {
    id: 'seedance-2.0-fast',
    name: 'Seedance 2.0 Fast',
    resolutions: ['480p', '720p'],
    costPerSecondUSD: 0.04035,
    badge: 'Alta Velocidad',
    description: 'Mismas capacidades multimodales de clonación con menor tiempo de renderizado (480p/720p).',
  },
  {
    id: 'seedance-2.0-mini',
    name: 'Seedance 2.0 Mini',
    resolutions: ['480p', '720p'],
    costPerSecondUSD: 0.03,
    badge: 'Ligero · Pruebas Rápidas',
    description: 'Ideal para iteraciones rápidas de transferencia de movimiento y pruebas de prompt (480p/720p).',
  },
];

export const SEEDANCE_SIZES: Array<{ value: SeedanceSize; label: string }> = [
  { value: '16:9', label: '16:9 (Horizontal · Predeterminado)' },
  { value: 'adaptive', label: 'adaptive (Adaptativo al video/imagen de entrada)' },
  { value: '9:16', label: '9:16 (Vertical · Reels/TikTok)' },
  { value: '1:1', label: '1:1 (Cuadrado)' },
  { value: '4:3', label: '4:3 (Tradicional H)' },
  { value: '3:4', label: '3:4 (Tradicional V)' },
  { value: '21:9', label: '21:9 (Ultra ancha / Cine)' },
];

export const SEEDANCE_PROMPT_TEMPLATE =
  'Using the motion, camera tracking, and pose from video 1, replace the main character with the person depicted in image 1. If image 2 is provided, replace the held object with the item shown in image 2. Synchronize mouth movements and timing with audio 1. Cinematic, coherent lighting, realistic physics.';

export class SeedanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedanceValidationError';
  }
}

function normalizeUrlArray(val?: string | string[]): string[] {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((u) => u.trim()).filter(Boolean);
}

function isValidMediaOrAssetUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url) || /^asset:\/\/[a-zA-Z0-9_.-]+$/i.test(url);
}

/**
 * Construye el prompt multimodal combinando el template técnico de mapeo de referencias
 * con la descripción personalizada del usuario.
 */
export function buildSeedanceMultimodalPrompt(params: {
  userPrompt?: string;
  hasVideoRef?: boolean;
  hasFaceRef?: boolean;
  hasObjectRef?: boolean;
  hasAudioRef?: boolean;
}): string {
  const custom = params.userPrompt?.trim() || '';
  if (custom.includes('Using the motion, camera tracking, and pose from video 1')) {
    return custom;
  }
  return custom ? `${SEEDANCE_PROMPT_TEMPLATE} ${custom}` : SEEDANCE_PROMPT_TEMPLATE;
}

/**
 * Valida estrictamente las entradas multimodales según las reglas de Seedance 2.0 en Apimart
 * y construye el payload listo para POST /v1/videos/generations.
 */
export function validateAndBuildSeedancePayload(input: SeedanceTransformInput): {
  payload: ApiMartSeedanceVideoPayload;
  estimatedCostUSD: number;
} {
  const opts = input.options ?? {};
  const model: SeedanceModelId = opts.model ?? 'seedance-2.0';
  const modelSpec = SEEDANCE_MODELS.find((m) => m.id === model);
  if (!modelSpec) {
    throw new SeedanceValidationError(`Modelo Seedance no soportado: "${model}". Usa seedance-2.0, seedance-2.0-fast o seedance-2.0-mini.`);
  }

  const size: SeedanceSize = opts.size ?? '16:9';
  if (!SEEDANCE_SIZES.some((s) => s.value === size)) {
    throw new SeedanceValidationError(`Proporción (size) no válida: "${size}".`);
  }

  const resolution: SeedanceResolution = opts.resolution ?? '720p';
  if (!modelSpec.resolutions.includes(resolution)) {
    throw new SeedanceValidationError(
      `La resolución "${resolution}" solo es compatible con seedance-2.0. ${modelSpec.name} admite: ${modelSpec.resolutions.join(', ')}.`
    );
  }

  const duration = opts.duration ?? 5;
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
    throw new SeedanceValidationError('La duración del video a generar debe ser un número entero entre 4 y 15 segundos.');
  }

  // 1. Video base (video_urls): máx. 3 videos, duración acumulada entre 1.8s y 15.2s
  const videoUrls = normalizeUrlArray(input.videoUrl);
  if (videoUrls.length > 3) {
    throw new SeedanceValidationError('Seedance 2.0 admite como máximo 3 videos de referencia en video_urls.');
  }
  for (const vUrl of videoUrls) {
    if (!isValidMediaOrAssetUrl(vUrl)) {
      throw new SeedanceValidationError(`URL de video no válida ("${vUrl}"). Usa una URL pública https:// o asset://.`);
    }
  }
  if (typeof opts.videoDurationSec === 'number' && videoUrls.length > 0) {
    if (opts.videoDurationSec < 1.8 || opts.videoDurationSec > 15.2) {
      throw new SeedanceValidationError(
        `La duración acumulada del video base (${opts.videoDurationSec.toFixed(1)}s) debe estar entre 1.8s y 15.2s.`
      );
    }
  }

  // 2. Imágenes de referencia (image_urls): Slot 1 = rostro/personaje, Slot 2 = objeto, hasta máx. 9 URLs
  const imageUrls: string[] = [];
  if (input.faceRefUrl?.trim()) imageUrls.push(input.faceRefUrl.trim());
  if (input.objectRefUrl?.trim()) imageUrls.push(input.objectRefUrl.trim());
  if (Array.isArray(input.extraImageUrls)) {
    for (const extra of input.extraImageUrls) {
      if (extra?.trim()) imageUrls.push(extra.trim());
    }
  }
  if (imageUrls.length > 9) {
    throw new SeedanceValidationError('Seedance 2.0 admite como máximo 9 imágenes de referencia en image_urls.');
  }
  for (const imgUrl of imageUrls) {
    if (!isValidMediaOrAssetUrl(imgUrl)) {
      throw new SeedanceValidationError(`URL de imagen de referencia no válida ("${imgUrl}"). Usa https:// o asset://.`);
    }
  }

  // Regla estricta: No combinar image_urls con image_with_roles ni pasar first_frame/last_frame si se envían video_urls o audio_urls
  const imageWithRoles = opts.imageWithRoles ?? [];
  if (imageUrls.length > 0 && imageWithRoles.length > 0) {
    throw new SeedanceValidationError('Regla multimodal Seedance: No se puede combinar image_urls con image_with_roles simultáneamente.');
  }

  // 3. Audio de referencia (audio_urls): máx. 3 audios, duración total <= 15s, solo si hay video o imagen de referencia
  const audioUrls = normalizeUrlArray(input.audioUrl);
  if (audioUrls.length > 3) {
    throw new SeedanceValidationError('Seedance 2.0 admite como máximo 3 archivos de audio de referencia en audio_urls.');
  }
  for (const aUrl of audioUrls) {
    if (!isValidMediaOrAssetUrl(aUrl)) {
      throw new SeedanceValidationError(`URL de audio de referencia no válida ("${aUrl}"). Usa https:// o asset://.`);
    }
  }
  if (typeof opts.audioDurationSec === 'number' && audioUrls.length > 0 && opts.audioDurationSec > 15) {
    throw new SeedanceValidationError(
      `La duración acumulada del audio de referencia (${opts.audioDurationSec.toFixed(1)}s) no puede superar los 15 segundos.`
    );
  }
  if (audioUrls.length > 0 && videoUrls.length === 0 && imageUrls.length === 0) {
    throw new SeedanceValidationError(
      'Regla multimodal Seedance: El audio de referencia (audio_urls) solo puede enviarse junto con un video (video_urls) o imagen de referencia (image_urls).'
    );
  }

  const hasFirstOrLastFrame = imageWithRoles.some((r) => r.role === 'first_frame' || r.role === 'last_frame');
  if (hasFirstOrLastFrame && (videoUrls.length > 0 || audioUrls.length > 0)) {
    throw new SeedanceValidationError(
      'Regla multimodal Seedance: Al usar first_frame / last_frame en image_with_roles, no están disponibles video_urls ni audio_urls.'
    );
  }

  // 4. Constructor del Prompt
  const finalPrompt = buildSeedanceMultimodalPrompt({
    userPrompt: input.prompt,
    hasVideoRef: videoUrls.length > 0,
    hasFaceRef: Boolean(input.faceRefUrl?.trim()),
    hasObjectRef: Boolean(input.objectRefUrl?.trim()),
    hasAudioRef: audioUrls.length > 0,
  });

  if (model !== 'seedance-2.0-mini' && finalPrompt.length > 4000) {
    throw new SeedanceValidationError(`El prompt supera el límite de 4000 caracteres para ${model} (${finalPrompt.length} caracteres).`);
  }

  const payload: ApiMartSeedanceVideoPayload = {
    model,
    prompt: finalPrompt,
    size,
    resolution,
    duration,
    generate_audio: opts.generateAudio ?? true,
    nsfw_check: opts.nsfwCheck ?? false,
    ...(typeof opts.returnLastFrame === 'boolean' ? { return_last_frame: opts.returnLastFrame } : {}),
    ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
    ...(videoUrls.length > 0 ? { video_urls: videoUrls } : {}),
    ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
    ...(imageWithRoles.length > 0 ? { image_with_roles: imageWithRoles } : {}),
    ...(audioUrls.length > 0 ? { audio_urls: audioUrls } : {}),
  };

  const estimatedCostUSD = Math.round(duration * modelSpec.costPerSecondUSD * 10000) / 10000;
  return { payload, estimatedCostUSD };
}

/**
 * Controlador / Orquestador principal para Clonación y Reemplazo por Seedance 2.0.
 * Valida las referencias multimodales, construye el prompt técnico, envía la solicitud a Apimart
 * y (si waitForCompletion !== false) ejecuta el polling asíncrono hasta obtener el video final.
 */
export async function transformVideoSeedance(
  input: SeedanceTransformInput,
  apiKey?: string
): Promise<SeedanceTaskResult> {
  const { payload, estimatedCostUSD } = validateAndBuildSeedancePayload(input);
  const client = new ApiMartClient(apiKey);

  if (!client.isConfigured) {
    throw new ApiMartError('Falta APIMART_API_KEY en frontend/.env.local.', 400, 'missing_api_key');
  }

  const waitForCompletion = input.options?.waitForCompletion ?? true;
  if (!waitForCompletion) {
    const created = await client.createSeedanceVideoTask(payload);
    return {
      taskId: created.taskId,
      status: created.status,
      estimatedCostUSD,
      promptUsed: payload.prompt,
    };
  }

  const completed = await client.generateAndWaitSeedanceVideo(payload, {
    timeoutMs: input.options?.timeoutMs ?? 300_000,
    pollIntervalMs: input.options?.pollIntervalMs ?? 4_000,
  });

  return {
    taskId: completed.taskId,
    status: completed.status,
    progress: completed.progress ?? 100,
    videoUrl: completed.videoUrl,
    lastFrameUrl: completed.lastFrameUrl,
    costUSD: completed.costUSD ?? estimatedCostUSD,
    creditsCost: completed.creditsCost,
    estimatedCostUSD,
    actualTimeSec: completed.actualTime,
    promptUsed: payload.prompt,
  };
}

export class FaceSwapService {
  /**
   * Ejecuta el flujo de Clonación y Reemplazo multimodal con Seedance 2.0 vía Apimart.
   */
  async transformVideoSeedance(input: SeedanceTransformInput, apiKey?: string): Promise<SeedanceTaskResult> {
    return transformVideoSeedance(input, apiKey);
  }

  /**
   * Inicia el proceso legacy de Face Swap.
   */
  async startFaceSwap(request: FaceSwapJobRequest): Promise<FaceSwapJobResponse> {
    if (!request.baseVideoUrl && !request.baseVideoFile) {
      throw new Error('Se requiere un video base (URL o archivo).');
    }
    if (!request.targetFaceImageUrl && !request.targetFaceImageFile) {
      throw new Error('Se requiere una imagen del rostro objetivo (URL o archivo).');
    }

    return {
      jobId: `swap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'queued',
      provider: request.provider || 'seedance',
      createdAt: new Date().toISOString(),
      estimatedSeconds: 45,
    };
  }

  async getJobStatus(jobId: string): Promise<FaceSwapStatusResponse> {
    const client = new ApiMartClient();
    if (client.isConfigured) {
      const status = await client.getVideoTaskStatus(jobId);
      return {
        jobId,
        status: status.status === 'completed' ? 'succeeded' : status.status,
        progressPercent: status.progress ?? (status.status === 'completed' ? 100 : 50),
        resultVideoUrl: status.videoUrl,
        error: status.errorMessage,
      };
    }
    return {
      jobId,
      status: 'processing',
      progressPercent: 65,
    };
  }
}

export const faceSwapService = new FaceSwapService();
