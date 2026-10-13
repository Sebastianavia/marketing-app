import { OpenRouterVideoService } from '@/services/openrouter/openrouter-video.service';
import { downloadToLibrary } from '@/lib/storage/generated-library';
import { mp4DurationSeconds } from '@/lib/video/mp4-duration';
import { recordUsage } from '@/lib/usage/usage-store';
import { videoRate } from '@/config/cost-rates';
import { listJobs, updateJob, type RenderJob } from './job-store';
import { errorMessage } from '@/lib/errors';

/**
 * Runner de renders en segundo plano, dentro del propio servidor de la app.
 * Revisa los trabajos cada pocos segundos: envía los nuevos al proveedor,
 * consulta los que están en curso y guarda el MP4 final en la biblioteca.
 * No depende del navegador: se puede cerrar la pestaña y el render sigue.
 * Si la app se cierra a mitad, al volver a abrirla retoma los trabajos pendientes.
 */

const TICK_MS = 5_000;
const MAX_PARALLEL = 3;
const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

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
          })
        : await service.createVideoTask({
            model: job.model,
            imageUrl: job.input.imageUrl,
            audioUrl: job.input.audioUrl || '',
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

  let result: { status: 'processing' | 'completed' | 'failed'; videoUrl?: string; error?: string };
  try {
    result = await fetchOpenRouterStatus(job.providerTaskId);
  } catch (err) {
    // Error de red temporal: se reintenta en la siguiente vuelta
    console.warn('[runner] Consulta de estado fallida, se reintentará:', err);
    return;
  }

  if (result.status === 'failed') {
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

  await finishJob(job, result.videoUrl);
}

async function finishJob(job: RenderJob, videoUrl: string) {
  await updateJob(job.id, { phase: 'Guardando el video en tu biblioteca…' });
  try {
    // Las URLs de contenido de OpenRouter exigen la clave (docs de Video generation)
    const auth = /openrouter\.ai/i.test(videoUrl) && process.env.OPENROUTER_API_KEY
      ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : undefined;
    const { path: outputPath, bytes } = await downloadToLibrary(videoUrl, 'video', 'mp4', job.id, auth);
    const durationSec = mp4DurationSeconds(bytes) || job.input.durationSec || 0;
    const costUSD = Math.round(durationSec * videoRate(job.model) * 10000) / 10000;

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
      estimated: durationSec === 0,
      filePath: outputPath,
      jobId: job.id,
    });
  } catch (err: unknown) {
    // El render ya se pagó: se reintenta solo la descarga en la siguiente vuelta
    console.error('[runner] No se pudo guardar el MP4:', err);
    await updateJob(job.id, { phase: 'Reintentando la descarga del video…' });
  }
}

async function failOrRetry(job: RenderJob, message: string) {
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

async function markFailed(job: RenderJob, message: string) {
  await updateJob(job.id, { status: 'failed', phase: 'Falló', error: message, completedAt: new Date().toISOString() });
  await recordUsage({
    tool: job.tool,
    kind: 'video',
    provider: job.provider,
    model: job.model,
    description: `${job.title} · falló: ${message.slice(0, 80)}`,
    units: 0,
    unit: 'segundos',
    costUSD: 0,
    estimated: false,
    jobId: job.id,
    status: 'failed',
  });
}

async function fetchOpenRouterStatus(taskId: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Falta OPENROUTER_API_KEY en .env.local');

  const response = await fetch(`${OPENROUTER_BASE_URL}/videos/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    if (response.status === 404) {
      return { status: 'failed' as const, error: 'El proveedor no encuentra este trabajo.' };
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
