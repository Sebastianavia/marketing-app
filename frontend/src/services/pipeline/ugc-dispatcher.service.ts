import {
  AIModelConfig,
  getModelById,
  DEFAULT_UGC_MODEL,
} from '@/config/ugc-models.config';
import { ApiMartClient } from '@/lib/ai/apimart';
import { OpenRouterVideoService } from '../openrouter/openrouter-video.service';
import { PipelineError } from '@/types/pipeline.types';

export interface UgcDispatchRequest {
  modelId: string;
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  firstFrameImageUrl?: string;
  audioUrl?: string;
  customApiMartKey?: string;
  customOpenRouterKey?: string;
}

export interface UgcStandardizedResponse {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  pollingUrl: string;
  provider: 'apimart' | 'openrouter';
  modelId: string;
  estimatedCostUSD: number;
  videoUrl?: string;
  message?: string;
}

export class UgcDispatcherService {
  /**
   * Enruta la solicitud de renderizado al backend correspondiente según la propiedad `provider`
   * estandarizando la respuesta al contrato { taskId, status, pollingUrl }.
   */
  async dispatch(request: UgcDispatchRequest): Promise<UgcStandardizedResponse> {
    const {
      modelId,
      prompt,
      durationSeconds = 30,
      aspectRatio = '9:16',
      firstFrameImageUrl,
      audioUrl,
      customApiMartKey,
      customOpenRouterKey,
    } = request;

    if (!prompt || !prompt.trim()) {
      throw new PipelineError(
        'El prompt o guion es obligatorio para despachar la generación UGC.',
        'video_dispatch',
        false
      );
    }

    const modelConfig: AIModelConfig = getModelById(modelId) || {
      ...DEFAULT_UGC_MODEL,
      id: modelId,
    };

    const estimatedCostUSD = Number(
      (durationSeconds * modelConfig.costPerSecondUSD).toFixed(4)
    );

    // =========================================================================
    // ENRUTAMIENTO 1: APIMART (MiniMax-Hailuo-2.3, Kling v3 Omni, Seedance 2.0)
    // =========================================================================
    if (modelConfig.provider === 'apimart') {
      const apiKey = customApiMartKey || process.env.APIMART_API_KEY || '';
      const client = new ApiMartClient(apiKey);

      if (!client.isConfigured) {
        // Fallback de desarrollo controlado si la llave no está presente
        const simulatedTaskId = `apimart_task_${Date.now()}`;
        return {
          taskId: simulatedTaskId,
          status: 'processing',
          pollingUrl: `/api/apimart/status/${simulatedTaskId}`,
          provider: 'apimart',
          modelId: modelConfig.id,
          estimatedCostUSD,
          message:
            'Modo preparación APIMart (Configura APIMART_API_KEY para despachar a producción).',
        };
      }

      try {
        // Acotar la duración enviada a la API al rango oficial soportado (evita error HTTP 400 por exceder límites)
        const sanitizedDuration = Math.min(
          Math.max(durationSeconds, modelConfig.apiMinDurationSeconds),
          modelConfig.apiMaxClipDurationSeconds
        );

        const task = await client.generateVideo({
          model: modelConfig.id,
          prompt,
          durationSeconds: sanitizedDuration,
          aspectRatio,
          firstFrameImageUrl,
        });

        return {
          taskId: task.taskId,
          status: task.status || 'processing',
          pollingUrl: `/api/apimart/status/${task.taskId}`,
          provider: 'apimart',
          modelId: modelConfig.id,
          estimatedCostUSD,
          videoUrl: task.videoUrl,
        };
      } catch (err: any) {
        throw new PipelineError(
          `Fallo en despacho hacia APIMart (${modelConfig.name}): ${err.message}`,
          'video_dispatch',
          true,
          err
        );
      }
    }

    // =========================================================================
    // ENRUTAMIENTO 2: OPENROUTER (Seedance 1.5 Pro, Seedance 2.0 Fast, Wan 2.6)
    // =========================================================================
    if (modelConfig.provider === 'openrouter') {
      const apiKey = customOpenRouterKey || process.env.OPENROUTER_API_KEY || '';
      const openRouterService = new OpenRouterVideoService(apiKey);

      try {
        // Despacho a endpoint OpenRouter Videos
        const task = await openRouterService.createVideoTask({
          model: modelConfig.id,
          imageUrl: firstFrameImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800',
          audioUrl: audioUrl || 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
          aspectRatio: aspectRatio === '1:1' ? '9:16' : aspectRatio,
          prompt,
        });

        return {
          taskId: task.taskId,
          status: task.status || 'processing',
          pollingUrl: `/api/pipeline/status/${task.taskId}`,
          provider: 'openrouter',
          modelId: modelConfig.id,
          estimatedCostUSD,
          videoUrl: task.videoUrl,
        };
      } catch (err: any) {
        throw new PipelineError(
          `Fallo en despacho hacia OpenRouter (${modelConfig.name}): ${err.message}`,
          'video_dispatch',
          true,
          err
        );
      }
    }

    throw new PipelineError(
      `Proveedor no soportado: ${(modelConfig as any).provider}`,
      'video_dispatch',
      false
    );
  }
}

export const ugcDispatcherService = new UgcDispatcherService();
