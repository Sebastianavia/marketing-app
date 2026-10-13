import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';
import { cloudinaryStorageService } from '@/services/storage/cloudinary.service';
import { saveGenerated, getGeneratedDir } from '@/lib/storage/generated-library';
import { recordUsage } from '@/lib/usage/usage-store';
import { ttsCost } from '@/config/cost-rates';
import { getBrollModel, pickBrollDuration } from '@/config/broll-models';
import { getElevenModel, hasAudioTags, stripAudioTags, isKnownElevenModel } from '@/config/elevenlabs-models';
import { getJob, saveJob, type RenderJob } from '@/lib/jobs/job-store';
import { wakeRunner } from '@/lib/jobs/runner';
import { sliceAudio, stitchScenes, frameSize } from '@/lib/video/ffmpeg';
import { errorMessage } from '@/lib/errors';
import { computeSceneStarts, safeCrossfade } from './scene-timing';
import { getProject, listProjects, projectDir, saveProject, type SceneProject } from './scene-store';

/**
 * Proceso en segundo plano del video por escenas:
 *   queued → voice (voz completa con tiempos) → clips (un trabajo del runner por escena)
 *   → stitching (FFmpeg: fundidos + voz continua) → completed
 * Igual que el runner de renders: sobrevive a cerrar la pestaña y retoma al reabrir la app.
 */

const TICK_MS = 5_000;
const AVATAR_MODEL = 'heygen/avatar-iv';

const g = globalThis as unknown as { __luloScenes?: { timer: NodeJS.Timeout | null; busy: boolean } };
const state = g.__luloScenes ?? (g.__luloScenes = { timer: null, busy: false });

export function startSceneRunner() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

export function wakeSceneRunner() {
  startSceneRunner();
  void tick();
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const active = await listProjects({ status: ['queued', 'voice', 'clips', 'stitching'] });
    for (const p of active.reverse()) {
      try {
        await step(p);
      } catch (err) {
        console.error('[escenas] Error en el proyecto', p.id, err);
        await saveProject({ ...p, status: 'failed', phase: 'Falló', error: errorMessage(err, 'Error inesperado.') });
      }
    }
  } catch (err) {
    console.error('[escenas] Error en la vuelta:', err);
  } finally {
    state.busy = false;
  }
}

async function step(p: SceneProject) {
  if (p.status === 'queued' || p.status === 'voice') return doVoice(p);
  if (p.status === 'clips') return doClips(p);
  if (p.status === 'stitching') return doStitch(p);
}

/** Texto de cada escena tal como se envía a la voz (sin etiquetas si el modelo no las admite). */
function spokenPieces(p: SceneProject): string[] {
  const spec = getElevenModel(p.voice.modelId);
  const strip = isKnownElevenModel(p.voice.modelId) && !spec.audioTags;
  return p.scenes.map((s) => {
    const t = s.narration.trim();
    return strip && hasAudioTags(t) ? stripAudioTags(t) : t;
  });
}

async function doVoice(p: SceneProject) {
  p = await saveProject({ ...p, status: 'voice', phase: 'Generando la voz completa…' });
  const pieces = spokenPieces(p);
  const result = await elevenLabsService.generateWithTimestamps(
    pieces.join(' '),
    p.voice.voiceId,
    p.voice.modelId,
    p.voice.settings
  );
  const dir = await projectDir(p.id);
  const voicePath = path.join(/*turbopackIgnore: true*/ dir, 'voz.mp3');
  await fs.writeFile(voicePath, result.buffer);
  let libraryPath: string | undefined;
  try {
    libraryPath = await saveGenerated('audio', result.buffer, 'mp3', p.id);
  } catch {
    // la copia en la biblioteca es opcional
  }

  const fallbackTotal = pieces.join(' ').length / 15;
  const { starts, total } = computeSceneStarts(pieces, result.alignment, fallbackTotal);
  const crossfade = safeCrossfade(starts, total, p.crossfade || 0.5);
  const voiceCost = ttsCost(result.modelId, result.charactersBilled);

  await recordUsage({
    tool: 'text-to-video',
    kind: 'audio',
    provider: 'elevenlabs',
    model: result.modelId,
    description: `Voz del video por escenas · ${p.title} · ${p.scenes.length} escenas`,
    units: result.charactersBilled,
    unit: 'caracteres',
    costUSD: voiceCost,
    estimated: true,
    filePath: libraryPath,
  });

  await saveProject({
    ...p,
    status: 'clips',
    phase: 'Preparando los clips…',
    voicePath,
    totalSeconds: total,
    crossfade,
    costUSD: (p.costUSD ?? 0) + voiceCost,
    scenes: p.scenes.map((s, i) => ({ ...s, start: starts[i], status: 'pending' })),
  });
}

/** Sube una imagen del proyecto a Cloudinary (una sola vez) y devuelve su URL pública. */
async function ensureImageUrl(p: SceneProject, imageId: string | undefined): Promise<string> {
  const img = p.images.find((i) => i.id === imageId) ?? p.images[0];
  if (!img) throw new Error('El proyecto no tiene imágenes: sube al menos la foto de la persona.');
  if (img.url) return img.url;
  const buf = await fs.readFile(img.path);
  const up = await cloudinaryStorageService.uploadImage(buf, img.name, 'lulo-studio/escenas');
  img.url = up.publicUrl;
  img.publicId = up.publicId;
  p.tempUploads = [...(p.tempUploads ?? []), { publicId: up.publicId, resourceType: 'image' }];
  return img.url;
}

function sceneEnd(p: SceneProject, i: number): number {
  const total = p.totalSeconds ?? 0;
  return i < p.scenes.length - 1 ? (p.scenes[i + 1].start ?? total) + p.crossfade : total;
}

