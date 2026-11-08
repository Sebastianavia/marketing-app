import { OpenRouterVideoService } from '@/services/openrouter/openrouter-video.service';
import { downloadToLibrary } from '@/lib/storage/generated-library';
import { autoSaveProject } from '@/lib/storage/auto-project';
import type { ProjectCategory } from '@/config/project-categories';
import { mp4DurationSeconds } from '@/lib/video/mp4-duration';
import { recordUsage } from '@/lib/usage/usage-store';
import { videoRate } from '@/config/cost-rates';
import { clipCostUSD, getBrollModel } from '@/config/broll-models';
import { ApiMartClient, ApiMartError } from '@/lib/ai/apimart';
import { ClipRequestError, buildApimartVideoBody } from '@/lib/ai/apimart-video';
import { listJobs, updateJob, type RenderJob } from './job-store';
import { errorMessage } from '@/lib/errors';
import { onProductionJobCompleted, onProductionJobFailed } from '@/lib/director/production-jobs';

/**
 * Runner de renders en segundo plano, dentro del propio servidor de la app.
 * Revisa los trabajos cada pocos segundos: envía los nuevos al proveedor,
 * consulta los que están en curso y guarda el MP4 final en la biblioteca.
 * No depende del navegador: se puede cerrar la pestaña y el render sigue.
 * Si la app se cierra a mitad, al volver a abrirla retoma los trabajos pendientes.
 */

const TICK_MS = 5_000;
/** Clips a la vez en el proveedor (todas las herramientas juntas). */
const MAX_PARALLEL = 4;
const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const NOT_FOUND = 'El proveedor no encuentra este trabajo.';

interface RunnerState {
  timer: NodeJS.Timeout | null;
  busy: boolean;
}

// Una sola instancia por proceso, también con recarga en caliente en desarrollo
const g = globalThis as unknown as { __luloRunner?: RunnerState };
const state: RunnerState = g.__luloRunner ?? (g.__luloRunner = { timer: null, busy: false });

export function startRunner() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  console.log('[runner] Renders en segundo plano activos.');
  void tick();
}

/** Despierta el runner de inmediato (p. ej. al crear un trabajo). */
export function wakeRunner() {
  startRunner();
  void tick();
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const active = await listJobs({ status: ['processing'] });
    const queued = (await listJobs({ status: ['queued'] })).reverse(); // los más antiguos primero

    for (const job of queued.slice(0, Math.max(0, MAX_PARALLEL - active.length))) {
      await submitJob(job);
    }
    for (const job of active) {
      await checkJob(job);
    }
  } catch (err) {
    console.error('[runner] Error en la vuelta del runner:', err);
  } finally {
    state.busy = false;
  }
}

async function submitJob(job: RenderJob) {
  if (job.provider === 'apimart') return submitApimartJob(job);
  try {
    const service = new OpenRouterVideoService();
    const task =
      job.kind === 'broll'
        ? await service.createImageToVideoTask({
            model: job.model,
            prompt: job.input.prompt || '',
            frameImageUrl: job.input.imageUrl,
            durationSec: job.input.durationSec || 5,
            aspectRatio: job.input.aspectRatio,
            resolution: job.input.resolution,
            generateAudio: job.input.generateAudio,
          })
        : await service.createVideoTask({
            model: job.model,
            imageUrl: job.input.imageUrl,
            audioUrl: job.input.audioUrl || '',
            motionPrompt: job.input.motionPrompt,
            expressiveness: job.input.expressiveness,
            aspectRatio: job.input.aspectRatio === '1:1' ? '9:16' : job.input.aspectRatio,
          });
    await updateJob(job.id, {
      status: 'processing',
      providerTaskId: task.taskId,
      startedAt: new Date().toISOString(),
      phase: 'Generando el video en el proveedor…',
      attempts: job.attempts + 1,
    });
  } catch (err: unknown) {
    await failOrRetry({ ...job, attempts: job.attempts + 1 }, errorMessage(err, 'No se pudo enviar el trabajo al proveedor.'));
  }
}

