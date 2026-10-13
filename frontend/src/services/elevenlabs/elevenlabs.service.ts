import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from '@elevenlabs/elevenlabs-js';
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
import {
  saveStoredVoice,
  getStoredVoices,
  deleteStoredVoice,
  syncStoredVoices,
} from '@/lib/storage/voice-storage';
import {
  DEFAULT_ELEVEN_MODEL,
  buildApiVoiceSettings,
  getElevenModel,
  hasAudioTags,
  isKnownElevenModel,
  stripAudioTags,
} from '@/config/elevenlabs-models';

const ELEVENLABS_API_ORIGIN = 'https://api.elevenlabs.io';
const ELEVENLABS_BASE_URL = `${ELEVENLABS_API_ORIGIN}/v1`;
const FALLBACK_PREMADE_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (solo si no hay voz clonada configurada)
const ENV_MODEL_ID = process.env.ELEVENLABS_MODEL_ID?.trim();
const OUTPUT_FORMAT = 'mp3_44100_128';
/** Límite general; el de cada modelo está en config/elevenlabs-models.ts. */
export const ELEVENLABS_MAX_CHARS_PER_REQUEST = 10_000;

/** Modelo a usar: el pedido, el de .env.local o el predeterminado (el más barato con emoción). */
export function resolveElevenModelId(requested?: string | null): string {
  const r = requested?.trim();
  if (r) return r;
  if (ENV_MODEL_ID) return ENV_MODEL_ID;
  return DEFAULT_ELEVEN_MODEL;
}

/**
 * voice_id de la voz clonada del estudio. Se lee en servidor primero
 * (ELEVENLABS_VOICE_ID) y luego la variante pública para compatibilidad.
 */
export function getConfiguredVoiceId(): string | null {
  const id =
    process.env.ELEVENLABS_VOICE_ID?.trim() ||
    process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID?.trim() ||
    '';
  return id.length > 0 ? id : null;
}

export type ElevenLabsErrorCode =
  | 'not_configured'
  | 'auth'
  | 'quota_exceeded'
  | 'text_too_long'
  | 'voice_not_found'
  | 'invalid_input'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'unknown';

/** Error tipado de ElevenLabs: la UI usa `code` para mostrar el toast adecuado. */
export class ElevenLabsTTSError extends PipelineError {
  readonly code: ElevenLabsErrorCode;
  readonly httpStatus: number;

