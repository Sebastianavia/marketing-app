import { ElevenLabsService } from '../elevenlabs/elevenlabs.service';
import { CloudinaryStorageService, cloudinaryStorageService } from '../storage/cloudinary.service';
import { OpenRouterVideoService } from '../openrouter/openrouter-video.service';
import {
  UgcPipelineExecutionInput,
  UgcPipelineProgressEvent,
  UgcPipelineFinalResult,
  PipelineError,
  PipelinePhase,
} from '@/types/pipeline.types';
import { saveProject } from '@/lib/storage/project-storage';

export type PipelineProgressCallback = (event: UgcPipelineProgressEvent) => void;

export class UgcPipelineMasterOrchestrator {
  private elevenLabsService: ElevenLabsService;
  private cloudinaryService: CloudinaryStorageService;
  private openRouterService: OpenRouterVideoService;

  constructor(customKeys?: {
    elevenLabsKey?: string;
    openRouterKey?: string;
  }) {
    this.elevenLabsService = new ElevenLabsService(customKeys?.elevenLabsKey);
    this.cloudinaryService = cloudinaryStorageService;
    this.openRouterService = new OpenRouterVideoService(customKeys?.openRouterKey);
  }

  /**
   * Ejecuta el pipeline completo de renderizado:
   * 1. ElevenLabs TTS -> Buffer MP3
   * 2. Cloudflare R2 / S3 -> audio_url pública
   * 3. OpenRouter / HeyGen avatar-iv -> taskId
   * 4. Polling continuo no-bloqueante hasta obtener MP4
   * 5. Almacenamiento local del proyecto en disco
   */
  async executePipeline(
    input: UgcPipelineExecutionInput,
    onProgress?: PipelineProgressCallback
  ): Promise<UgcPipelineFinalResult> {
    const startTime = Date.now();
    let uploadedAudioKey: string | null = null;
    let currentPhase: PipelinePhase = 'idle';

    const notify = (
      phase: PipelinePhase,
      label: string,
      percent: number,
      extras: Partial<UgcPipelineProgressEvent> = {}
    ) => {
      currentPhase = phase;
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      onProgress?.({
        phase,
        phaseLabel: label,
        progressPercent: percent,
        elapsedSeconds,
        ...extras,
      });
    };

    try {
      // =======================================================================
      // PASO 1: SÍNTESIS DE VOZ NEURONAL (ElevenLabs)
      // =======================================================================
      currentPhase = 'tts_generation';
      notify('tts_generation', 'Sintetizando voz neuronal con ElevenLabs...', 15);

      const ttsResult = await this.elevenLabsService.synthesizeSpeech({
        text: input.script,
        voiceId: input.voiceId,
      });

      // =======================================================================
      // PASO 2: ALMACENAMIENTO DE ACTIVO TEMPORAL (Cloudinary Seguro)
      // =======================================================================
      currentPhase = 'audio_upload';
      notify('audio_upload', 'Alojando activo de audio en Cloudinary...', 35);

      const uploadResult = await this.cloudinaryService.uploadAudio(
        ttsResult.buffer,
        `speech_${Date.now()}.mp3`,
        'lulo-studio/ugc-speech'
      );

      uploadedAudioKey = uploadResult.publicId;

      notify('audio_upload', 'Activo de audio verificado y accesible en Cloudinary.', 45, {
        audioUrl: uploadResult.publicUrl,
      });

      // =======================================================================
      // PASO 3: DESPACHO A OPENROUTER / HEYGEN (heygen/avatar-iv)
      // =======================================================================
      // =======================================================================
      // PASO 3 & 4: DESPACHO Y RENDERIZADO DE VIDEO LIP-SYNC
      // =======================================================================
      currentPhase = 'video_dispatch';
      notify('video_dispatch', 'Despachando renderizado a HeyGen (OpenRouter avatar-iv)...', 50, {
        audioUrl: uploadResult.publicUrl,
      });

      currentPhase = 'video_polling';
      const completedTask = await this.openRouterService.renderVideo(
        {
          model: 'heygen/avatar-iv',
          imageUrl: input.avatarImageUrl,
          audioUrl: uploadResult.publicUrl,
          aspectRatio: input.aspectRatio || '9:16',
        },
        {
          intervalMs: 3500,
          timeoutMs: 360000, // 6 minutos
          onProgress: (task, elapsed) => {
            currentPhase = 'video_polling';
            // Escalar porcentaje visual entre 55% y 98% durante el renderizado
            const scaledPercent = Math.min(98, 55 + Math.round((task.progressPercent || 0) * 0.43));
            notify(
              'video_polling',
              `Renderizando fotorrealismo en HeyGen (${task.progressPercent || Math.round((elapsed / 60) * 100)}%)...`,
              scaledPercent,
              {
                taskId: task.taskId,
                audioUrl: uploadResult.publicUrl,
              }
            );
          },
        }
      );

      if (!completedTask.videoUrl) {
        throw new PipelineError(
          'La tarea de video finalizó pero no se recibió la URL del archivo MP4.',
          'video_polling',
          false,
          completedTask
        );
      }

      // =======================================================================
      // PASO 5: REGISTRO Y AUTO-GUARDADO EN DISCO LOCAL
      // =======================================================================
      const totalElapsedMs = Date.now() - startTime;
      const projectName = input.projectName || `UGC-HeyGen-${Date.now()}`;

      try {
        await saveProject('HeyGen', projectName, {
          title: projectName,
          script: input.script,
          avatarName: 'Avatar-IV',
          ratio: input.aspectRatio || '9:16',
          videoUrl: completedTask.videoUrl,
          status: 'rendered',
        });
      } catch (saveErr) {
        console.warn('[UgcPipelineMasterOrchestrator] Advertencia: No se pudo auto-guardar en disco:', saveErr);
      }

      // Notificación de éxito final
      notify('completed', 'Video renderizado y sincronizado con éxito.', 100, {
        taskId: completedTask.taskId,
        audioUrl: uploadResult.publicUrl,
        videoUrl: completedTask.videoUrl,
      });

      return {
        success: true,
        videoUrl: completedTask.videoUrl,
        audioUrl: uploadResult.publicUrl,
        taskId: completedTask.taskId,
        durationSeconds: ttsResult.durationEstimatedSeconds,
        totalTimeElapsedMs: totalElapsedMs,
        metadata: {
          voiceId: input.voiceId || 'default',
          model: 'heygen/avatar-iv',
          scriptLengthChars: input.script.length,
          aspectRatio: input.aspectRatio || '9:16',
        },
      };
    } catch (err: any) {
      // =======================================================================
      // SRE ROLLBACK / CLEANUP STRATEGY
      // =======================================================================
      console.error(`[UgcPipelineMasterOrchestrator] Falla en fase [${currentPhase}]:`, err);

      // Si el fallo ocurrió después de subir el audio pero antes de completar el video,
      // limpiamos el archivo huérfano de R2 para evitar costos y almacenamiento fantasma
      if (uploadedAudioKey && (currentPhase === 'video_dispatch' || currentPhase === 'video_polling')) {
        try {
          console.log(`[Rollback] Eliminando audio temporal huérfano de Cloudinary: ${uploadedAudioKey}`);
          await this.cloudinaryService.deleteAudio(uploadedAudioKey);
        } catch (cleanupErr) {
          console.warn('[Rollback] Fallo al eliminar activo en cleanup:', cleanupErr);
        }
      }

      const normalizedError =
        err instanceof PipelineError
          ? err
          : new PipelineError(
              err.message || 'Error desconocido durante la ejecución del pipeline.',
              currentPhase,
              true,
              err
            );

      notify('failed', normalizedError.message, 0, {
        error: normalizedError.message,
      });

      throw normalizedError;
    }
  }
}
