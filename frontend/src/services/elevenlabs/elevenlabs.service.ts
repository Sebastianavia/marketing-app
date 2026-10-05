import {
  GenerateSpeechOptions,
  AudioSynthesisResult,
  PipelineError,
} from '@/types/pipeline.types';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (Natural / Conversational)
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

export class ElevenLabsService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Sintetiza texto en audio MP3 de alta fidelidad neuronal.
   * Retorna un Buffer en memoria listo para ser transferido a Cloudflare R2 / S3.
   */
  async synthesizeSpeech(options: GenerateSpeechOptions): Promise<AudioSynthesisResult> {
    const text = options.text?.trim();
    if (!text) {
      throw new PipelineError(
        'El texto para la síntesis de voz no puede estar vacío.',
        'tts_generation',
        false
      );
    }

    const voiceId = options.voiceId || DEFAULT_VOICE_ID;
    const modelId = options.modelId || DEFAULT_MODEL_ID;

    // Si la clave no está configurada, proporcionar fallback de desarrollo controlado
    if (!this.isConfigured) {
      console.warn(
        '[ElevenLabsService] ELEVENLABS_API_KEY no configurada. Generando buffer simulado para desarrollo.'
      );
      return this.generateDevelopmentFallback(text);
    }

    const endpoint = `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: options.voiceSettings?.stability ?? 0.5,
            similarity_boost: options.voiceSettings?.similarity_boost ?? 0.75,
            style: options.voiceSettings?.style ?? 0.0,
            use_speaker_boost: options.voiceSettings?.use_speaker_boost ?? true,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedMessage = errorText;
        try {
          const parsed = JSON.parse(errorText);
          parsedMessage = parsed.detail?.message || parsed.message || errorText;
        } catch {
          // Mantener errorText original
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
          `Error en ElevenLabs API (${response.status}): ${parsedMessage}`,
          'tts_generation',
          response.status >= 500,
          { status: response.status, errorText }
        );
      }

      // Convertir ArrayBuffer de la respuesta a Node.js Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Estimación de duración: promedio de 15 caracteres por segundo en español
      const estimatedDurationSeconds = Math.max(2, Math.round(text.length / 15));

      return {
        buffer,
        mimeType: 'audio/mpeg',
        sizeBytes: buffer.length,
        durationEstimatedSeconds: estimatedDurationSeconds,
      };
    } catch (err: any) {
      if (err instanceof PipelineError) {
        throw err;
      }
      throw new PipelineError(
        `Falla de red o conexión al contactar ElevenLabs: ${err.message}`,
        'tts_generation',
        true,
        err
      );
    }
  }

  /**
   * Generador de contingencia para pruebas locales y CI/CD sin gastar créditos.
   */
  private generateDevelopmentFallback(text: string): AudioSynthesisResult {
    // Generar un payload binario mínimo válido (Cabecera MP3 ID3v2 dummy)
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
