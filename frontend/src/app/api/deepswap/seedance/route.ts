import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient, ApiMartError } from '@/lib/ai/apimart';
import {
  SEEDANCE_MODELS,
  SeedanceValidationError,
  transformVideoSeedance,
  validateAndBuildSeedancePayload,
} from '@/services/faceswap.service';
import type {
  SeedanceModelId,
  SeedanceResolution,
  SeedanceSize,
  SeedanceTransformInput,
} from '@/types/faceswap.types';
import { downloadToLibrary, localMediaUrl } from '@/lib/storage/generated-library';
import { autoSaveProject } from '@/lib/storage/auto-project';
import { assertWithinDailyLimit, DailyLimitError, recordUsage } from '@/lib/usage/usage-store';
import { getSettings } from '@/lib/data/settings';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface CloudinaryTempAsset {
  publicId: string;
  resourceType: 'image' | 'video' | 'raw';
}

interface InFlightSeedanceMeta {
  model: SeedanceModelId;
  size: SeedanceSize;
  resolution: SeedanceResolution;
  duration: number;
  prompt: string;
  estimatedCostUSD: number;
  cloudinaryAssets?: CloudinaryTempAsset[];
  persisted?: {
    localVideoUrl: string;
    remoteVideoUrl: string;
    savedPath: string;
    costUSD: number;
    creditsCost?: number;
  };
}

const inFlightTasks = new Map<string, InFlightSeedanceMeta>();

async function cleanupCloudinaryAssets(assets?: CloudinaryTempAsset[]) {
  if (!assets?.length) return;
  await Promise.allSettled(
    assets.map((a) =>
      cloudinaryStorageService.deleteAsset(
        a.publicId,
        a.resourceType === 'image' ? 'image' : 'video'
      )
    )
  );
}

async function persistCompletedSeedanceVideo(
  taskId: string,
  remoteVideoUrl: string,
  meta: InFlightSeedanceMeta,
  actualCostUSD?: number,
  creditsCost?: number
) {
  if (meta.persisted) {
    return meta.persisted;
  }

  let savedPath = '';
  let localVideoUrl = remoteVideoUrl;

  try {
    const downloaded = await downloadToLibrary(remoteVideoUrl, 'video', 'mp4', taskId);
    savedPath = downloaded.path;
    localVideoUrl = localMediaUrl(savedPath);
  } catch (err) {
    console.warn('[seedance] No se pudo descargar copia local, usando URL remota:', err);
  }

  const finalCostUSD =
    typeof actualCostUSD === 'number' && actualCostUSD > 0
      ? actualCostUSD
      : meta.estimatedCostUSD;

  await recordUsage({
    tool: 'deep-swap',
    kind: 'video',
    provider: 'apimart',
    model: meta.model,
    description: `Clonación y reemplazo Seedance (${meta.resolution}, ${meta.size}, ${meta.duration}s): ${meta.prompt.slice(0, 70)}`,
    units: meta.duration,
    unit: 'segundos',
    costUSD: finalCostUSD,
    estimated: !(typeof actualCostUSD === 'number' && actualCostUSD > 0),
    filePath: savedPath || undefined,
    jobId: taskId,
  });

  if (savedPath) {
    await autoSaveProject(
      'Genjutsu',
      meta.prompt.slice(0, 42) || 'Clonación Seedance 2.0',
      {
        prompt: meta.prompt,
        ratio: meta.size,
        videoUrl: localVideoUrl,
        tags: ['seedance-2.0', meta.model, meta.resolution, meta.size],
      },
      { videoPath: savedPath }
    );
  }

  await cleanupCloudinaryAssets(meta.cloudinaryAssets);

  const persisted = {
    localVideoUrl,
    remoteVideoUrl,
    savedPath,
    costUSD: finalCostUSD,
    creditsCost,
  };
  meta.persisted = persisted;
  inFlightTasks.set(taskId, meta);
  return persisted;
}