/** Apimart: arma el cuerpo según el modelo (Grok / Gemini Omni) y crea la tarea. */
async function submitApimartJob(job: RenderJob) {
  try {
    const body = buildApimartVideoBody({
      model: job.model,
      prompt: job.input.prompt || '',
      durationSec: job.input.durationSec || 6,
      aspectRatio: job.input.aspectRatio,
      resolution: job.input.resolution,
      firstFrameUrl: job.input.imageUrl || undefined,
      referenceImageUrls: job.input.referenceImageUrls,
    });
    const { taskId } = await new ApiMartClient().createVideoTask(body);
    await updateJob(job.id, {
      status: 'processing',
      providerTaskId: taskId,
      startedAt: new Date().toISOString(),
      phase: 'Generando el video en Apimart…',
      attempts: job.attempts + 1,
    });
  } catch (err: unknown) {
    const message = errorMessage(err, 'No se pudo enviar el trabajo a Apimart.');
    // Petición inválida, sin clave o sin saldo: reintentar no sirve (y no se cobró nada)
    if (err instanceof ClipRequestError || (err instanceof ApiMartError && [400, 401, 402, 403].includes(err.status))) {
      await markFailed({ ...job, attempts: job.attempts + 1 }, message);
      return;
    }
    // Límite de velocidad: se vuelve a intentar en la siguiente vuelta sin gastar un intento
    if (err instanceof ApiMartError && err.status === 429) {
      await updateJob(job.id, { phase: 'Apimart pide esperar un momento; se reintentará solo…' });
      return;
    }
    await failOrRetry({ ...job, attempts: job.attempts + 1 }, message);
  }
}

type ProviderStatus = { status: 'processing' | 'completed' | 'failed'; videoUrl?: string; error?: string; costUSD?: number };

async function fetchApimartStatus(taskId: string): Promise<ProviderStatus> {
  const t = await new ApiMartClient().getVideoTaskStatus(taskId);
  if (t.status === 'failed') return { status: 'failed', error: t.errorMessage || 'Apimart no pudo generar el video.', costUSD: t.costUSD };
  if (t.status === 'completed' && t.videoUrl) return { status: 'completed', videoUrl: t.videoUrl, costUSD: t.costUSD };
  return { status: 'processing' };
}

async function checkJob(job: RenderJob) {
  if (!job.providerTaskId) {
    await updateJob(job.id, { status: 'queued', phase: 'En cola' });
    return;
  }

  const started = Date.parse(job.startedAt || job.createdAt);
  if (Date.now() - started > JOB_TIMEOUT_MS) {
    await markFailed(job, 'El proveedor no terminó en 30 minutos. Puedes reintentar.');
    return;
  }

  let result: ProviderStatus;
  try {
    result = job.provider === 'apimart' ? await fetchApimartStatus(job.providerTaskId) : await fetchOpenRouterStatus(job.providerTaskId);
    // Justo después de crear el trabajo, OpenRouter puede tardar en registrarlo: un 404 temprano no es un fallo
    if (result.status === 'failed' && result.error === NOT_FOUND && Date.now() - started < 3 * 60 * 1000) {
      return;
    }
  } catch (err) {
    // Error de red temporal: se reintenta en la siguiente vuelta
    console.warn('[runner] Consulta de estado fallida, se reintentará:', err);
    return;
  }

  if (result.status === 'failed') {
    // Si la tarea fallida cobró algo, no se reintenta solo: hay que volver a aprobar
    if (result.costUSD && result.costUSD > 0) {
      await markFailed(job, `${result.error || 'El proveedor rechazó el render.'} (cobró $${result.costUSD.toFixed(3)})`, result.costUSD);
      return;
    }
    await failOrRetry(job, result.error || 'El proveedor rechazó el render.');
    return;
  }
  if (result.status !== 'completed' || !result.videoUrl) {
    const minutes = Math.floor((Date.now() - started) / 60000);
    await updateJob(job.id, {
      phase: minutes > 0 ? `Generando el video… (${minutes} min)` : 'Generando el video…',
    });
    return;
  }

  await finishJob(job, result.videoUrl, result.costUSD);
}