  constructor(message: string, code: ElevenLabsErrorCode, httpStatus: number, details?: unknown) {
    const retryable = code === 'rate_limited' || code === 'timeout' || code === 'network';
    super(message, 'tts_generation', retryable, details);
    this.name = 'ElevenLabsTTSError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Traduce las excepciones del SDK a mensajes claros en español. */
function mapSdkError(err: unknown): ElevenLabsTTSError {
  if (err instanceof ElevenLabsTTSError) return err;

  if (err instanceof ElevenLabsTimeoutError) {
    return new ElevenLabsTTSError(
      'ElevenLabs tardó demasiado en responder. Intenta de nuevo en unos segundos.',
      'timeout',
      504
    );
  }

  if (err instanceof ElevenLabsError) {
    const status = err.statusCode ?? 500;
    const body: any = err.body ?? {};
    const detail = body?.detail ?? {};
    const apiStatus: string = typeof detail === 'object' ? detail.status || '' : '';
    const apiMessage: string =
      (typeof detail === 'object' ? detail.message : typeof detail === 'string' ? detail : '') ||
      err.message;

    // ElevenLabs devuelve la cuota agotada como 401 con detail.status = "quota_exceeded"
    if (apiStatus === 'quota_exceeded' || status === 402) {
      return new ElevenLabsTTSError(
        'Cuota de caracteres de ElevenLabs agotada. Revisa tu plan o espera al siguiente ciclo de facturación.',
        'quota_exceeded',
        402,
        body
      );
    }
    if (status === 401 || status === 403) {
      return new ElevenLabsTTSError(
        'API Key de ElevenLabs inválida o sin permisos de Text-to-Speech. Revisa ELEVENLABS_API_KEY.',
        'auth',
        401,
        body
      );
    }
    if (apiStatus === 'voice_not_found' || status === 404) {
      return new ElevenLabsTTSError(
        'La voz clonada configurada no existe en tu cuenta de ElevenLabs. Revisa ELEVENLABS_VOICE_ID.',
        'voice_not_found',
        404,
        body
      );
    }
    if (apiStatus === 'max_character_limit_exceeded') {
      return new ElevenLabsTTSError(
        `El guion supera el límite de caracteres permitido por ElevenLabs: ${apiMessage}`,
        'text_too_long',
        400,
        body
      );
    }
    if (status === 429) {
      return new ElevenLabsTTSError(
        'Demasiadas peticiones simultáneas a ElevenLabs. Espera un momento y vuelve a renderizar.',
        'rate_limited',
        429,
        body
      );
    }
    if (status === 400 || status === 422) {
      return new ElevenLabsTTSError(
        `Parámetros inválidos para ElevenLabs: ${apiMessage}`,
        'invalid_input',
        400,
        body
      );
    }
    return new ElevenLabsTTSError(
      `Error de ElevenLabs (${status}): ${apiMessage}`,
      'unknown',
      status,
      body
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  return new ElevenLabsTTSError(
    `No se pudo contactar con ElevenLabs: ${message}`,
    'network',
    503,
    err
  );
}

export class ElevenLabsService {
  private apiKey: string;
  private client: ElevenLabsClient | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /** Cliente oficial del SDK, inicializado de forma perezosa con la API key del entorno. */
  private getClient(): ElevenLabsClient {
    if (!this.isConfigured) {
      throw new ElevenLabsTTSError(
        'ELEVENLABS_API_KEY no está configurada en frontend/.env.local. Añádela y reinicia el servidor.',
        'not_configured',
        500
      );
    }
    if (!this.client) {
      this.client = new ElevenLabsClient({
        apiKey: this.apiKey.trim(),
        baseUrl: ELEVENLABS_API_ORIGIN,
      });
    }
    return this.client;
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
  // FLUJO B: GENERACIÓN TEXT-TO-SPEECH (SDK: textToSpeech.convert)
  // ===========================================================================
  /**
   * Genera voz con el SDK oficial de ElevenLabs. El modelo y sus ajustes válidos
   * se definen en config/elevenlabs-models.ts.
   *
   * Utiliza de manera predeterminada la voz clonada configurada en el entorno
   * (ELEVENLABS_VOICE_ID) o la voz especificada por el usuario.
   *
   * @param text Guion o texto a locutar (máximo 10,000 caracteres)
   * @param voiceId ID de la voz (si se omite, usa la voz clonada de ELEVENLABS_VOICE_ID)
   * @param language Idioma objetivo ('es' | 'en' | 'pt', por defecto 'es')
   * @returns Buffer binario MP3 procesado listo para Cloudinary y metadatos
   */
  async generateAudio(
    text: string,
    voiceId?: string,
    language: string = 'es',
    modelId?: string,
    voiceSettings?: Partial<ElevenLabsVoiceSettings>
  ): Promise<AudioSynthesisResult> {
    const cleanText = text?.trim();
    if (!cleanText) {
      throw new ElevenLabsTTSError(
        'El texto para la síntesis de voz no puede estar vacío.',
        'invalid_input',
        400
      );
    }

    // Resolución del modelo: modelo seleccionado -> variable de entorno -> predeterminado
    const effectiveModelId = resolveElevenModelId(modelId);
    const spec = getElevenModel(effectiveModelId);

    // Los modelos sin etiquetas de emoción (v2, Flash) no deben recibir [excited], [sighs]…
    let textToSpeak = cleanText;
    let tagsRemoved = false;
    if (isKnownElevenModel(effectiveModelId) && !spec.audioTags && hasAudioTags(cleanText)) {
      textToSpeak = stripAudioTags(cleanText);
      tagsRemoved = true;
    }

    const charLimit = isKnownElevenModel(effectiveModelId) ? spec.charLimit : ELEVENLABS_MAX_CHARS_PER_REQUEST;
    if (textToSpeak.length > charLimit) {
      throw new ElevenLabsTTSError(
        `El guion supera el límite de ${charLimit.toLocaleString()} caracteres de ${isKnownElevenModel(effectiveModelId) ? spec.name : effectiveModelId} (actual: ${textToSpeak.length.toLocaleString()}).`,
        'text_too_long',
        400
      );
    }

    // Sin API Key, rechazar de inmediato de forma explícita (sin audios falsos ni fallbacks silenciosos)
    if (!this.isConfigured) {
      throw new ElevenLabsTTSError(
        'ELEVENLABS_API_KEY no está configurada en frontend/.env.local. Configúrala para generar voz neuronal con tu voz clonada.',
        'not_configured',
        500
      );
    }

    // Resolución de la voz: voz solicitada -> voz clonada configurada -> fallback predeterminado
    const configuredVoice = getConfiguredVoiceId();
    const effectiveVoiceId =
      (voiceId && voiceId.trim().length > 0 ? voiceId.trim() : null) ||
      configuredVoice ||
      FALLBACK_PREMADE_VOICE_ID;

    // Solo se envían los ajustes que admite el modelo (v4: estabilidad + similitud; v3: solo estabilidad…)
    const effectiveSettings = buildApiVoiceSettings(effectiveModelId, voiceSettings ?? {});

    try {
      const client = this.getClient();

      // Invocación a través del SDK oficial de ElevenLabs con modelo dinámico y parámetros de síntesis
      const audioStream = await client.textToSpeech.convert(effectiveVoiceId, {
        text: textToSpeak,
        modelId: effectiveModelId,
        outputFormat: OUTPUT_FORMAT,
        voiceSettings: effectiveSettings,
      });

      // Transformación segura de ReadableStream<Uint8Array> a Node Buffer
      const arrayBuffer = await new Response(audioStream as any).arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!buffer || buffer.length === 0) {
        throw new ElevenLabsTTSError(
          'ElevenLabs retornó un flujo de audio vacío.',
          'unknown',
          500
        );
      }

      // Estimación de duración de locución en español (~14-16 caracteres/segundo)
      const estimatedDurationSeconds = Math.max(2, Math.round(textToSpeak.length / 15));

      return {
        buffer,
        mimeType: 'audio/mpeg',
        sizeBytes: buffer.length,
        durationEstimatedSeconds: estimatedDurationSeconds,
        modelId: effectiveModelId,
        charactersBilled: textToSpeak.length,
        tagsRemoved,
      };
    } catch (err: any) {
      throw mapSdkError(err);
    }
  }

  /**
   * Obtiene la información de la voz clonada principal configurada en el entorno
   */
  async getConfiguredVoiceMetadata(): Promise<{
    id: string;
    name: string;
    isCloned: boolean;
  } | null> {
    const voiceId = getConfiguredVoiceId();
    if (!voiceId) return null;

    if (!this.isConfigured) {
      return { id: voiceId, name: 'Mi Voz Clonada (Configurada)', isCloned: true };
    }

    try {
      const client = this.getClient();
      const voice = await client.voices.get(voiceId);
      return {
        id: voiceId,
        name: voice.name || 'Mi Voz Clonada',
        isCloned: voice.category === 'cloned' || voice.category === 'generated',
      };
    } catch {
      return { id: voiceId, name: 'Mi Voz Clonada (Personalizada)', isCloned: true };
    }
  }

  /**
   * Elimina una voz clonada tanto en la API oficial de ElevenLabs como en el almacenamiento local.
   * Valida errores de existencia para garantizar limpieza idempotente.
   *
   * @param voiceId ID de la voz a eliminar
   */
  async deleteVoice(voiceId: string): Promise<{ success: boolean; message: string }> {
    if (!voiceId || !voiceId.trim()) {
      throw new PipelineError('El voice_id es obligatorio para eliminar.', 'voice_cloning', false);
    }

    const id = voiceId.trim();

    // 1. Eliminar en la API oficial de ElevenLabs si está configurada
    if (this.isConfigured) {
      try {
        const client = this.getClient();
        await client.voices.delete(id);
      } catch (apiErr: any) {
        const status = apiErr?.statusCode || apiErr?.status;
        // Si el estado es 404, la voz ya no existía en ElevenLabs, lo cual es aceptable
        if (status !== 404) {
          console.warn(
            `[ElevenLabsService] Advertencia al eliminar voz remota (${status}):`,
            apiErr?.message
          );
        }
      }
    }

    // 2. Eliminar del almacenamiento local (cloned_voices.json)
    const localRemoved = await deleteStoredVoice(id);

    return {
      success: true,
      message: localRemoved
        ? 'Voz eliminada correctamente de ElevenLabs y almacenamiento local.'
        : 'Voz eliminada en ElevenLabs.',
    };
  }

  /**
   * Sincroniza la lista de voces locales con la API de ElevenLabs:
   * 1. Consulta las voces reales en ElevenLabs.
   * 2. Purga del almacenamiento local (cloned_voices.json) cualquier voz fantasma que haya sido borrada en la web.
   * 3. Descubre e incorpora nuevas voces clonadas generadas externamente.
   */
  async syncAndGetVoices(): Promise<{ storedVoices: ClonedVoiceRecord[]; remoteCount?: number }> {
    if (!this.isConfigured) {
      const local = await getStoredVoices();
      return { storedVoices: local };
    }

    try {
      const client = this.getClient();
      const remoteRes = await client.voices.getAll();
      const remoteVoices: any[] = (remoteRes as any)?.voices || [];

      // Extraer todas las IDs válidas presentes en la cuenta de ElevenLabs
      const validRemoteIds = new Set<string>(
        remoteVoices.map((v: any) => v.voice_id || v.id).filter(Boolean)
      );

      // Purgar de inmediato registros fantasma locales que ya no existan en ElevenLabs
      await syncStoredVoices(validRemoteIds);

      // Sincronizar hacia local cualquier voz clonada presente en ElevenLabs
      const currentLocal = await getStoredVoices();
      const localIds = new Set(currentLocal.map((v) => v.id));

      for (const rv of remoteVoices) {
        const vId = rv.voice_id || rv.id;
        if (
          vId &&
          (rv.category === 'cloned' || rv.category === 'generated') &&
          !localIds.has(vId)
        ) {
          await saveStoredVoice({
            id: vId,
            name: rv.name || 'Voz Clonada',
            category: 'cloned',
            createdAt: new Date().toISOString(),
            description: rv.description || 'Sincronizada directamente de ElevenLabs',
            samplesCount: rv.samples?.length || 1,
            supportedLanguages: ['es', 'en', 'pt'],
          });
        }
      }

      const refreshed = await getStoredVoices();
      return { storedVoices: refreshed, remoteCount: remoteVoices.length };
    } catch (err: any) {
      console.warn(
        '[ElevenLabsService] No se pudo conectar para sincronizar con ElevenLabs, usando caché local:',
        err?.message
      );
      const fallback = await getStoredVoices();
      return { storedVoices: fallback };
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
      options.voiceId,
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
}

export const elevenLabsService = new ElevenLabsService();
