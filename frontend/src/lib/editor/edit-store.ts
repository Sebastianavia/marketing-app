import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { getStorageBasePath, sanitizeProjectName } from '@/lib/storage/project-storage';
import type { EditProject, EditSummary } from './types';

/**
 * Almacén de ediciones.
 *  - Índice y estado: <datos>/edits/<id>.json (no se pierde al actualizar la app).
 *  - Archivos: <proyectos>\Generados\Ediciones\<Título fecha>\ (original, audio, subtítulos, borradores).
 * Cada escritura pasa por un candado por edición para que el runner y la pantalla no se pisen.
 */

export class EditError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

const MAX_ACTIVITY = 40;

async function indexDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'edits');
  await fs.mkdir(d, { recursive: true });
  return d;
}

function safeId(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new EditError('Edición no encontrada.', 404);
  return id;
}

async function indexFile(id: string): Promise<string> {
  return path.join(/*turbopackIgnore: true*/ await indexDir(), `${safeId(id)}.json`);
}

export function newEditId(): string {
  return crypto.randomUUID();
}

function stamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

/** Crea la carpeta de trabajo: "<Título> 2026-11-02 22h40", y si existe, "... (2)". */
export async function createWorkFolder(titulo: string): Promise<string> {
  const base = path.join(/*turbopackIgnore: true*/ await getStorageBasePath(), 'Generados', 'Ediciones');
  const clean = titulo.replace(/\s+/g, ' ').trim().slice(0, 50) || 'Edicion';
  for (let i = 1; i < 100; i++) {
    const name = sanitizeProjectName(`${clean} ${stamp()}${i > 1 ? ` (${i})` : ''}`) || `Edicion-${Date.now()}`;
    const dir = path.join(/*turbopackIgnore: true*/ base, name);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
      return dir;
    }
  }
  const dir = path.join(/*turbopackIgnore: true*/ base, `Edicion-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Ruta de un archivo dentro de la carpeta de la edición (nunca fuera de ella). */
export function editFile(p: Pick<EditProject, 'carpeta'>, name: string): string {
  const clean = path.basename(name);
  return path.join(/*turbopackIgnore: true*/ p.carpeta, clean);
}

export async function saveNewEdit(p: EditProject): Promise<EditProject> {
  await writeJsonAtomic(await indexFile(p.id), p);
  return p;
}

export async function getEdit(id: string): Promise<EditProject> {
  const p = await readJson<EditProject | null>(await indexFile(id), null);
  if (!p) throw new EditError('Esta edición ya no existe.', 404);
  return p;
}

// En globalThis: las rutas y el runner pueden cargar copias distintas de este módulo en desarrollo
const g = globalThis as unknown as { __luloEditLocks?: Map<string, Promise<unknown>> };
const locks = (g.__luloEditLocks ??= new Map<string, Promise<unknown>>());

/** Lee, modifica y guarda con candado. `fn` puede devolver un valor. */
export async function updateEdit<T = void>(id: string, fn: (p: EditProject) => T | Promise<T>): Promise<{ edit: EditProject; result: T }> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = prev.then(() => mine);
  locks.set(id, chain);
  await prev.catch(() => undefined);
  try {
    const p = await getEdit(id);
    const result = await fn(p);
    p.actualizado = new Date().toISOString();
    await writeJsonAtomic(await indexFile(id), p);
    return { edit: p, result };
  } finally {
    release();
    if (locks.get(id) === chain) locks.delete(id);
  }
}

/** Añade una línea al registro de actividad (lo que se ve en "Actividad"). */
export function logActivity(p: EditProject, msg: string) {
  p.actividad = [...(p.actividad ?? []), { t: new Date().toISOString(), msg }].slice(-MAX_ACTIVITY);
}

export async function listEdits(): Promise<EditProject[]> {
  const d = await indexDir();
  const files = (await fs.readdir(d)).filter((f) => f.endsWith('.json'));
  const out: EditProject[] = [];
  for (const f of files) {
    const p = await readJson<EditProject | null>(path.join(/*turbopackIgnore: true*/ d, f), null);
    if (p?.id) out.push(p);
  }
  return out.sort((a, b) => b.creado.localeCompare(a.creado));
}

export function summarize(p: EditProject): EditSummary {
  return {
    id: p.id,
    titulo: p.titulo,
    estado: p.estado,
    creado: p.creado,
    actualizado: p.actualizado,
    perfilNombre: p.perfil?.nombre ?? '',
    duracionOriginal: p.original?.duracion ?? 0,
    duracionFinal: p.borrador?.duracion,
    error: p.error?.mensaje,
  };
}

/**
 * Quita la edición de la lista. La carpeta de trabajo NO se borra (puede tener el original):
 * se mueve el índice a edits/_papelera.
 */
export async function archiveEdit(id: string): Promise<void> {
  const file = await indexFile(id);
  if (!fsSync.existsSync(file)) throw new EditError('Esta edición ya no existe.', 404);
  const trash = path.join(/*turbopackIgnore: true*/ await indexDir(), '_papelera');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(file, path.join(/*turbopackIgnore: true*/ trash, `${id}.json`));
}