/** Costo estimado si el proveedor no da el real (OpenRouter: tarifa × segundos; Apimart: tabla del catálogo). */
function estimatedCost(job: RenderJob, durationSec: number): number {
  if (job.provider === 'apimart') {
    return clipCostUSD(getBrollModel(job.model), durationSec || job.input.durationSec || 6, { withAudio: job.input.generateAudio, resolution: job.input.resolution });
  }
  return durationSec * videoRate(job.model, job.input.generateAudio);
}

async function finishJob(job: RenderJob, videoUrl: string, realCostUSD?: number) {
  await updateJob(job.id, { phase: 'Guardando el video en tu biblioteca…' });
  try {
    // Las URLs de contenido de OpenRouter exigen la clave (docs de Video generation)
    const auth = /openrouter\.ai/i.test(videoUrl) && process.env.OPENROUTER_API_KEY
      ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : undefined;
    const { path: outputPath, bytes } = await downloadToLibrary(videoUrl, 'video', 'mp4', job.id, auth);
    const durationSec = mp4DurationSeconds(bytes) || job.input.durationSec || 0;
    // Apimart da el costo real de la tarea (data.cost); si no viene, se estima
    const hasReal = typeof realCostUSD === 'number' && realCostUSD >= 0;
    const costUSD = Math.round((hasReal ? realCostUSD : estimatedCost(job, durationSec)) * 10000) / 10000;

    await updateJob(job.id, {
      status: 'completed',
      phase: 'Listo',
      outputPath,
      durationSec,
      costUSD,
      completedAt: new Date().toISOString(),
    });

    await recordUsage({
      tool: job.tool,
      kind: 'video',
      provider: job.provider,
      model: job.model,
      description: `${job.title} · ${Math.round(durationSec * 10) / 10}s · ${job.input.aspectRatio}`,
      units: durationSec,
      unit: 'segundos',
      costUSD,
      estimated: job.provider === 'apimart' ? !hasReal : durationSec === 0,
      filePath: outputPath,
      jobId: job.id,
      productionId: job.productionId,
    });

    // Producciones del Director: el MP4 va a la carpeta de la producción (una sola tarjeta en Proyectos)
    if (job.productionId) {
      await onProductionJobCompleted({ ...job, outputPath, durationSec, costUSD, status: 'completed' });
      return;
    }

    // Proyectos: los videos sueltos (Avatar Studio, UGC…) se guardan solos en su carpeta.
    // Los clips de Guion a video no: allí se guarda el video final montado.
    if (!job.sceneProjectId && !job.projectPath) {
      const category: ProjectCategory =
        job.tool === 'ugc-generator' ? 'UGC' : job.tool === 'deep-swap' ? 'Genjutsu' : 'HeyGen';
      const project = await autoSaveProject(
        category,
        job.title || 'Video',
        {
          title: job.title,
          imageUrl: job.input.imageUrl || undefined,
          audioUrl: job.input.audioUrl,
          audioMode: job.input.audioUrl ? 'local' : 'generar',
          prompt: job.input.prompt || job.input.motionPrompt,
          ratio: job.input.aspectRatio,
          avatarName: job.person,
          finalCostUSD: costUSD,
          videoDurationReal: durationSec,
          modelUsed: job.model,
          status: 'rendered',
        },
        { videoPath: outputPath }
      );
      if (project) await updateJob(job.id, { projectPath: project.path });
    }
  } catch (err: unknown) {
    // El render ya se pagó: se reintenta solo la descarga en la siguiente vuelta
    console.error('[runner] No se pudo guardar el MP4:', err);
    await updateJob(job.id, { phase: 'Reintentando la descarga del video…' });
  }
}

