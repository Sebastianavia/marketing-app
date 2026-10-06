import {
  ElevenLabsVoiceSettings,
  SupportedLanguageCode,
  CloneVoiceParams,
  CloneVoiceResponse,
  GenerateAudioParams,
  AudioSynthesisResult,
  ClonedVoiceRecord,
} from '@/types/elevenlabs.types';
import {
  GenerateSpeechOptions,
  AudioSynthesisResult as LegacyAudioSynthesisResult,
  PipelineError,
} from '@/types/pipeline.types';
import { saveStoredVoice, getStoredVoices } from '@/lib/storage/voice-storage';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (Natural / Conversational)
const MANDATORY_MODEL_ID = 'eleven_multilingual_v2'; // Requisito estricto: modelo multilingüe

export class ElevenLabsService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  // ===========================================================================
  // FLUJO A: CLONACIÓN DE VOZ (Instant Voice Cloning: /v1/voices/add)
  // ===========================================================================
  /**
   * Envía muestras de audio limpias (MP3/WAV) a la API de ElevenLabs para clonación instantánea.
   * Guarda automáticamente el registro en la base de datos local para su reutilización.
   *
   * @param name Nombre comercial o descriptivo de la voz clonada (ej. "Voz Sebastián Principal")
   * @param files Lista de buffers o archivos de audio (1 a 5 minutos)
   * @param description Descripción opcional del tono y uso de la voz
   * @param labels Metadatos adicionales opcionales (accent, gender, etc.)
   * @returns voice_id generado por ElevenLabs
   */
  async cloneVoice(
    name: string,
    files: Array<{ buffer: Buffer; filename: string; contentType?: string }>,
    description?: string,
    labels?: Record<string, string>
  ): Promise<{ voice_id: string; name: string }> {
    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new PipelineError(
        'El nombre de la voz es obligatorio para la clonación.',
        'voice_cloning',
        false
      );
    }

    if (!files || files.length === 0) {
      throw new PipelineError(
        'Debes proporcionar al menos una muestra de audio limpia para clonar la voz.',
        'voice_cloning',
        false
      );
    }

    // Modo contingencia / desarrollo si no hay API key configurada
    if (!this.isConfigured) {
      console.warn(
        '[ElevenLabsService] ELEVENLABS_API_KEY no configurada. Generando voice_id simulado para desarrollo.'
      );
      const mockVoiceId = `mock_cloned_${Date.now()}`;
      await this.persistClonedVoiceLocally(mockVoiceId, trimmedName, files.length, description, labels);
      return { voice_id: mockVoiceId, name: trimmedName };
    }

    const endpoint = `${ELEVENLABS_BASE_URL}/voices/add`;
    const formData = new FormData();

    formData.append('name', trimmedName);
    if (description) {
      formData.append('description', description);
    }
    if (labels && Object.keys(labels).length > 0) {
      formData.append('labels', JSON.stringify(labels));
    }

    // Adjuntar cada archivo de muestra de audio como un Blob nativo
    for (const file of files) {
      const mime = file.contentType || (file.filename.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
      const blob = new Blob([new Uint8Array(file.buffer)], { type: mime });
      formData.append('files', blob, file.filename);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          parsedMessage = parsed.detail?.message || parsed.message || errorText;
        } catch {
          // Usar errorText original
        }

        if (response.status === 401) {
          throw new PipelineError(
            'API Key de ElevenLabs inválida o sin permisos de clonación (401).',
            'voice_cloning',
            false,
            { status: 401, errorText }
          );
        }

        if (response.status === 400) {
          throw new PipelineError(
            `Error en muestras de audio para clonación: ${parsedMessage}`,
            'voice_cloning',
            false,
            { status: 400, errorText }
          );
        }

        throw new PipelineError(
          `Fallo al clonar voz en ElevenLabs (${response.status}): ${parsedMessage}`,
          'voice_cloning',
          response.status >= 500,
          { status: response.status, errorText }
        );
      }

      const data: CloneVoiceResponse = await response.json();
      const voiceId = data.voice_id;

      // Persistir en el almacenamiento local para reusar la voz
      await this.persistClonedVoiceLocally(
        voiceId,
        trimmedName,
        files.length,
        description,
        labels
      );

      return {
        voice_id: voiceId,
        name: trimmedName,
      };
    } catch (err: any) {
      if (err instanceof PipelineError) throw err;
      throw new PipelineError(
        `Error de red al contactar servicio de clonación ElevenLabs: ${err.message}`,
        'voice_cloning',
        true,
        err
      );
    }
  }

  // ===========================================================================
  // FLUJO B: GENERACIÓN TEXT-TO-SPEECH (/v1/text-to-speech/{voice_id})
  // ===========================================================================
  /**
   * Genera síntesis de voz neuronal utilizando obligatoriamente el modelo
   * 'eleven_multilingual_v2' para soporte fluido en Español (por defecto), Inglés y Portugués.
   *
   * @param text Guion o texto a locutar
   * @param voiceId ID de la voz (clonada o predeterminada)
   * @param language Idioma objetivo ('es' | 'en' | 'pt', por defecto 'es')
   * @returns Buffer binario MP3 y metadatos de duración estimada
   */
  async generateAudio(
    text: string,
    voiceId: string = DEFAULT_VOICE_ID,
    language: string = 'es'
  ): Promise<AudioSynthesisResult> {
    const cleanText = text?.trim();
    if (!cleanText) {
      throw new PipelineError(
        'El texto para la síntesis de voz no puede estar vacío.',
        'tts_generation',
        false
      );
    }

    const cleanLanguage = (language || 'es').toLowerCase();

    // Contingencia si no hay API Key configurada
    if (!this.isConfigured) {
      console.warn(
        '[ElevenLabsService] ELEVENLABS_API_KEY no configurada. Generando audio fallback simulado.'
      );
      return this.generateDevelopmentFallback(cleanText);
    }

    const endpoint = `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`;

    const payload = {
      text: cleanText,
      model_id: MANDATORY_MODEL_ID, // Requisito estricto eleven_multilingual_v2
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          parsedMessage = parsed.detail?.message || parsed.message || errorText;
        } catch {
          // Continuar
        }

        if (response.status === 401) {
          throw new PipelineError(
            'API Key de ElevenLabs inválida o no autorizada (401).',
            'tts_generation',
            false,
            { status: 401, errorText }
          );
        }

        if (response.status === 429 || response.status === 402) {
          throw new PipelineError(
            'Límite de caracteres o cuota de ElevenLabs agotada (429/402).',
            'tts_generation',
            true,
            { status: response.status, errorText }
          );
        }

        throw new PipelineError(
          `Error en ElevenLabs TTS (${response.status}): ${parsedMessage}`,
          'tts_generation',
          response.status >= 500,
          { status: response.status, errorText }
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Estimación de duración: ~15 caracteres por segundo en locución comercial
      const estimatedDurationSeconds = Math.max(2, Math.round(cleanText.length / 15));

      return {
        buffer,
        mimeType: 'audio/mpeg',
        sizeBytes: buffer.length,
        durationEstimatedSeconds: estimatedDurationSeconds,
      };
    } catch (err: any) {
      if (err instanceof PipelineError) throw err;
      throw new PipelineError(
        `Falla de red o conexión al contactar ElevenLabs: ${err.message}`,
        'tts_generation',
        true,
        err
      );
    }
  }

  // ===========================================================================
  // MÉTODOS DE COMPATIBILIDAD Y PERSISTENCIA
  // ===========================================================================
  /**
   * Método compatible con el pipeline legacy existente
   */
  async synthesizeSpeech(options: GenerateSpeechOptions): Promise<LegacyAudioSynthesisResult> {
    return this.generateAudio(
      options.text,
      options.voiceId || DEFAULT_VOICE_ID,
      'es'
    );
  }

  private async persistClonedVoiceLocally(
    voiceId: string,
    name: string,
    sampleCount: number,
    description?: string,
    labels?: Record<string, string>
  ): Promise<void> {
    const record: ClonedVoiceRecord = {
      id: voiceId,
      name,
      category: 'cloned',
      createdAt: new Date().toISOString(),
      description: description || 'Voz clonada personalizada vía Instant Voice Cloning',
      labels,
      samplesCount: sampleCount,
      supportedLanguages: ['es', 'en', 'pt'],
    };

    try {
      await saveStoredVoice(record);
    } catch (storageErr) {
      console.warn('[ElevenLabsService] No se pudo persistir la voz clonada en disco:', storageErr);
    }
  }

  private generateDevelopmentFallback(text: string): AudioSynthesisResult {
    // Cabecera MP3 ID3v2 dummy para testing seguro
    const dummyMp3Header = Buffer.from([
      0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0xff, 0xfb, 0x90, 0x64, 0x00,
    ]);
    const estimatedSeconds = Math.max(3, Math.round(text.length / 15));

    return {
      buffer: dummyMp3Header,
      mimeType: 'audio/mpeg',
      sizeBytes: dummyMp3Header.length,
      durationEstimatedSeconds: estimatedSeconds,
    };
  }
}

export const elevenLabsService = new ElevenLabsService();
