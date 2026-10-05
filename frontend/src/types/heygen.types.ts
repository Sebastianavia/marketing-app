/**
 * Tipos e interfaces de datos para la API v2 de HeyGen
 * Documentación oficial: https://docs.heygen.com/reference
 */

export type HeyGenVideoStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type HeyGenAvatarGender = 'male' | 'female' | 'other';

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender: HeyGenAvatarGender;
  preview_image_url: string;
  preview_video_url?: string;
  avatar_style?: string; // ej. 'normal', 'closeUp', 'circle'
}

export interface HeyGenVoice {
  voice_id: string;
  language: string;
  gender: 'male' | 'female';
  name: string;
  preview_audio: string;
  support_pause: boolean;
}

export interface HeyGenTalkingPhoto {
  talking_photo_id: string;
  talking_photo_name: string;
  preview_image_url: string;
}

export type HeyGenBackgroundType = 'color' | 'image' | 'video';

export interface HeyGenBackgroundConfig {
  type: HeyGenBackgroundType;
  value: string; // Hex color "#0B0F19" o URL pública
}

export interface HeyGenCharacterConfig {
  type: 'avatar' | 'talking_photo';
  avatar_id?: string;
  talking_photo_id?: string;
  avatar_style?: 'normal' | 'closeUp' | 'circle';
  scale?: number;
  offset?: {
    x: number;
    y: number;
  };
}

export interface HeyGenVoiceConfig {
  type: 'text' | 'audio';
  input_text?: string;
  voice_id?: string;
  speed?: number; // 0.5 a 1.5
  audio_url?: string;
}

export interface HeyGenVideoInputClip {
  character: HeyGenCharacterConfig;
  voice: HeyGenVoiceConfig;
  background?: HeyGenBackgroundConfig;
}

export interface HeyGenGenerateVideoPayload {
  title?: string;
  video_inputs: HeyGenVideoInputClip[];
  dimension?: {
    width: number;
    height: number;
  };
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  test?: boolean;
  callback_id?: string;
}

export interface HeyGenGenerateVideoResponse {
  code: number;
  message: string;
  data: {
    video_id: string;
  };
}

export interface HeyGenVideoStatusResponse {
  code: number;
  message: string;
  data: {
    id: string;
    status: HeyGenVideoStatus;
    video_url?: string;
    video_url_caption?: string;
    thumbnail_url?: string;
    duration?: number;
    error?: {
      code: string;
      message: string;
      detail?: string;
    } | null;
  };
}

export interface HeyGenUploadAssetResponse {
  code: number;
  data: {
    id: string;
    url: string;
  };
  message: string;
}
