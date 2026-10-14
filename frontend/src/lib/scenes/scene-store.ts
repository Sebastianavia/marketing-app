import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';

/**
 * Proyectos de "video por escenas". Un JSON por proyecto en
 * `<carpeta de datos>/scenes/<id>.json` y sus archivos de trabajo en
 * `<carpeta de datos>/scenes/<id>/` (imágenes, voz, cortes). El video final va a la biblioteca.
 */

export type SceneType = 'avatar' | 'broll';
export type SceneProjectStatus = 'queued' | 'voice' | 'clips' | 'stitching' | 'completed' | 'failed';

export interface SceneImage {
  id: string;
  name: string;
  /** Archivo local dentro de la carpeta del proyecto. */
  path: string;
  /** URL pública temporal (Cloudinary) para el proveedor de video. */
  url?: string;
  publicId?: string;
}

export interface Scene {
  id: string;
  type: SceneType;
  narration: string;
  visualPrompt: string;
  imageId?: string;
  /** Segundo del video final en el que empieza (sale de la voz con tiempos). */
  start?: number;
  clipJobId?: string;
  clipPath?: string;
  status?: 'pending' | 'rendering' | 'done' | 'failed';
  error?: string;
}

export interface SceneProject {
  id: string;
  title: string;
  status: SceneProjectStatus;
  phase: string;
  person?: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  brollModel: string;
  /** voiceover = ElevenLabs de fondo · native = voz del modelo · avatar = HeyGen + ElevenLabs. */
  voiceMode?: 'voiceover' | 'native' | 'avatar';
  /** HeyGen (escenas de la persona): movimiento y expresividad. */
  avatarMotion?: { motionPrompt?: string; expressiveness?: 'low' | 'medium' | 'high' };
  voice: {
    voiceId: string;
    voiceName?: string;
    modelId: string;
    settings: Record<string, unknown>;
  };
  images: SceneImage[];
  scenes: Scene[];
  crossfade: number;
  voicePath?: string;
  totalSeconds?: number;
  outputPath?: string;
  estimatedCostUSD?: number;
  costUSD?: number;
  error?: string;
  tempUploads?: Array<{ publicId: string; resourceType: 'image' | 'video' }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const ID_RE = /^[a-f0-9-]{36}$/i;

async function scenesRoot() {
  return path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'scenes');
}

export async function projectDir(id: string) {
  if (!ID_RE.test(id)) throw new Error('Identificador de proyecto no válido.');
  const dir = path.join(/*turbopackIgnore: true*/ await scenesRoot(), id);
  if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function projectFile(id: string) {
  if (!ID_RE.test(id)) throw new Error('Identificador de proyecto no válido.');
  const root = await scenesRoot();
  if (!fsSync.existsSync(root)) await fs.mkdir(root, { recursive: true });
  return path.join(/*turbopackIgnore: true*/ root, `${id}.json`);
}

export async function saveProject(p: SceneProject): Promise<SceneProject> {
  const next = { ...p, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(await projectFile(p.id), next);
  return next;
}

export async function getProject(id: string): Promise<SceneProject | null> {
  const f = await projectFile(id);
  if (!fsSync.existsSync(f)) return null;
  return readJson<SceneProject | null>(f, null);
}

export async function updateProject(id: string, patch: Partial<SceneProject>): Promise<SceneProject | null> {
  const p = await getProject(id);
  if (!p) return null;
  return saveProject({ ...p, ...patch });
}

export async function listProjects(filter: { status?: SceneProjectStatus[] } = {}): Promise<SceneProject[]> {
  const root = await scenesRoot();
  const files = (await fs.readdir(root).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const out: SceneProject[] = [];
  for (const f of files) {
    const p = await readJson<SceneProject | null>(path.join(/*turbopackIgnore: true*/ root, f), null);
    if (!p) continue;
    if (filter.status && !filter.status.includes(p.status)) continue;
    out.push(p);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
