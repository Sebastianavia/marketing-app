/**
 * Cliente de Integración para ApiMart (https://docs.apimart.ai/es)
 * - Generación de imágenes asíncrona con GPT-Image-2 y Nano Banana Pro (POST /v1/images/generations + GET /v1/tasks/{task_id})
 * - Generación y transformación de video multimodal con Seedance 2.0 (POST /v1/videos/generations + GET /v1/tasks/{task_id})
 * - Orquestación de modelos de video como MiniMax-Hailuo-2.3, Kling v3 Omni y Seedance 2.0
 */

import type {
  SeedanceImageWithRole,
  SeedanceModelId,
  SeedanceResolution,
  SeedanceSize,
} from '@/types/faceswap.types';

export interface ApiMartVideoTaskPayload {
  model: string;
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  firstFrameImageUrl?: string;
  callbackUrl?: string;
}

export interface ApiMartTaskResponse {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  estimatedCostCredits?: number;
  error?: string;
}

export interface ApiMartSeedanceVideoPayload {
  model?: SeedanceModelId | string;
  prompt?: string;
  duration?: number;
  size?: SeedanceSize | string;
  resolution?: SeedanceResolution | string;
  generate_audio?: boolean;
  nsfw_check?: boolean;
  return_last_frame?: boolean;
  seed?: number;
  image_urls?: string[];
  image_with_roles?: SeedanceImageWithRole[];
  video_urls?: string[];
  audio_urls?: string[];
  tools?: Array<{ type: 'web_search' }>;
}

export interface ApiMartVideoTaskStatus {
  taskId: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  progress?: number;
  created?: number;
  completed?: number;
  actualTime?: number;
  estimatedTime?: number;
  costUSD?: number;
  creditsCost?: number;
  videoUrl?: string;
  lastFrameUrl?: string;
  errorMessage?: string;
}

export type ApiMartImageModelId =
  | 'gpt-image-2'
  | 'gpt-image-2-ext'
  | 'gemini-3-pro-image-preview'
  | 'nano-banana-pro-ext'
  | 'gemini-3-pro-image-preview-official'
  | 'nano-banana-pro'
  | 'seedream-5-0-pro'
  | 'seedream-5.0-pro';

export interface ApiMartImageGenerationPayload {
  /** Modelo de imagen en Apimart: GPT-Image-2, Nano Banana Pro o Seedream 5.0 Pro. */
  model?: ApiMartImageModelId | string;
  /** Descripción textual para la generación de la imagen. */
  prompt: string;
  /** Número de imágenes a generar (entero puro, por defecto 1; en Seedream 5.0 Pro siempre es 1). */
  n?: number;
  /** Proporción de la imagen (9:16 por defecto en Lulo Studio) o dimensiones exactas widthxheight. */
  size?: string;
  /** Nivel de resolución de salida: '1k'/'2k'/'4k' (GPT-Image-2), '1K'/'2K'/'4K' (Nano Banana Pro) o '1K'/'1.5K'/'2K' (Seedream 5.0 Pro). */
  resolution?: string;
  /** Imágenes de referencia (URL pública o data URI base64 combinables; máx. 15 en GPT-Image-2, 14 en Nano Banana Pro y 10 en Seedream 5.0 Pro). */
  imageUrls?: string[];
  /** Moderación opcional antes de enviar (por defecto false). */
  nsfwCheck?: boolean;
  /** Si recurrir al canal oficial como fallback (por defecto false; no aplicable en -official ni en Seedream 5.0 Pro). */
  officialFallback?: boolean;
  /** Opciones específicas de Seedream 5.0 Pro. */
  outputFormat?: 'jpeg' | 'png';
  background?: 'opaque' | 'transparent';
  watermark?: boolean;
  layerDecomposition?: boolean;
  optimizePromptMode?: 'standard';
}

