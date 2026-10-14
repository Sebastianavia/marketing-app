import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';

/**
 * Trabajos de render en segundo plano. Un archivo JSON por trabajo en
 * `<carpeta de datos>/jobs/<id>.json`, así sobreviven a recargas, cierres
 * de la app y actualizaciones.
 */

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface RenderJob {
  id: string;
  tool: string;
  title: string;
  provider: 'openrouter';
  model: string;
  /** 'avatar' = foto + audio con labios sincronizados; 'broll' = imagen→video con prompt. */
  kind?: 'avatar' | 'broll';
  input: {
    imageUrl: string;
    /** Solo avatar. */
    audioUrl?: string;
    aspectRatio: '9:16' | '16:9' | '1:1';
    /** Solo B-roll. */
    prompt?: string;
    durationSec?: number;
    resolution?: string;
    /** El modelo genera su propio audio (voz). */
    generateAudio?: boolean;
    /** Solo avatar (HeyGen): movimiento y expresividad. */
    motionPrompt?: string;
    expressiveness?: 'low' | 'medium' | 'high';
  };
  /** Si pertenece a un video por escenas. */
  sceneProjectId?: string;
  sceneId?: string;
  status: JobStatus;
  /** Texto para mostrar en pantalla mientras se procesa. */
  phase: string;
  providerTaskId?: string;
  attempts: number;
  person?: string;
  estimatedCostUSD?: number;
  outputPath?: string;
  /** Carpeta del proyecto creado automáticamente al terminar (Proyectos). */
  projectPath?: string;
  durationSec?: number;
  costUSD?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

async function jobsDir() {
  return path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'jobs');
}

async function jobPath(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Identificador de trabajo no válido.');
  return path.join(/*turbopackIgnore: true*/ await jobsDir(), `${id}.json`);
}

export async function saveJob(job: RenderJob): Promise<RenderJob> {
  const next = { ...job, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(await jobPath(job.id), next);
  return next;
}

export async function getJob(id: string): Promise<RenderJob | null> {
  const p = await jobPath(id);
  if (!fsSync.existsSync(p)) return null;
  return readJson<RenderJob | null>(p, null);
}

export async function updateJob(id: string, patch: Partial<RenderJob>): Promise<RenderJob | null> {
  const job = await getJob(id);
  if (!job) return null;
  return saveJob({ ...job, ...patch });
}

export async function listJobs(filter: { status?: JobStatus[]; tool?: string } = {}): Promise<RenderJob[]> {
  const dir = await jobsDir();
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const jobs: RenderJob[] = [];
  for (const f of files) {
    const job = await readJson<RenderJob | null>(path.join(/*turbopackIgnore: true*/ dir, f), null);
    if (!job) continue;
    if (filter.status && !filter.status.includes(job.status)) continue;
    if (filter.tool && job.tool !== filter.tool) continue;
    jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
