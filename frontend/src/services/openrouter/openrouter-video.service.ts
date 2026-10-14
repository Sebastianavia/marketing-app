import {
  OpenRouterVideoGenerationParams,
  OpenRouterVideoTask,
  PollingConfig,
  PipelineError,
} from '@/types/pipeline.types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'heygen/avatar-iv';
const DEFAULT_POLL_INTERVAL_MS = 3500;
const DEFAULT_TIMEOUT_MS = 360000; // 6 minutos máximo

export class OpenRouterVideoService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Módulo Profundo (Deep Module): Despacha y sondea la generación del video
   * de principio a fin en una sola llamada de alta palanca, encapsulando
   * validación, despacho y polling con control de progreso.
   */
  async renderVideo(
    params: OpenRouterVideoGenerationParams,
    config: PollingConfig = {}
  ): Promise<OpenRouterVideoTask> {
    const task = await this.createVideoTask(params);
    return this.pollVideoUntilCompletion(task.taskId, config);
  }

  /**
   * Despacha la orden de generación de video con Lip-Sync a OpenRouter
   * utilizando el modelo heygen/avatar-iv.
   */
  /**
   * POST /videos. Si se enviaron parámetros propios del proveedor (provider.options) y
   * OpenRouter responde 400, se reintenta una vez sin ellos para no perder el render.
   */
  private async postVideo(payload: Record<string, unknown>): Promise<{ taskId: string; droppedOptions: boolean }> {
    const send = (body: Record<string, unknown>) =>
      fetch(`${OPENROUTER_BASE_URL}/videos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Lulo Studio Desktop - Render Engine',
        },
        body: JSON.stringify(body),
      });

    let response = await send(payload);
    let droppedOptions = false;
    if (response.status === 400 && payload.provider) {
      const { provider: _omit, ...rest } = payload;
      void _omit;
      console.warn('[OpenRouter] Parámetros del proveedor rechazados; se reintenta sin ellos.');
      response = await send(rest);
      droppedOptions = true;
    }
    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const parsed = JSON.parse(errorText);
        message = parsed.error?.message || parsed.message || errorText;
      } catch {
        // Mantener errorText
      }
      if (response.status === 401 || response.status === 403) {
        throw new PipelineError(
          `La clave de OpenRouter no es válida o expiró (${message}). Crea una nueva en openrouter.ai → Keys, ponla en OPENROUTER_API_KEY de frontend/.env.local y reinicia la app. No se cobró nada.`,
          'video_dispatch',
          false,
          { status: response.status, auth: true }
        );
      }
      if (response.status === 402) {
        throw new PipelineError(
          `OpenRouter no tiene saldo suficiente (${message}). Recarga créditos en openrouter.ai y vuelve a intentarlo.`,
          'video_dispatch',
          false,
          { status: 402, auth: true }
        );
      }
      throw new PipelineError(
        `OpenRouter rechazó el video (${response.status}): ${message}`,
        'video_dispatch',
        response.status >= 500,
        { status: response.status }
      );
    }
    const data = await response.json();
    const taskId = data.id || data.task_id || data.data?.id;
    if (!taskId) throw new PipelineError('OpenRouter no devolvió el id del video.', 'video_dispatch', false, data);
    return { taskId, droppedOptions };
  }

  /**
   * Imagen→video (tomas de apoyo / B-roll). Formato de OpenRouter:
   * frame_images = [{ type: 'image_url', image_url: { url }, frame_type: 'first_frame' }].
   * Sin audio: la voz la pone ElevenLabs encima.
   */
  async createImageToVideoTask(params: {
    model: string;
    prompt: string;
    frameImageUrl: string;
    durationSec: number;
    aspectRatio: string;
    resolution?: string;
    /** true = el modelo genera su propia voz y sonido. */
    generateAudio?: boolean;
  }): Promise<OpenRouterVideoTask> {
    if (!this.isConfigured) {
      throw new PipelineError('Falta OPENROUTER_API_KEY en .env.local: no se puede generar el video.', 'video_dispatch', false);
    }
    if (params.frameImageUrl && !/^https?:\/\//i.test(params.frameImageUrl)) {
      throw new PipelineError('La imagen de la escena debe ser una URL pública (https).', 'video_dispatch', false);
    }
    // Sin imagen = texto→video, solo con la descripción de la toma
    const payload: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      ...(params.frameImageUrl
        ? { frame_images: [{ type: 'image_url', image_url: { url: params.frameImageUrl.trim() }, frame_type: 'first_frame' }] }
        : {}),
      duration: params.durationSec,
      aspect_ratio: params.aspectRatio,
      generate_audio: Boolean(params.generateAudio),
    };
    if (params.resolution) payload.resolution = params.resolution;
    // Veo (Vertex): permitir personas adultas en la imagen (passthrough documentado "personGeneration")
    if (params.model.startsWith('google/veo')) {
      payload.provider = { options: { 'google-vertex': { parameters: { personGeneration: 'allow_adult' } } } };
    }
    const { taskId } = await this.postVideo(payload);
    return { taskId, status: 'pending', progressPercent: 5, createdAt: Date.now(), updatedAt: Date.now() };
  }

  async createVideoTask(params: OpenRouterVideoGenerationParams): Promise<OpenRouterVideoTask> {
    const { model = DEFAULT_MODEL, imageUrl, audioUrl, aspectRatio = '9:16', motionPrompt, expressiveness } = params;

    const isValidUrl = (v: unknown): v is string =>
      typeof v === 'string' && /^https?:\/\//i.test(v.trim());

    if (!isValidUrl(imageUrl) || !isValidUrl(audioUrl)) {
      throw new PipelineError(
        'imageUrl y audioUrl deben ser URLs públicas válidas (https) para heygen/avatar-iv.',
        'video_dispatch',
        false,
        { imageUrl, audioUrl }
      );
    }

    if (!this.isConfigured) {
      // Sin clave no se simula nada: un video de muestra haría creer que el render funcionó.
      throw new PipelineError(
        'Falta OPENROUTER_API_KEY en .env.local: no se puede generar el video.',
        'video_dispatch',
        false
      );
    }

    // El payload solo se construye cuando ambas URLs son strings válidos.
    // OpenRouter exige que image_url / audio_url sean OBJETOS con la clave `url`.
    const payload: Record<string, unknown> = {
      model,
      input_references: [
        { type: 'image_url', image_url: { url: imageUrl.trim() } },
        { type: 'audio_url', audio_url: { url: audioUrl.trim() } },
      ],
      aspect_ratio: aspectRatio,
    };
    // Parámetros propios de HeyGen (allowed_passthrough_parameters del catálogo de OpenRouter):
    // motion_prompt = movimiento del cuerpo y gestos · expressiveness = high | medium | low
    const heygen: Record<string, unknown> = {};
    if (motionPrompt?.trim()) heygen.motion_prompt = motionPrompt.trim().slice(0, 500);
    if (expressiveness) heygen.expressiveness = expressiveness;
    if (Object.keys(heygen).length) payload.provider = { options: { heygen: { parameters: heygen } } };

    try {
      const { taskId } = await this.postVideo(payload);
      return {
        taskId,
        status: 'pending',
        progressPercent: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } catch (err: any) {
      if (err instanceof PipelineError) throw err;
      throw new PipelineError(
        `Error de red conectando con OpenRouter: ${err.message}`,
        'video_dispatch',
        true,
        err
      );
    }
  }

  /**
   * Realiza polling continuo no-bloqueante hasta obtener el MP4 final
   * o alcanzar el timeout de seguridad (6 minutos).
   */
  async pollVideoUntilCompletion(
    taskId: string,
    config: PollingConfig = {}
  ): Promise<OpenRouterVideoTask> {
    const intervalMs = config.intervalMs || DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    // MODO DESARROLLO SIMULADO: si la tarea es de prueba
    if (taskId.startsWith('mock_task_')) {
      return this.simulateTaskPolling(taskId, config);
    }

    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (true) {
      const elapsedMs = Date.now() - startTime;
      const elapsedSeconds = Math.round(elapsedMs / 1000);

      // 1. Timeout Guard
      if (elapsedMs > timeoutMs) {
        throw new PipelineError(
          `Timeout de renderizado superado (${Math.round(timeoutMs / 60000)} minutos). HeyGen tardó demasiado en procesar.`,
          'video_polling',
          true,
          { taskId, elapsedSeconds }
        );
      }

      try {
        const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${taskId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
        });

        if (!response.ok) {
          consecutiveErrors++;
          console.warn(
            `[OpenRouterVideoService] Polling HTTP error ${response.status} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`
          );

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw new PipelineError(
              `Error reiterado al consultar estado de video en OpenRouter (HTTP ${response.status})`,
              'video_polling',
              true
            );
          }

          // Esperar con jitter antes de reintentar
          await this.delay(intervalMs + Math.random() * 1000);
          continue;
        }

        consecutiveErrors = 0;
        const data = await response.json();
        console.log('[Polling check]:', JSON.stringify(data, null, 2));

        const taskData = data.data || data;
        const status = (taskData.status || taskData.state || '').toLowerCase();
        const videoUrl =
          taskData.video_url ||
          taskData.url ||
          taskData.output ||
          taskData.result?.url ||
          taskData.output?.video_url;

        const isFinished =
          ['completed', 'succeeded', 'success', 'done'].includes(status) || Boolean(videoUrl);

        // 2. Resolución Inmediata: Estado Completado o URL detectada
        if (isFinished && videoUrl) {
          const finalTask: OpenRouterVideoTask = {
            taskId,
            status: 'completed',
            videoUrl: typeof videoUrl === 'string' ? videoUrl : (taskData.output?.video_url || taskData.video_url),
            progressPercent: 100,
            createdAt: startTime,
            updatedAt: Date.now(),
          };

          config.onProgress?.(finalTask, elapsedSeconds);
          return finalTask;
        }

        // 3. Manejo de Errores del Proveedor (failed, error, canceled)
        if (['failed', 'error', 'canceled'].includes(status)) {
          const errorDetail =
            taskData.error?.message ||
            taskData.error ||
            taskData.message ||
            'El proveedor reportó un fallo durante la generación del video.';
          throw new PipelineError(
            `El renderizado de video falló en el proveedor (${status}): ${errorDetail}`,
            'video_polling',
            false,
            taskData
          );
        }

        // 4. Estado: PROCESANDO / PENDIENTE
        // Calcular porcentaje progresivo estimado para feedback visual en la UI
        const estimatedProgress = Math.min(95, 10 + Math.round((elapsedMs / (90000)) * 85));

        const currentTask: OpenRouterVideoTask = {
          taskId,
          status: 'processing',
          progressPercent: taskData.progress || estimatedProgress,
          createdAt: startTime,
          updatedAt: Date.now(),
        };

        config.onProgress?.(currentTask, elapsedSeconds);
      } catch (pollErr: any) {
        if (pollErr instanceof PipelineError) throw pollErr;

        consecutiveErrors++;
        console.warn(
          `[OpenRouterVideoService] Error transitorio en polling: ${pollErr.message} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`
        );

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new PipelineError(
            `Se interrumpió la conexión durante el renderizado del video: ${pollErr.message}`,
            'video_polling',
            true,
            pollErr
          );
        }
      }

      // Esperar antes del siguiente ciclo
      await this.delay(intervalMs);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createMockTask(model: string): OpenRouterVideoTask {
    return {
      taskId: `mock_task_${Date.now()}`,
      status: 'pending',
      progressPercent: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private async simulateTaskPolling(
    taskId: string,
    config: PollingConfig
  ): Promise<OpenRouterVideoTask> {
    const steps = [
      { progress: 20, delay: 2500 },
      { progress: 50, delay: 3000 },
      { progress: 80, delay: 3500 },
      { progress: 100, delay: 2000 },
    ];

    let elapsed = 0;
    for (const s of steps) {
      await this.delay(s.delay);
      elapsed += Math.round(s.delay / 1000);

      const task: OpenRouterVideoTask = {
        taskId,
        status: s.progress === 100 ? 'completed' : 'processing',
        progressPercent: s.progress,
        videoUrl:
          s.progress === 100
            ? 'https://cdn.pixabay.com/video/2020/09/25/51139-464303494_large.mp4'
            : undefined,
        createdAt: Date.now() - elapsed * 1000,
        updatedAt: Date.now(),
      };

      config.onProgress?.(task, elapsed);

      if (s.progress === 100) {
        return task;
      }
    }

    return {
      taskId,
      status: 'completed',
      videoUrl: 'https://cdn.pixabay.com/video/2020/09/25/51139-464303494_large.mp4',
      progressPercent: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}