async function doClips(p: SceneProject) {
  const dir = await projectDir(p.id);
  let changed = false;

  // 1. Lanzar los clips que faltan
  for (let i = 0; i < p.scenes.length; i++) {
    const s = p.scenes[i];
    if (s.clipJobId || s.status === 'done') continue;
    const start = s.start ?? 0;
    const end = sceneEnd(p, i);
    const imageUrl = await ensureImageUrl(p, s.imageId);
    const now = new Date().toISOString();
    const base = {
      id: crypto.randomUUID(),
      tool: 'text-to-video',
      provider: 'openrouter' as const,
      status: 'queued' as const,
      phase: 'En cola',
      attempts: 0,
      person: p.person,
      sceneProjectId: p.id,
      sceneId: s.id,
      createdAt: now,
      updatedAt: now,
    };
    let job: RenderJob;
    if (s.type === 'avatar') {
      const slicePath = path.join(/*turbopackIgnore: true*/ dir, `voz_escena_${i + 1}.mp3`);
      await sliceAudio(p.voicePath!, start, end, slicePath);
      const up = await cloudinaryStorageService.uploadAudio(await fs.readFile(slicePath), `escena_${i + 1}.mp3`, 'lulo-studio/escenas');
      p.tempUploads = [...(p.tempUploads ?? []), { publicId: up.publicId, resourceType: 'video' }];
      job = {
        ...base,
        kind: 'avatar',
        title: `${p.title} · escena ${i + 1} (avatar)`,
        model: AVATAR_MODEL,
        input: { imageUrl, audioUrl: up.publicUrl, aspectRatio: p.aspectRatio },
        estimatedCostUSD: (end - start) * 0.05,
      };
    } else {
      const model = getBrollModel(p.brollModel);
      const duration = pickBrollDuration(model, Math.ceil(end - start));
      job = {
        ...base,
        kind: 'broll',
        title: `${p.title} · escena ${i + 1} (apoyo)`,
        model: model.id,
        input: {
          imageUrl,
          aspectRatio: p.aspectRatio,
          prompt: s.visualPrompt || s.narration,
          durationSec: duration,
          resolution: model.resolution,
        },
        estimatedCostUSD: duration * model.pricePerSecond,
      };
    }
    await saveJob(job);
    s.clipJobId = job.id;
    s.status = 'rendering';
    changed = true;
  }
  if (changed) {
    p = await saveProject({ ...p, phase: 'Generando los clips de cada escena…' });
    wakeRunner();
  }

  // 2. Revisar cómo van
  let done = 0;
  let clipCost = 0;
  for (const s of p.scenes) {
    if (!s.clipJobId) continue;
    const job = await getJob(s.clipJobId);
    if (!job) continue;
    if (job.status === 'completed' && job.outputPath) {
      s.status = 'done';
      s.clipPath = job.outputPath;
      clipCost += job.costUSD ?? 0;
      done++;
    } else if (job.status === 'failed') {
      s.status = 'failed';
      s.error = job.error;
    }
  }
  const failed = p.scenes.filter((s) => s.status === 'failed');
  if (failed.length) {
    const n = p.scenes.indexOf(failed[0]) + 1;
    await saveProject({
      ...p,
      status: 'failed',
      phase: 'Falló',
      error: `La escena ${n} no se pudo generar: ${failed[0].error ?? 'error del proveedor'}. Pulsa Reintentar para volver a intentarlo solo con las escenas que fallaron.`,
    });
    return;
  }
  if (done === p.scenes.length) {
    await saveProject({ ...p, status: 'stitching', phase: 'Montando el video final…', costUSD: (p.costUSD ?? 0) + clipCost });
    return;
  }
  await saveProject({ ...p, phase: `Clips listos: ${done} de ${p.scenes.length}…` });
}

async function doStitch(p: SceneProject) {
  const dir = await projectDir(p.id);
  const tmp = path.join(/*turbopackIgnore: true*/ dir, 'final.mp4');
  const { width, height } = frameSize(p.aspectRatio);
  await stitchScenes({
    clips: p.scenes.map((s) => ({ path: s.clipPath! })),
    starts: p.scenes.map((s) => s.start ?? 0),
    total: p.totalSeconds!,
    audioPath: p.voicePath!,
    output: tmp,
    width,
    height,
    crossfade: p.crossfade,
  });

  // Al lado de los demás videos generados, en la biblioteca
  const libDir = await getGeneratedDir();
  const safeTitle = p.title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) || 'video';
  const outputPath = path.join(/*turbopackIgnore: true*/ libDir, `escenas_${safeTitle}_${p.id.slice(0, 8)}.mp4`);
  await fs.copyFile(tmp, outputPath);
  await fs.rm(tmp, { force: true });

  // Limpieza de los archivos temporales en Cloudinary
  for (const t of p.tempUploads ?? []) {
    await cloudinaryStorageService.deleteAsset(t.publicId, t.resourceType);
  }

  await saveProject({
    ...p,
    status: 'completed',
    phase: 'Listo',
    outputPath,
    tempUploads: [],
    completedAt: new Date().toISOString(),
  });
}

/** Reintenta solo lo que falló. */
export async function retryProject(id: string): Promise<SceneProject | null> {
  const p = await getProject(id);
  if (!p) return null;
  let status: SceneProject['status'] = 'clips';
  if (!p.voicePath || !fsSync.existsSync(p.voicePath)) status = 'queued';
  else if (p.scenes.every((s) => s.status === 'done')) status = 'stitching';
  const next = await saveProject({
    ...p,
    status,
    phase: 'Reintentando…',
    error: undefined,
    scenes: p.scenes.map((s) => (s.status === 'failed' ? { ...s, clipJobId: undefined, status: 'pending', error: undefined } : s)),
  });
  wakeSceneRunner();
  return next;
}
