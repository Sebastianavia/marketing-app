/**
 * Tipos e interfaces para el módulo de Clonación y Reemplazo Facial (Deep Swap)
 * Diseñado con abstracción de proveedor (Replicate, Akool, Inswapper, etc.)
 */

export type FaceSwapProvider = 'replicate' | 'akool' | 'custom_inswapper';

export type FaceSwapJobStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'succeeded' | 'failed';

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
  progressPercent: number; // 0 - 100
  resultVideoUrl?: string;
  error?: string;
}
