import {
  HeyGenAvatar,
  HeyGenGenerateVideoPayload,
  HeyGenGenerateVideoResponse,
  HeyGenVideoStatusResponse,
  HeyGenUploadAssetResponse,
} from '@/types/heygen.types';

export class HeyGenApiError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode: number = 500, details?: unknown) {
    super(message);
    this.name = 'HeyGenApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface PollingOptions {
  intervalMs?: number;      // Tiempo entre consultas (default 5000ms)
  timeoutMs?: number;       // Tiempo límite de espera (default 10 min)
  onProgress?: (status: HeyGenVideoStatusResponse['data']) => void;
  signal?: AbortSignal;     // Cancelación voluntaria
}

/**
 * Servicio HeyGen (Server-Side Only)
 * Encapsula la comunicación con la API v1/v2 de HeyGen garantizando
 * que la API Key nunca se filtre al frontend del cliente.
 */
export class HeyGenService {
  private readonly baseUrl = 'https://api.heygen.com';
  private readonly apiKeyOverride?: string;

  constructor(apiKey?: string) {
    this.apiKeyOverride = apiKey;
  }

  private getApiKey(): string {
    const key = this.apiKeyOverride || process.env.HEYGEN_API_KEY;
    if (!key) {
      throw new HeyGenApiError(
        'HEYGEN_API_KEY no está configurada en las variables de entorno del servidor.',
        401
      );
    }
    return key;
  }

  private getHeaders(): HeadersInit {
    return {
      'X-Api-Key': this.getApiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Obtiene el listado de avatares disponibles en la cuenta.
   */
  async listAvatars(): Promise<HeyGenAvatar[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/avatars`, {
        method: 'GET',
        headers: this.getHeaders(),
        next: { revalidate: 3600 }, // Cache en Next.js por 1 hora
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new HeyGenApiError(
          `Error obteniendo avatares de HeyGen: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const resJson = await response.json();
      return resJson.data?.avatars || [];
    } catch (error) {
      if (error instanceof HeyGenApiError) throw error;
      throw new HeyGenApiError(
        `Fallo de conexión al listar avatares: ${(error as Error).message}`,
        500
      );
    }
  }

  /**
   * Sube una imagen estática para usarla como "Talking Photo".
   */
  async uploadTalkingPhoto(
    imageBuffer: Uint8Array | ArrayBuffer | Blob,
    mimeType: string = 'image/jpeg'
  ): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/asset`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.getApiKey(),
          'Content-Type': mimeType,
        },
        body: imageBuffer as unknown as BodyInit,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new HeyGenApiError(
          `Error subiendo asset a HeyGen: ${response.statusText}`,
          response.status,
          errJson
        );
      }

      const resJson: HeyGenUploadAssetResponse = await response.json();
      return resJson.data.id;
    } catch (error) {
      if (error instanceof HeyGenApiError) throw error;
      throw new HeyGenApiError(
        `Fallo al subir Talking Photo: ${(error as Error).message}`,
        500
      );
    }
  }

  /**
   * Envía el payload para renderizar un video con Avatar o Talking Photo.
   */
  async generateAvatarVideo(
    payload: HeyGenGenerateVideoPayload
  ): Promise<HeyGenGenerateVideoResponse['data']> {
    try {
      // Valores por defecto seguros para formato vertical 9:16 (TikTok/Reels/Shorts)
      const sanitizedPayload: HeyGenGenerateVideoPayload = {
        title: payload.title || `Marketing_Ad_${Date.now()}`,
        video_inputs: payload.video_inputs,
        dimension: payload.dimension || { width: 1080, height: 1920 },
        aspect_ratio: payload.aspect_ratio || '9:16',
        test: payload.test ?? false,
      };

      const response = await fetch(`${this.baseUrl}/v2/video/generate`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(sanitizedPayload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new HeyGenApiError(
          `HeyGen rechazó la solicitud de generación: ${errorBody?.message || response.statusText}`,
          response.status,
          errorBody
        );
      }

      const resJson: HeyGenGenerateVideoResponse = await response.json();
      if (!resJson.data?.video_id) {
        throw new HeyGenApiError('Respuesta de HeyGen no incluyó video_id válido.', 502, resJson);
      }

      return resJson.data;
    } catch (error) {
      if (error instanceof HeyGenApiError) throw error;
      throw new HeyGenApiError(
        `Fallo inesperado al generar video: ${(error as Error).message}`,
        500
      );
    }
  }

  /**
   * Consulta el estado actual de renderizado del video.
   */
  async getVideoStatus(videoId: string): Promise<HeyGenVideoStatusResponse['data']> {
    if (!videoId) {
      throw new HeyGenApiError('Parámetro videoId es requerido.', 400);
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
          cache: 'no-store', // Estado en tiempo real, sin cache
        }
      );

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new HeyGenApiError(
          `Error consultando estado de video ${videoId}: ${response.statusText}`,
          response.status,
          errJson
        );
      }

      const resJson: HeyGenVideoStatusResponse = await response.json();
      return resJson.data;
    } catch (error) {
      if (error instanceof HeyGenApiError) throw error;
      throw new HeyGenApiError(
        `Fallo al consultar status de video: ${(error as Error).message}`,
        500
      );
    }
  }

  /**
   * Lógica robusta de Polling asíncrono con control de tiempo límite y cancelación.
   */
  async pollVideoUntilComplete(
    videoId: string,
    options: PollingOptions = {}
  ): Promise<HeyGenVideoStatusResponse['data']> {
    const {
      intervalMs = 5000,
      timeoutMs = 600000, // 10 minutos máximo
      onProgress,
      signal,
    } = options;

    const startTime = Date.now();

    while (true) {
      if (signal?.aborted) {
        throw new HeyGenApiError('La espera de renderizado fue cancelada por el cliente.', 499);
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new HeyGenApiError(
          `Tiempo de espera excedido (${timeoutMs / 1000}s) para el video ${videoId}.`,
          408
        );
      }

      const statusData = await this.getVideoStatus(videoId);

      if (onProgress) {
        onProgress(statusData);
      }

      if (statusData.status === 'completed') {
        return statusData;
      }

      if (statusData.status === 'failed') {
        throw new HeyGenApiError(
          `El renderizado de HeyGen falló: ${statusData.error?.message || 'Error desconocido'}`,
          500,
          statusData.error
        );
      }

      // Esperar antes del siguiente ciclo
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new HeyGenApiError('Operación abortada durante polling.', 499));
          });
        }
      });
    }
  }
}

// Instancia singleton para uso en Server Actions o API Routes
export const heygenService = new HeyGenService();
