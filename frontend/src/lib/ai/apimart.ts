/**
 * Cliente de Integración para ApiMart (https://docs.apimart.ai/es)
 * Orquestación de modelos de video como MiniMax-Hailuo-2.3, Kling v3 Omni y Seedance 2.0
 */

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

const APIMART_BASE_URL = process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';

export class ApiMartClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.APIMART_API_KEY || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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

    const response = await fetch(`${APIMART_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: payload.model,
        prompt: payload.prompt,
        duration: payload.durationSeconds || 5,
        aspect_ratio: payload.aspectRatio || '9:16',
        image_url: payload.firstFrameImageUrl,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Error de ApiMart (${response.status}): ${errBody}`);
    }

    const data = await response.json();
    return {
      taskId: data.id || data.task_id,
      status: 'processing',
      estimatedCostCredits: data.credits_used,
    };
  }

  /**
   * Consulta el estado de la tarea de video en ApiMart
   */
  async checkTaskStatus(taskId: string): Promise<ApiMartTaskResponse> {
    if (!this.isConfigured) {
      throw new Error('APIMART_API_KEY no configurada.');
    }

    const response = await fetch(`${APIMART_BASE_URL}/videos/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando tarea en ApiMart: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      taskId,
      status: data.status,
      videoUrl: data.output?.video_url || data.video_url,
      error: data.error,
    };
  }
}
