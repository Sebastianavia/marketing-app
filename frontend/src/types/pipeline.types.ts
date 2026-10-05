/**
 * Tipos e Interfaces para el Motor de Renderizado (Pipeline ElevenLabs -> Storage -> OpenRouter HeyGen)
 */

// =============================================================================
// ELEVENLABS TYPES
// =============================================================================
export interface ElevenLabsVoiceSettings {
  stability?: number; // 0.0 a 1.0 (default: 0.5)
  similarity_boost?: number; // 0.0 a 1.0 (default: 0.75)
  style?: number; // 0.0 a 1.0 (default: 0.0)
  use_speaker_boost?: boolean; // default: true
}

export interface GenerateSpeechOptions {
  text: string;
  voiceId?: string;
  modelId?: string; // e.g. "eleven_multilingual_v2" o "eleven_turbo_v2_5"
  voiceSettings?: ElevenLabsVoiceSettings;
}

export interface AudioSynthesisResult {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  durationEstimatedSeconds: number;
}

// =============================================================================
// STORAGE TYPES (Cloudflare R2 / AWS S3)
// =============================================================================
export interface StorageUploadParams {
  buffer: Buffer;
  fileName: string;
  contentType?: string;
  folder?: string;
}

export interface StorageUploadResult {
  key: string;
  publicUrl: string;
  bucket: string;
  sizeBytes: number;
}

// =============================================================================
// OPENROUTER / HEYGEN VIDEO TYPES
// =============================================================================
export type OpenRouterVideoStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface OpenRouterVideoGenerationParams {
  model?: string; // Default: "heygen/avatar-iv"
  imageUrl: string;
  audioUrl: string;
  aspectRatio?: '9:16' | '16:9';
  prompt?: string;
}

export interface OpenRouterVideoTask {
  taskId: string;
  status: OpenRouterVideoStatus;
  videoUrl?: string;
  progressPercent?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PollingConfig {
  intervalMs?: number; // Default: 3000ms
  timeoutMs?: number; // Default: 360000ms (6 minutos)
  onProgress?: (task: OpenRouterVideoTask, elapsedSeconds: number) => void;
}

// =============================================================================
// ORCHESTRATOR PIPELINE TYPES
// =============================================================================
export type PipelinePhase =
  | 'idle'
  | 'tts_generation'
  | 'audio_upload'
  | 'video_dispatch'
  | 'video_polling'
  | 'completed'
  | 'failed';

export interface UgcPipelineExecutionInput {
  script: string;
  avatarImageUrl: string;
  voiceId?: string;
  aspectRatio?: '9:16' | '16:9';
  projectName?: string;
}

export interface UgcPipelineProgressEvent {
  phase: PipelinePhase;
  phaseLabel: string;
  progressPercent: number;
  elapsedSeconds: number;
  taskId?: string;
  audioUrl?: string;
  videoUrl?: string;
  error?: string;
}

export interface UgcPipelineFinalResult {
  success: boolean;
  videoUrl: string;
  audioUrl: string;
  taskId: string;
  durationSeconds: number;
  totalTimeElapsedMs: number;
  metadata: {
    voiceId: string;
    model: string;
    scriptLengthChars: number;
    aspectRatio: string;
  };
}

export class PipelineError extends Error {
  public phase: PipelinePhase;
  public isRecoverable: boolean;
  public details?: any;

  constructor(message: string, phase: PipelinePhase, isRecoverable = false, details?: any) {
    super(message);
    this.name = 'PipelineError';
    this.phase = phase;
    this.isRecoverable = isRecoverable;
    this.details = details;
  }
}
