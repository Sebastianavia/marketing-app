/**
 * Tipos e interfaces para el módulo de Clonación y Reemplazo ("Genjutsu"):
 * 1. Clonación y reemplazo por Seedance 2.0 (motor multimodal guiado por referencias vía Apimart).
 * 2. Clonación y reemplazo por Runway (inpainting / edición por capas).
 */

export type CloneReplaceProfile = 'seedance' | 'runway';

export type SeedanceModelId = 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini';

export type SeedanceSize = '16:9' | 'adaptive' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

export type SeedanceResolution = '480p' | '720p' | '1080p' | '4k';

export interface SeedanceImageWithRole {
  url: string;
  role: 'first_frame' | 'last_frame' | 'reference_image';
}

export interface SeedanceTransformOptions {
  /** Modelo Seedance en Apimart (por defecto 'seedance-2.0'). */
  model?: SeedanceModelId;
  /** Proporción de salida (por defecto '16:9'). */
  size?: SeedanceSize;
  /** Resolución de salida (por defecto '720p'; '1080p' y '4k' solo en 'seedance-2.0'). */
  resolution?: SeedanceResolution;
  /** Duración del video generado en segundos: entero entre 4 y 15 (por defecto 5). */
  duration?: number;
  /** Si se genera audio acompañante (por defecto true). */
  generateAudio?: boolean;
  /** Moderación previa con omni-moderation-latest (por defecto false). */
  nsfwCheck?: boolean;
  /** Devolver URL del último fotograma para generación continua (por defecto false). */
  returnLastFrame?: boolean;
  /** Semilla opcional para reproducibilidad. */
  seed?: number;
  /** Duración acumulada medida de los videos de referencia (1.8s a 15.2s). */
  videoDurationSec?: number;
  /** Duración acumulada medida de los audios de referencia (<= 15s). */
  audioDurationSec?: number;
  /** Imágenes con rol (prohibido combinar con image_urls, video_urls o audio_urls de first/last frame). */
  imageWithRoles?: SeedanceImageWithRole[];
  /** Si es true, espera el polling completo en la misma llamada; si es false, devuelve el taskId de inmediato. */
  waitForCompletion?: boolean;
  /** Timeout de seguridad del polling en milisegundos (por defecto 300_000 = 300s). */
  timeoutMs?: number;
  /** Intervalo entre consultas de polling en milisegundos (por defecto 4_000 = 4s). */
  pollIntervalMs?: number;
}

export interface SeedanceTransformInput {
  /** URL(s) del video original / guía de movimiento (video_urls, máx. 3, duración 1.8s–15.2s). */
  videoUrl?: string | string[];
  /** Slot 1 (image_urls[0]): URL de la referencia de rostro / personaje a sustituir. */
  faceRefUrl?: string;
  /** Slot 2 (image_urls[1]): URL de la referencia de objeto / producto a reemplazar o sostener. */
  objectRefUrl?: string;
  /** Imágenes de referencia adicionales (hasta completar máx. 9 en image_urls). */
  extraImageUrls?: string[];
  /** URL(s) de la pista de voz / audio nuevo de referencia (audio_urls, máx. 3, duración <= 15s). */
  audioUrl?: string | string[];
  /** Descripción adicional del usuario (se fusiona con el template técnico multimodal). */
  prompt?: string;
  /** Opciones de configuración de Seedance 2.0. */
  options?: SeedanceTransformOptions;
}

export interface SeedanceTaskResult {
  taskId: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  localVideoUrl?: string;
  localPath?: string;
  lastFrameUrl?: string;
  costUSD?: number;
  creditsCost?: number;
  estimatedCostUSD?: number;
  actualTimeSec?: number;
  promptUsed?: string;
  error?: string;
}

// Tipos legacy mantenidos por compatibilidad
export type FaceSwapProvider = 'seedance' | 'runway' | 'replicate' | 'akool' | 'custom_inswapper';

export type FaceSwapJobStatus = 'idle' | 'uploading' | 'submitted' | 'queued' | 'processing' | 'succeeded' | 'completed' | 'failed';

export interface FaceSwapJobRequest {
  baseVideoUrl?: string;
  baseVideoFile?: File | Blob;
  targetFaceImageUrl?: string;
  targetFaceImageFile?: File | Blob;
  provider?: FaceSwapProvider;
  options?: {
    enhanceFace?: boolean;
    seamlessBlend?: boolean;
    keepAudio?: boolean;
  };
}

export interface FaceSwapJobResponse {
  jobId: string;
  status: FaceSwapJobStatus;
  provider: FaceSwapProvider;
  createdAt: string;
  estimatedSeconds?: number;
}

export interface FaceSwapStatusResponse {
  jobId: string;
  status: FaceSwapJobStatus;
  progressPercent: number;
  resultVideoUrl?: string;
  error?: string;
}
