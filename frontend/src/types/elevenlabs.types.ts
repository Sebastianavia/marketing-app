/**
 * Tipos e Interfaces para ElevenLabs Voice Cloning y Multilingual TTS
 * API Docs: https://elevenlabs.io/docs/api-reference
 */

export interface ElevenLabsVoiceSettings {
  stability: number; // 0.0 a 1.0 (default recomendado: 0.5)
  similarity_boost: number; // 0.0 a 1.0 (default recomendado: 0.75)
  style?: number; // 0.0 a 1.0 (default: 0.0)
  use_speaker_boost?: boolean; // default: true
}

export type SupportedLanguageCode = 'es' | 'en' | 'pt';

export interface LanguageOption {
  code: SupportedLanguageCode;
  label: string;
  flag: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'es', label: 'ES', flag: '🇪🇸', name: 'Español' },
  { code: 'en', label: 'EN', flag: '🇺🇸', name: 'English' },
  { code: 'pt', label: 'PT', flag: '🇧🇷', name: 'Português' },
];

/**
 * Registro de una voz en la base de datos o almacenamiento local
 */
export interface ClonedVoiceRecord {
  id: string; // voice_id de ElevenLabs
  name: string;
  category: 'cloned' | 'premade';
  createdAt: string;
  description?: string;
  labels?: Record<string, string>;
  samplesCount: number;
  previewUrl?: string;
  supportedLanguages: SupportedLanguageCode[];
  accent?: string;
  gender?: string;
}

/**
 * Parámetros para Clonación de Voz (/v1/voices/add)
 */
export interface CloneVoiceParams {
  name: string;
  description?: string;
  labels?: Record<string, string>;
  files: Array<{
    buffer: Buffer;
    filename: string;
    contentType?: string;
  }>;
}

export interface CloneVoiceResponse {
  voice_id: string;
  requires_verification?: boolean;
}

/**
 * Parámetros para Text-to-Speech (/v1/text-to-speech/{voice_id})
 */
export interface GenerateAudioParams {
  text: string;
  voiceId: string;
  language?: SupportedLanguageCode | string;
  modelId?: 'eleven_multilingual_v2' | string;
  voiceSettings?: Partial<ElevenLabsVoiceSettings>;
}

export interface AudioSynthesisResult {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  durationEstimatedSeconds: number;
}

/**
 * DTO para la API interna de Next.js
 */
export interface CloneVoiceApiRequest {
  name: string;
  description?: string;
  // files se reciben via multipart/form-data
}

export interface GenerateAudioApiRequest {
  text: string;
  voiceId: string;
  language: SupportedLanguageCode;
}