export interface ApiMartImageTaskStatus {
  taskId: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  progress?: number;
  created?: number;
  completed?: number;
  actualTime?: number;
  estimatedTime?: number;
  /** Costo real en USD devuelto dinámicamente por Apimart al finalizar la tarea. */
  costUSD?: number;
  /** Créditos descontados en Apimart (credits_cost). */
  creditsCost?: number;
  /** URLs de las imágenes generadas (data.result.images[i].url[0]). */
  imageUrls: string[];
  expiresAt?: number;
  errorMessage?: string;
}

export class ApiMartError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status = 500, errorType?: string) {
    super(message);
    this.name = 'ApiMartError';
    this.status = status;
    this.errorType = errorType;
  }
}

const APIMART_BASE_URL = (process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1').replace(/\/+$/, '');

export function isApiMartImageModel(model: string | undefined): boolean {
  if (!model) return false;
  return [
    'gpt-image-2',
    'gpt-image-2-ext',
    'gemini-3-pro-image-preview',
    'nano-banana-pro-ext',
    'gemini-3-pro-image-preview-official',
    'nano-banana-pro',
    'seedream-5-0-pro',
    'seedream-5.0-pro',
  ].includes(model);
}

function isNanoBananaProModel(model: string): boolean {
  return [
    'gemini-3-pro-image-preview',
    'nano-banana-pro-ext',
    'gemini-3-pro-image-preview-official',
    'nano-banana-pro',
  ].includes(model);
}

function isSeedream5ProModel(model: string): boolean {
  return model === 'seedream-5-0-pro' || model === 'seedream-5.0-pro';
}

function mapApiMartHttpError(status: number, rawData: unknown, fallbackContext: string): ApiMartError {
  const errObj =
    rawData && typeof rawData === 'object' && 'error' in rawData
      ? (rawData as { error?: { code?: number | string; message?: string; type?: string }; message?: string }).error
      : undefined;
  const rawMessage =
    errObj?.message ||
    (rawData && typeof rawData === 'object' && 'message' in rawData
      ? String((rawData as { message?: unknown }).message)
      : '') ||
    '';
  const errType = errObj?.type || (typeof errObj?.code === 'string' ? errObj.code : undefined);

  if (errType === 'nsfw_content_detected' || /nsfw_content_detected/i.test(rawMessage)) {
    return new ApiMartError(
      `La solicitud fue rechazada por la moderación de contenido (nsfw_check). No se creó tarea ni se descontaron créditos: ${rawMessage}`,
      400,
      'nsfw_content_detected'
    );
  }

  switch (status) {
    case 400:
      return new ApiMartError(
        `Parámetros no válidos en Apimart: ${rawMessage || 'revisa formato, resolución o referencias enviadas.'}`,
        400,
        errType || 'invalid_request_error'
      );
    case 401:
      return new ApiMartError(
        `Autenticación fallida en Apimart (${rawMessage || 'verifica tu APIMART_API_KEY en frontend/.env.local'}).`,
        401,
        errType || 'authentication_error'
      );
    case 402:
      return new ApiMartError(
        'Tu cuenta de Apimart no tiene saldo suficiente. Recarga en apimart.ai y vuelve a intentarlo (no se generó nada).',
        402,
        errType || 'payment_required'
      );
    case 403:
      return new ApiMartError(
        `Acceso denegado en Apimart (${rawMessage || 'no tienes permiso para acceder a este recurso'}).`,
        403,
        errType || 'permission_error'
      );
    case 429:
      return new ApiMartError(
        'Apimart está recibiendo demasiadas solicitudes (límite de velocidad). Espera un minuto y vuelve a intentarlo.',
        429,
        errType || 'rate_limit_error'
      );
    case 502:
      return new ApiMartError(
        `Error de pasarela (Bad Gateway) en Apimart: el servidor no está disponible temporalmente.`,
        502,
        errType || 'bad_gateway'
      );
    case 503:
      return new ApiMartError(
        `El canal upstream de Apimart no está disponible temporalmente. Inténtalo de nuevo en unos momentos.`,
        503,
        errType || 'service_unavailable'
      );
    default:
      return new ApiMartError(
        rawMessage ? `Error de Apimart (${status}): ${rawMessage}` : `${fallbackContext} (HTTP ${status}).`,
        status >= 400 && status < 600 ? status : 502,
        errType || 'server_error'
      );
  }
}

export class ApiMartClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = (apiKey || process.env.APIMART_API_KEY || '').trim();
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0 && this.apiKey !== 'am_live_xxxxxxxxxxxxxxxxxxxx');
  }

  /**
   * Envía una tarea asíncrona de generación de imagen con GPT-Image-2 o Nano Banana Pro
   * Endpoint: POST https://api.apimart.ai/v1/images/generations
   */
  async createImageGenerationTask(payload: ApiMartImageGenerationPayload): Promise<{ taskId: string; status: string }> {
    if (!this.isConfigured) {
      throw new ApiMartError(
        'APIMART_API_KEY no configurada. Agrega tu clave en frontend/.env.local.',
        400,
        'missing_api_key'
      );
    }

    const modelName = payload.model && isApiMartImageModel(payload.model) ? payload.model : 'gpt-image-2';
    const isNanoBanana = isNanoBananaProModel(modelName);
    const isSeedream5Pro = isSeedream5ProModel(modelName);
    const maxAllowedRefs = isSeedream5Pro ? 10 : isNanoBanana ? 14 : 15;

    const refs = payload.imageUrls?.filter(Boolean) ?? [];
    if (refs.length > maxAllowedRefs) {
      throw new ApiMartError(
        `Este modelo en Apimart admite hasta ${maxAllowedRefs} imágenes de referencia (image_urls exceeds max ${maxAllowedRefs}).`,
        400,
        'invalid_request_error'
      );
    }

    const sizeValue = payload.size || '9:16';
    const exactPixelMatch = /^(\d{3,4})[xX×](\d{3,4})$/.exec(sizeValue.trim());
    if (isSeedream5Pro && exactPixelMatch) {
      const w = Number(exactPixelMatch[1]);
      const h = Number(exactPixelMatch[2]);
      const totalPx = w * h;
      const ratio = w / h;
      if (totalPx < 921_600 || totalPx > 4_624_220) {
        throw new ApiMartError(
          `En Seedream 5.0 Pro los píxeles totales (${w}×${h} = ${totalPx}) deben estar entre 921,600 y 4,624,220.`,
          400,
          'invalid_request_error'
        );
      }
      if (ratio < 1 / 16 || ratio > 16) {
        throw new ApiMartError(
          `En Seedream 5.0 Pro la proporción ancho/alto (${w}×${h}) debe estar entre 1/16 y 16.`,
          400,
          'invalid_request_error'
        );
      }
    }

    // Seedream 5.0 Pro: '1K' | '1.5K' | '2K' (3K/4K dan 400); Nano Banana Pro: '1K' | '2K' | '4K'; GPT-Image-2: '1k' | '2k' | '4k'
    const rawRes = String(
      payload.resolution || (isSeedream5Pro ? '1.5K' : isNanoBanana ? '1K' : '2k')
    ).toUpperCase();
    const resolution = isSeedream5Pro
      ? ['1K', '1.5K', '2K'].includes(rawRes)
        ? rawRes
        : rawRes === '4K' || rawRes === '3K'
          ? '2K'
          : '1.5K'
      : isNanoBanana
        ? ['1K', '2K', '4K'].includes(rawRes)
          ? rawRes
          : '1K'
        : (['1K', '2K', '4K'].includes(rawRes) ? rawRes : '2K').toLowerCase();

    // Seedream 5.0 Pro es modelo de una sola imagen por solicitud (n > 1 devuelve 400)
    const count = isSeedream5Pro ? 1 : Math.max(1, Math.floor(Number(payload.n ?? 1)));

    const body: Record<string, unknown> = {
      model: modelName,
      prompt: payload.prompt,
      size: sizeValue,
      n: count,
      // Cuando size es un valor de píxel exacto en Seedream 5.0 Pro, resolution se omite
      ...(isSeedream5Pro && exactPixelMatch ? {} : { resolution }),
    };

    if (refs.length > 0) {
      body.image_urls = refs;
    }
    if (typeof payload.nsfwCheck === 'boolean') {
      body.nsfw_check = payload.nsfwCheck;
    }
    if (isSeedream5Pro) {
      if (payload.outputFormat) body.output_format = payload.outputFormat;
      if (payload.background) body.background = payload.background;
      if (typeof payload.watermark === 'boolean') body.watermark = payload.watermark;
      if (typeof payload.layerDecomposition === 'boolean') body.layer_decomposition = payload.layerDecomposition;
      if (payload.optimizePromptMode) body.optimize_prompt_options = { mode: payload.optimizePromptMode };
    } else {
      const isOfficialChannel = modelName === 'gemini-3-pro-image-preview-official' || modelName === 'nano-banana-pro';
      if (typeof payload.officialFallback === 'boolean' && !isOfficialChannel) {
        body.official_fallback = payload.officialFallback;
      }
    }

    const response = await fetch(`${APIMART_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mapApiMartHttpError(response.status, data, 'Error al enviar la generación de imagen a Apimart');
    }

    const firstItem = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const taskId: string | undefined = firstItem?.task_id || firstItem?.id || data?.task_id || data?.id;
    if (!taskId) {
      throw new ApiMartError('Apimart no devolvió un task_id válido al iniciar la generación.', 502);
    }

    return {
      taskId,
      status: firstItem?.status || 'submitted',
    };
  }

  /**
   * Consulta el estado y resultado de una tarea de imagen en Apimart
   * Endpoint: GET https://api.apimart.ai/v1/tasks/{task_id}
   */
  async getImageTaskStatus(taskId: string): Promise<ApiMartImageTaskStatus> {
    if (!this.isConfigured) {
      throw new ApiMartError('APIMART_API_KEY no configurada.', 400, 'missing_api_key');
    }

    const response = await fetch(`${APIMART_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mapApiMartHttpError(response.status, payload, 'Error consultando el estado de la tarea en Apimart');
    }

    const taskData = payload?.data ?? payload;
    const rawStatus = String(taskData?.status || 'processing').toLowerCase();
    const status: ApiMartImageTaskStatus['status'] =
      rawStatus === 'completed' || rawStatus === 'succeeded' || rawStatus === 'success'
        ? 'completed'
        : rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled'
          ? 'failed'
          : rawStatus === 'submitted'
            ? 'submitted'
            : 'processing';

    const rawImages = taskData?.result?.images ?? taskData?.images ?? [];
    const imageUrls: string[] = [];
    let expiresAt: number | undefined;

    if (Array.isArray(rawImages)) {
      for (const img of rawImages) {
        if (typeof img === 'string') {
          imageUrls.push(img);
        } else if (img && typeof img === 'object') {
          const u = (img as { url?: unknown; expires_at?: unknown }).url;
          if (Array.isArray(u)) {
            for (const item of u) {
              if (typeof item === 'string' && item) imageUrls.push(item);
            }
          } else if (typeof u === 'string' && u) {
            imageUrls.push(u);
          }
          if (typeof (img as { expires_at?: unknown }).expires_at === 'number') {
            expiresAt = (img as { expires_at: number }).expires_at;
          }
        }
      }
    }

    const errorMessage =
      taskData?.error?.message ||
      (typeof taskData?.error === 'string' ? taskData.error : undefined) ||
      payload?.error?.message;

    return {
      taskId: taskData?.id || taskId,
      status,
      progress: typeof taskData?.progress === 'number' ? taskData.progress : undefined,
      created: typeof taskData?.created === 'number' ? taskData.created : undefined,
      completed: typeof taskData?.completed === 'number' ? taskData.completed : undefined,
      actualTime: typeof taskData?.actual_time === 'number' ? taskData.actual_time : undefined,
      estimatedTime: typeof taskData?.estimated_time === 'number' ? taskData.estimated_time : undefined,
      costUSD: typeof taskData?.cost === 'number' ? taskData.cost : undefined,
      creditsCost: typeof taskData?.credits_cost === 'number' ? taskData.credits_cost : undefined,
      imageUrls,
      expiresAt,
      errorMessage,
    };
  }

  /**
   * Envía la solicitud de generación (GPT-Image-2 o Nano Banana Pro) y hace polling en GET /v1/tasks/{task_id}
   * hasta que el estado sea 'completed' o 'failed'.
   */
  async generateAndWaitImages(
    payload: ApiMartImageGenerationPayload,
    options: { timeoutMs?: number; pollIntervalMs?: number; initialDelayMs?: number } = {}
  ): Promise<ApiMartImageTaskStatus> {
    const { taskId } = await this.createImageGenerationTask(payload);
    const isSeedream = isSeedream5ProModel(String(payload.model || ''));
    const timeoutMs = options.timeoutMs ?? 300_000;
    const pollIntervalMs = options.pollIntervalMs ?? (isSeedream ? 5_000 : 3_000);
    const initialDelayMs = options.initialDelayMs ?? (isSeedream ? 3_000 : 2_000);
    const startedAt = Date.now();

    await new Promise((r) => setTimeout(r, initialDelayMs));

    while (Date.now() - startedAt < timeoutMs) {
      const task = await this.getImageTaskStatus(taskId);
      if (task.status === 'completed') {
        if (!task.imageUrls.length) {
          throw new ApiMartError('La tarea de Apimart finalizó pero no devolvió URLs en result.images.', 502);
        }
        return task;
      }
      if (task.status === 'failed') {
        throw new ApiMartError(
          task.errorMessage || `La generación de imagen con ${payload.model || 'Apimart'} falló.`,
          502,
          'task_failed'
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new ApiMartError(
      `La tarea ${taskId} en Apimart superó el tiempo de espera (${Math.round(timeoutMs / 1000)}s).`,
      504,
      'timeout'
    );
  }

  /**
   * Envía una tarea de generación/transformación multimodal de video con Seedance 2.0
   * Endpoint: POST https://api.apimart.ai/v1/videos/generations
   */
  async createSeedanceVideoTask(payload: ApiMartSeedanceVideoPayload): Promise<{ taskId: string; status: 'submitted' }> {
    if (!this.isConfigured) {
      throw new ApiMartError(
        'APIMART_API_KEY no configurada en frontend/.env.local.',
        400,
        'missing_api_key'
      );
    }

    const body: Record<string, unknown> = {
      model: payload.model || 'seedance-2.0',
      size: payload.size || '16:9',
      resolution: payload.resolution || '720p',
      duration: Math.min(15, Math.max(4, Math.round(Number(payload.duration ?? 5)))),
      generate_audio: payload.generate_audio ?? true,
    };

    if (payload.prompt && payload.prompt.trim()) {
      body.prompt = payload.prompt.trim();
    }
    if (typeof payload.nsfw_check === 'boolean') {
      body.nsfw_check = payload.nsfw_check;
    }
    if (typeof payload.return_last_frame === 'boolean') {
      body.return_last_frame = payload.return_last_frame;
    }
    if (typeof payload.seed === 'number' && Number.isFinite(payload.seed)) {
      body.seed = Math.floor(payload.seed);
    }
    if (payload.image_urls && payload.image_urls.length > 0) {
      body.image_urls = payload.image_urls;
    }
    if (payload.image_with_roles && payload.image_with_roles.length > 0) {
      body.image_with_roles = payload.image_with_roles;
    }
    if (payload.video_urls && payload.video_urls.length > 0) {
      body.video_urls = payload.video_urls;
    }
    if (payload.audio_urls && payload.audio_urls.length > 0) {
      body.audio_urls = payload.audio_urls;
    }
    if (payload.tools && payload.tools.length > 0) {
      body.tools = payload.tools;
    }

    const response = await fetch(`${APIMART_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mapApiMartHttpError(response.status, data, 'Error al enviar la generación de video Seedance a Apimart');
    }

    const firstItem = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const taskId: string | undefined = firstItem?.task_id || firstItem?.id || data?.task_id || data?.id;
    if (!taskId) {
      throw new ApiMartError('Apimart no devolvió un task_id válido al iniciar la tarea de Seedance.', 502);
    }

    return {
      taskId,
      status: 'submitted',
    };
  }

  /**
   * Envía un cuerpo de video ya armado (lib/ai/apimart-video.ts → buildApimartVideoBody) y devuelve el task_id.
   * Endpoint: POST https://api.apimart.ai/v1/videos/generations
   */
  async createVideoTask(body: Record<string, unknown>): Promise<{ taskId: string }> {
    if (!this.isConfigured) {
      throw new ApiMartError('Falta APIMART_API_KEY en frontend/.env.local.', 401, 'missing_api_key');
    }
    const response = await fetch(`${APIMART_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mapApiMartHttpError(response.status, data, `Error al enviar el video ${String(body.model)} a Apimart`);
    }
    const firstItem = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const taskId: string | undefined = firstItem?.task_id || firstItem?.id || data?.task_id || data?.id;
    if (!taskId) throw new ApiMartError('Apimart no devolvió un task_id al crear el video.', 502);
    return { taskId };
  }

  /**
   * Consulta el estado de una tarea de video en Apimart
   * Endpoint: GET https://api.apimart.ai/v1/tasks/{task_id}
   */
  async getVideoTaskStatus(taskId: string): Promise<ApiMartVideoTaskStatus> {
    if (!this.isConfigured) {
      throw new ApiMartError('APIMART_API_KEY no configurada.', 400, 'missing_api_key');
    }

    const response = await fetch(`${APIMART_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw mapApiMartHttpError(response.status, payload, 'Error consultando el estado de la tarea de video en Apimart');
    }

    const taskData = payload?.data ?? payload;
    const rawStatus = String(taskData?.status || 'processing').toLowerCase();
    const status: ApiMartVideoTaskStatus['status'] =
      rawStatus === 'completed' || rawStatus === 'succeeded' || rawStatus === 'success'
        ? 'completed'
        : rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled'
          ? 'failed'
          : rawStatus === 'submitted'
            ? 'submitted'
            : 'processing';

    // Extraer videoUrl desde result.videos[0].url[0] o variantes compatibles de Apimart
    let videoUrl: string | undefined;
    const rawVideos = taskData?.result?.videos ?? taskData?.videos;
    if (Array.isArray(rawVideos) && rawVideos.length > 0) {
      const firstVid = rawVideos[0];
      if (typeof firstVid === 'string') {
        videoUrl = firstVid;
      } else if (firstVid && typeof firstVid === 'object') {
        const u = (firstVid as { url?: unknown }).url;
        if (Array.isArray(u) && typeof u[0] === 'string') videoUrl = u[0];
        else if (typeof u === 'string') videoUrl = u;
      }
    }
    if (!videoUrl) {
      videoUrl =
        taskData?.result?.video_url ||
        taskData?.output?.video_url ||
        taskData?.video_url ||
        (Array.isArray(taskData?.result?.url) ? taskData.result.url[0] : taskData?.result?.url);
    }

    const lastFrameUrl =
      taskData?.result?.last_frame_url ||
      taskData?.result?.last_frame ||
      (Array.isArray(taskData?.result?.images)
        ? Array.isArray(taskData.result.images[0]?.url)
          ? taskData.result.images[0].url[0]
          : taskData.result.images[0]?.url
        : undefined);

    const errorMessage =
      taskData?.error?.message ||
      (typeof taskData?.error === 'string' ? taskData.error : undefined) ||
      payload?.error?.message;

    return {
      taskId: taskData?.id || taskId,
      status,
      progress: typeof taskData?.progress === 'number' ? taskData.progress : undefined,
      created: typeof taskData?.created === 'number' ? taskData.created : undefined,
      completed: typeof taskData?.completed === 'number' ? taskData.completed : undefined,
      actualTime: typeof taskData?.actual_time === 'number' ? taskData.actual_time : undefined,
      estimatedTime: typeof taskData?.estimated_time === 'number' ? taskData.estimated_time : undefined,
      costUSD: typeof taskData?.cost === 'number' ? taskData.cost : undefined,
      creditsCost: typeof taskData?.credits_cost === 'number' ? taskData.credits_cost : undefined,
      videoUrl,
      lastFrameUrl,
      errorMessage,
    };
  }

  /**
   * Envía una tarea de video Seedance 2.0 y hace polling cada 3-5s hacia GET /v1/tasks/{task_id}
   * hasta que el estado sea 'completed' o 'failed'.
   */
  async generateAndWaitSeedanceVideo(
    payload: ApiMartSeedanceVideoPayload,
    options: { timeoutMs?: number; pollIntervalMs?: number; initialDelayMs?: number } = {}
  ): Promise<ApiMartVideoTaskStatus> {
    const { taskId } = await this.createSeedanceVideoTask(payload);
    const timeoutMs = options.timeoutMs ?? 300_000;
    const pollIntervalMs = Math.min(5_000, Math.max(3_000, options.pollIntervalMs ?? 4_000));
    const initialDelayMs = options.initialDelayMs ?? 3_000;
    const startedAt = Date.now();

    await new Promise((r) => setTimeout(r, initialDelayMs));

    while (Date.now() - startedAt < timeoutMs) {
      const task = await this.getVideoTaskStatus(taskId);
      if (task.status === 'completed') {
        if (!task.videoUrl) {
          throw new ApiMartError('La tarea de Seedance finalizó pero Apimart no devolvió la URL del video.', 502);
        }
        return task;
      }
      if (task.status === 'failed') {
        throw new ApiMartError(
          task.errorMessage || 'La generación de video con Seedance 2.0 falló en Apimart.',
          502,
          'task_failed'
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new ApiMartError(
      `La tarea ${taskId} de Seedance 2.0 superó el tiempo de espera de seguridad (${Math.round(timeoutMs / 1000)}s).`,
      504,
      'timeout'
    );
  }

  /**
   * Envía la orden de generación de video al modelo seleccionado (MiniMax, Kling, Seedance)
   */
  async generateVideo(payload: ApiMartVideoTaskPayload): Promise<ApiMartTaskResponse> {
    if (!this.isConfigured) {
      throw new Error(
        'APIMART_API_KEY no configurada. Agrega tu clave en el archivo .env.local o en la configuración de la app.'
      );
    }

    const isSeedance2 = payload.model.startsWith('seedance-2.0');
    const body = isSeedance2
      ? {
          model: payload.model,
          prompt: payload.prompt,
          duration: payload.durationSeconds || 5,
          size: payload.aspectRatio || '16:9',
          resolution: '720p',
          generate_audio: true,
          ...(payload.firstFrameImageUrl ? { image_urls: [payload.firstFrameImageUrl] } : {}),
        }
      : {
          model: payload.model,
          prompt: payload.prompt,
          duration: payload.durationSeconds || 5,
          aspect_ratio: payload.aspectRatio || '9:16',
          image_url: payload.firstFrameImageUrl,
        };

    const response = await fetch(`${APIMART_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Error de ApiMart (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    const firstItem = Array.isArray(data?.data) ? data.data[0] : data?.data;
    return {
      taskId: firstItem?.task_id || data.id || data.task_id,
      status: 'processing',
      estimatedCostCredits: data.credits_used,
    };
  }

  /**
   * Consulta el estado de la tarea de video en ApiMart
   */
  async checkTaskStatus(taskId: string): Promise<ApiMartTaskResponse> {
    const task = await this.getVideoTaskStatus(taskId);
    return {
      taskId: task.taskId,
      status: task.status === 'submitted' ? 'pending' : task.status,
      videoUrl: task.videoUrl,
      estimatedCostCredits: task.creditsCost,
      error: task.errorMessage,
    };
  }
}