/**
 * POST /api/deepswap/seedance
 * Valida las referencias multimodales, verifica límite diario y despacha la generación
 * a Seedance 2.0 en Apimart (`POST https://api.apimart.ai/v1/videos/generations`).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: SeedanceTransformInput = {
      videoUrl: body.videoUrl,
      faceRefUrl: body.faceRefUrl,
      objectRefUrl: body.objectRefUrl,
      extraImageUrls: body.extraImageUrls,
      audioUrl: body.audioUrl,
      prompt: body.prompt,
      options: {
        model: body.options?.model ?? 'seedance-2.0',
        size: body.options?.size ?? '16:9',
        resolution: body.options?.resolution ?? '720p',
        duration: Number(body.options?.duration ?? 5),
        generateAudio: body.options?.generateAudio ?? true,
        nsfwCheck: body.options?.nsfwCheck ?? false,
        returnLastFrame: body.options?.returnLastFrame,
        seed: body.options?.seed,
        videoDurationSec: body.options?.videoDurationSec,
        audioDurationSec: body.options?.audioDurationSec,
        imageWithRoles: body.options?.imageWithRoles,
        waitForCompletion: body.options?.waitForCompletion ?? false,
        timeoutMs: body.options?.timeoutMs,
        pollIntervalMs: body.options?.pollIntervalMs,
      },
    };

    const { payload, estimatedCostUSD } = validateAndBuildSeedancePayload(input);
    const settings = await getSettings();
    await assertWithinDailyLimit(estimatedCostUSD, settings.dailyLimitUSD);

    const result = await transformVideoSeedance(input);

    const meta: InFlightSeedanceMeta = {
      model: (payload.model as SeedanceModelId) ?? 'seedance-2.0',
      size: (payload.size as SeedanceSize) ?? '16:9',
      resolution: (payload.resolution as SeedanceResolution) ?? '720p',
      duration: payload.duration ?? 5,
      prompt: input.prompt?.trim() || 'Clonación multimodal Seedance 2.0',
      estimatedCostUSD,
      cloudinaryAssets: Array.isArray(body.cloudinaryAssets) ? body.cloudinaryAssets : undefined,
    };

    inFlightTasks.set(result.taskId, meta);

    if (result.status === 'completed' && result.videoUrl) {
      const persisted = await persistCompletedSeedanceVideo(
        result.taskId,
        result.videoUrl,
        meta,
        result.costUSD,
        result.creditsCost
      );
      return NextResponse.json({
        ...result,
        videoUrl: persisted.localVideoUrl,
        remoteVideoUrl: persisted.remoteVideoUrl,
        costUSD: persisted.costUSD,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SeedanceValidationError) {
      return NextResponse.json({ error: err.message, type: 'validation_error' }, { status: 400 });
    }
    if (err instanceof DailyLimitError) {
      return NextResponse.json({ error: err.message, type: 'daily_limit' }, { status: 402 });
    }
    if (err instanceof ApiMartError) {
      return NextResponse.json({ error: err.message, type: err.errorType }, { status: err.status });
    }
    return NextResponse.json(
      { error: errorMessage(err, 'No se pudo iniciar la clonación con Seedance 2.0.') },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deepswap/seedance?taskId=...
 * Consulta el estado de la tarea asíncrona en Apimart (`GET https://api.apimart.ai/v1/tasks/{task_id}`).
 * Cuando llega a `completed`, descarga el MP4 a la biblioteca local, crea el proyecto en Genjutsu
 * y registra el costo real o estimado en Costos.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('taskId')?.trim();
    if (!taskId) {
      return NextResponse.json({ error: 'Falta el parámetro taskId.' }, { status: 400 });
    }

    const client = new ApiMartClient();
    if (!client.isConfigured) {
      return NextResponse.json(
        { error: 'Falta APIMART_API_KEY en frontend/.env.local.' },
        { status: 400 }
      );
    }

    const status = await client.getVideoTaskStatus(taskId);

    const modelParam = (searchParams.get('model') as SeedanceModelId) || 'seedance-2.0';
    const durationParam = Number(searchParams.get('duration') || 5);
    const modelSpec = SEEDANCE_MODELS.find((m) => m.id === modelParam) ?? SEEDANCE_MODELS[0];
    const fallbackMeta: InFlightSeedanceMeta = inFlightTasks.get(taskId) ?? {
      model: modelSpec.id,
      size: ((searchParams.get('size') as SeedanceSize) || '16:9'),
      resolution: ((searchParams.get('resolution') as SeedanceResolution) || '720p'),
      duration: durationParam,
      prompt: searchParams.get('prompt') || 'Clonación multimodal Seedance 2.0',
      estimatedCostUSD: Math.round(durationParam * modelSpec.costPerSecondUSD * 10000) / 10000,
    };

    if (status.status === 'failed') {
      await cleanupCloudinaryAssets(fallbackMeta.cloudinaryAssets);
      return NextResponse.json({
        taskId,
        status: 'failed',
        progress: status.progress ?? 0,
        error: status.errorMessage || 'El procesamiento de Seedance 2.0 falló en Apimart.',
      });
    }

    if (status.status === 'completed' && status.videoUrl) {
      const persisted = await persistCompletedSeedanceVideo(
        taskId,
        status.videoUrl,
        fallbackMeta,
        status.costUSD,
        status.creditsCost
      );

      return NextResponse.json({
        taskId,
        status: 'completed',
        progress: 100,
        videoUrl: persisted.localVideoUrl,
        remoteVideoUrl: persisted.remoteVideoUrl,
        lastFrameUrl: status.lastFrameUrl,
        costUSD: persisted.costUSD,
        creditsCost: persisted.creditsCost,
        actualTimeSec: status.actualTime,
      });
    }

    return NextResponse.json({
      taskId,
      status: status.status,
      progress: status.progress ?? (status.status === 'processing' ? 45 : 15),
      estimatedTimeSec: status.estimatedTime,
    });
  } catch (err) {
    if (err instanceof ApiMartError) {
      return NextResponse.json({ error: err.message, type: err.errorType }, { status: err.status });
    }
    return NextResponse.json(
      { error: errorMessage(err, 'Error al consultar el estado de Seedance 2.0.') },
      { status: 500 }
    );
  }
}