/** Rechazo de la imagen por políticas del proveedor (Veo/Vertex no acepta ciertas fotos de personas). */
const IMAGE_POLICY_RE = /usage guidelines|violates|policy|safety|prohibited|not allowed/i;

async function failOrRetry(job: RenderJob, message: string) {
  // Clave inválida/expirada o sin saldo: reintentar no sirve hasta que la persona lo arregle
  if (/OPENROUTER_API_KEY|APIMART_API_KEY|no tiene saldo/.test(message)) {
    await markFailed(job, message);
    return;
  }
  // B-roll con imagen rechazada: se reintenta sin imagen, solo con la descripción de la toma
  if (job.kind === 'broll' && job.input.imageUrl && IMAGE_POLICY_RE.test(message) && job.attempts < MAX_ATTEMPTS) {
    await updateJob(job.id, {
      status: 'queued',
      providerTaskId: undefined,
      attempts: job.attempts,
      input: { ...job.input, imageUrl: '' },
      phase: 'El proveedor rechazó la imagen; reintentando solo con la descripción…',
      error: message,
    });
    return;
  }
  // job.attempts = envíos ya hechos (incluido el que acaba de fallar)
  if (job.attempts < MAX_ATTEMPTS) {
    await updateJob(job.id, {
      status: 'queued',
      providerTaskId: undefined,
      attempts: job.attempts,
      phase: `Reintentando (${job.attempts + 1} de ${MAX_ATTEMPTS})…`,
      error: message,
    });
  } else {
    await markFailed(job, message);
  }
}

async function markFailed(job: RenderJob, message: string, costUSD = 0) {
  await updateJob(job.id, { status: 'failed', phase: 'Falló', error: message, completedAt: new Date().toISOString(), ...(costUSD ? { costUSD } : {}) });
  await recordUsage({
    tool: job.tool,
    kind: 'video',
    provider: job.provider,
    model: job.model,
    description: `${job.title} · falló: ${message.slice(0, 80)}`,
    units: 0,
    unit: 'segundos',
    costUSD,
    estimated: false,
    jobId: job.id,
    productionId: job.productionId,
    status: 'failed',
  });
  if (job.productionId) await onProductionJobFailed({ ...job, ...(costUSD ? { costUSD } : {}) }, message);
}

async function fetchOpenRouterStatus(taskId: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Falta OPENROUTER_API_KEY en .env.local');

  const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    if (response.status === 404) {
      return { status: 'failed' as const, error: NOT_FOUND };
    }
    throw new Error(`OpenRouter respondió ${response.status}`);
  }

  const data = await response.json();
  const task = data.data || data;
  const raw = String(task.status || task.state || '').toLowerCase();
  const urls: unknown[] =
    (Array.isArray(task.unsigned_urls) && task.unsigned_urls) ||
    (Array.isArray(data.unsigned_urls) && data.unsigned_urls) ||
    (Array.isArray(task.output?.unsigned_urls) && task.output.unsigned_urls) ||
    [];
  const candidates = [
    urls.find((u) => typeof u === 'string' && u.startsWith('http')),
    task.video_url,
    task.url,
    task.output_url,
    task.result_url,
    typeof task.output === 'string' ? task.output : undefined,
    task.result?.url,
    task.output?.video_url,
  ];
  const videoUrl = candidates.find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));

  if (['failed', 'error', 'canceled', 'cancelled'].includes(raw)) {
    return { status: 'failed' as const, error: task.error?.message || task.error || `Estado del proveedor: ${raw}` };
  }
  if (videoUrl && (['completed', 'succeeded', 'success', 'done'].includes(raw) || !raw)) {
    return { status: 'completed' as const, videoUrl };
  }
  return { status: 'processing' as const };
}
