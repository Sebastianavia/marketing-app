import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { getStorageBasePath, sanitizeProjectName } from '@/lib/storage/project-storage';
import type { ClaudeChatState } from '@/lib/ai/claude-code/agent-types';
import type { Storyboard, StudioSettings, UgcReference } from '@/types/ugc-studio.types';
import { isInside } from '@/lib/fs/inside';

/**
 * Estudio Claude: un chat a pantalla completa donde Claude hace el video usando las herramientas
 * de la app. Cada conversación es un proyecto:
 *  - Índice y estado: <datos>/studio/<id>.json
 *  - Archivos: <proyectos>\Claude\<Título fecha>\ (adjuntos, escenas, videos)
 * El dinero solo se gasta con una aprobación de la persona en el chat (tarjeta → assertAppUiRequest).
 */

export class StudioError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface StudioApproval {
  id: string;
  concepto: string;
  /** Lo que la persona aprueba como máximo para este concepto. */
  montoUSD: number;
  /** Gastado contra esta aprobación. */
  usadoUSD: number;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  pedida: string;
  resuelta?: string;
}

export interface StudioMedia {
  id: string;
  tipo: 'video' | 'imagen' | 'audio';
  /** Ruta absoluta (dentro de la carpeta de proyectos). */
  ruta: string;
  titulo: string;
  creado: string;
}

export interface StudioProject {
  id: string;
  titulo: string;
  carpeta: string;
  creado: string;
  actualizado: string;
  chat?: ClaudeChatState;
  aprobaciones: StudioApproval[];
  medios: StudioMedia[];
  /** Trabajo de UGC Studio dentro del estudio. */
  ugc?: { storyboard: Storyboard; references: UgcReference[]; settings: StudioSettings; finalPath?: string };
  /** Ediciones creadas desde el estudio (ids de Edición de video). */
  ediciones: string[];
  gastoUSD: number;
}

const ID = /^st_[a-z0-9]{12}$/;

async function indexDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'studio');
  await fs.mkdir(d, { recursive: true });
  return d;
}

async function indexFile(id: string): Promise<string> {
  if (!ID.test(id)) throw new StudioError('Proyecto no encontrado.', 404);
  return path.join(/*turbopackIgnore: true*/ await indexDir(), `${id}.json`);
}

function stamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

export async function createStudioProject(titulo: string): Promise<StudioProject> {
  const id = `st_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const clean = titulo.replace(/\s+/g, ' ').trim().slice(0, 50) || 'Video con Claude';
  const base = path.join(/*turbopackIgnore: true*/ await getStorageBasePath(), 'Claude');
  let carpeta = '';
  for (let i = 1; i < 100 && !carpeta; i++) {
    const dir = path.join(/*turbopackIgnore: true*/ base, sanitizeProjectName(`${clean} ${stamp()}${i > 1 ? ` (${i})` : ''}`) || id);
    if (!fsSync.existsSync(dir)) carpeta = dir;
  }
  await fs.mkdir(path.join(/*turbopackIgnore: true*/ carpeta, 'adjuntos'), { recursive: true });
  const now = new Date().toISOString();
  const p: StudioProject = { id, titulo: clean, carpeta, creado: now, actualizado: now, aprobaciones: [], medios: [], ediciones: [], gastoUSD: 0 };
  await writeJsonAtomic(await indexFile(id), p);
  return p;
}

export async function getStudioProject(id: string): Promise<StudioProject> {
  const p = await readJson<StudioProject | null>(await indexFile(id), null);
  if (!p) throw new StudioError('Este proyecto ya no existe.', 404);
  return p;
}

// Candado por proyecto (las rutas y las herramientas de Claude escriben a la vez)
const g = globalThis as unknown as { __luloStudioLocks?: Map<string, Promise<unknown>> };
const locks = (g.__luloStudioLocks ??= new Map<string, Promise<unknown>>());

export async function updateStudioProject<T = void>(id: string, fn: (p: StudioProject) => T | Promise<T>): Promise<{ project: StudioProject; result: T }> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = prev.then(() => mine);
  locks.set(id, chain);
  await prev.catch(() => undefined);
  try {
    const p = await getStudioProject(id);
    const result = await fn(p);
    p.actualizado = new Date().toISOString();
    await writeJsonAtomic(await indexFile(id), p);
    return { project: p, result };
  } finally {
    release();
    if (locks.get(id) === chain) locks.delete(id);
  }
}

export async function listStudioProjects(): Promise<StudioProject[]> {
  const d = await indexDir();
  const out: StudioProject[] = [];
  for (const f of (await fs.readdir(d)).filter((x) => x.endsWith('.json'))) {
    const p = await readJson<StudioProject | null>(path.join(/*turbopackIgnore: true*/ d, f), null);
    if (p?.id) out.push(p);
  }
  return out.sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}

/** Ruta dentro de la carpeta del proyecto (nunca fuera). */
export function insideStudio(p: StudioProject, rel: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ p.carpeta, rel);
  if (!isInside(p.carpeta, abs) || abs === path.resolve(/*turbopackIgnore: true*/ p.carpeta)) throw new StudioError('El archivo tiene que estar dentro de la carpeta del proyecto.');
  return abs;
}

export function newMediaId(): string {
  return `m_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export function newApprovalId(): string {
  return `ap_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
