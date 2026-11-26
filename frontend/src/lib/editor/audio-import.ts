import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { feedbackConfigured, putFile } from '@/lib/feedback/r2';
import { getSettings } from '@/lib/data/settings';
import { probeMedia } from '@/lib/video/ffmpeg';
import { validateMaterialFolder } from '@/lib/material/material';
import { detectBeats } from './beats';
import {
  LIBRARY_EXT,
  LibraryError,
  fileHash,
  fileKey,
  guessKind,
  loadLibrary,
  localDir,
  nameFromKey,
  tagsFromKey,
  updateLibrary,
  type LibraryItem,
} from './audio-library';

/**
 * Importar una carpeta entera a la biblioteca de audio (packs de cursos, descargas…): recorre las
 * subcarpetas, sube cada audio al bucket en `audio/<pack>/<ruta dentro de la carpeta>` (con R2) y lo
 * da de alta con nombre del archivo, tipo y etiquetas sacados de las carpetas, duración y BPM.
 * El mismo audio (misma huella) no entra dos veces, aunque tenga otro nombre o esté repetido en el
 * pack. Corre en segundo plano; si la app se cierra a mitad, volver a importar salta lo ya hecho.
 */

export interface ImportJob {
  id: string;
  carpeta: string;
  pack: string;
  estado: 'buscando' | 'importando' | 'terminado' | 'error' | 'cancelado';
  total: number;
  hechos: number;
  nuevos: number;
  duplicados: number;
  errores: Array<{ archivo: string; error: string }>;
  actual?: string;
  inicio: string;
  fin?: string;
  error?: string;
}

const MAX_FILES = 5000;
const MAX_DEPTH = 10;
/** Altas al catálogo de tantas en tantas (menos escrituras en el bucket). */
const FLUSH_EVERY = 20;

const g = globalThis as unknown as { __luloAudioImports?: Map<string, ImportJob & { cancel?: boolean }> };
const jobs = (g.__luloAudioImports ??= new Map());

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'pack';

async function walk(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('__MACOSX')) continue;
    const full = path.join(/*turbopackIgnore: true*/ dir, e.name);
    if (e.isDirectory()) await walk(full, depth + 1, out);
    else if (e.isFile() && LIBRARY_EXT[path.extname(e.name).toLowerCase()]) out.push(full);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * Fichas de etiquetas que acompañan a un pack (`_etiquetas.json` en cualquier carpeta):
 * `{ pistas|efectos|items: [{ archivo: "musica/calma/x.mp3", etiquetas: ["Calma", "Destacadas"] }] }`.
 * Devuelve ruta relativa (y nombre de archivo, por si la ruta no coincide) → etiquetas.
 */
async function sidecarTags(root: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const visit = async (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(/*turbopackIgnore: true*/ dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) await visit(full, depth + 1);
      else if (e.isFile() && e.name.toLowerCase() === '_etiquetas.json') {
        try {
          const data = JSON.parse(await fs.readFile(full, 'utf8')) as Record<string, unknown>;
          const list = (data.pistas ?? data.efectos ?? data.items ?? []) as Array<{ archivo?: string; etiquetas?: unknown }>;
          for (const it of Array.isArray(list) ? list : []) {
            if (!it?.archivo || !Array.isArray(it.etiquetas)) continue;
            const tags = it.etiquetas.filter((t): t is string => typeof t === 'string').map((t) => t.replace(/^★\s*/, '').trim().toLowerCase().slice(0, 30)).filter(Boolean);
            const rel = it.archivo.replace(/\\/g, '/');
            out.set(rel.toLowerCase(), tags);
            out.set(`#${path.posix.basename(rel).toLowerCase()}`, tags);
          }
        } catch {
          // ficha dañada: se ignora
        }
      }
    }
  };
  await visit(root, 0);
  return out;
}

export function getImportJob(id: string): ImportJob | null {
  const j = jobs.get(id);
  if (!j) return null;
  const { cancel: _c, ...rest } = j;
  void _c;
  return rest;
}

export function listImportJobs(): ImportJob[] {
  return [...jobs.values()].map((j) => getImportJob(j.id)!).sort((a, b) => b.inicio.localeCompare(a.inicio));
}

export function cancelImport(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.estado === 'terminado' || j.estado === 'error') return false;
  j.cancel = true;
  return true;
}

/** Empieza a importar `carpeta`. `pack` = nombre del pack (por defecto, el de la carpeta). */
export async function startImport(carpeta: string, pack?: string): Promise<ImportJob> {
  const real = await validateMaterialFolder(carpeta).catch((err) => {
    throw new LibraryError(err instanceof Error ? err.message : 'Carpeta no válida.');
  });
  if ([...jobs.values()].some((j) => j.carpeta === real && (j.estado === 'buscando' || j.estado === 'importando'))) {
    throw new LibraryError('Esa carpeta ya se está importando.', 409);
  }
  const job: ImportJob & { cancel?: boolean } = {
    id: randomUUID().slice(0, 8),
    carpeta: real,
    pack: (pack?.trim() || path.basename(real)).slice(0, 60),
    estado: 'buscando',
    total: 0,
    hechos: 0,
    nuevos: 0,
    duplicados: 0,
    errores: [],
    inicio: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  void runImport(job).catch((err) => {
    job.estado = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    job.fin = new Date().toISOString();
  });
  return getImportJob(job.id)!;
}

async function runImport(job: ImportJob & { cancel?: boolean }) {
  const files = await walk(job.carpeta);
  const extraTags = await sidecarTags(job.carpeta);
  job.total = files.length;
  job.estado = 'importando';
  if (!files.length) {
    job.estado = 'terminado';
    job.fin = new Date().toISOString();
    job.error = 'No hay audios en esa carpeta (mp3, wav, m4a, aac, ogg, flac).';
    return;
  }
  const shared = feedbackConfigured();
  const { biblioteca } = await loadLibrary();
  const seen = new Set(biblioteca.items.filter((it) => it.estado === 'activa' && it.huella).map((it) => it.huella!));
  const knownKeys = new Set(biblioteca.items.map((it) => fileKey(it)));
  const settings = await getSettings().catch(() => null);
  const who = (settings as { personName?: string } | null)?.personName?.trim() || 'Equipo';
  const packSlug = slug(job.pack);
  await fs.mkdir(localDir(), { recursive: true });

  let pending: LibraryItem[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await updateLibrary((l) => {
      const have = new Set(l.items.map((it) => it.huella).filter(Boolean));
      for (const it of batch) if (!have.has(it.huella)) l.items.push(it);
    });
  };

  for (const file of files) {
    if (job.cancel) {
      job.estado = 'cancelado';
      break;
    }
    const rel = path.relative(job.carpeta, file).split(path.sep).join('/');
    job.actual = rel;
    try {
      const huella = await fileHash(file);
      if (seen.has(huella)) {
        job.duplicados++;
        continue;
      }
      const info = await probeMedia(file).catch(() => null);
      const duracion = Math.round((info?.duration ?? 0) * 100) / 100;
      if (!duracion) throw new Error('no se pudo leer (¿archivo dañado?)');
      const ext = path.extname(file).toLowerCase();
      const key = `audio/${packSlug}/${rel}`;
      const id = `a${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      // Tipo y etiquetas: la ruta dentro del pack (las carpetas del curso dicen mucho: «SFX/Whoosh»)
      const tipo = guessKind(rel, duracion);
      const item: LibraryItem = {
        id,
        nombre: nameFromKey(rel),
        tipo,
        etiquetas: [
          ...new Set([
            ...tagsFromKey(rel),
            ...(extraTags.get(rel.toLowerCase()) ?? extraTags.get(`#${path.posix.basename(rel).toLowerCase()}`) ?? []),
            job.pack.toLowerCase().slice(0, 30),
          ]),
        ].slice(0, 12),
        licencia: '',
        pack: job.pack,
        ...(shared ? { clave: key } : {}),
        huella,
        duracion,
        ext,
        bytes: fsSync.statSync(file).size,
        subidoPor: who,
        fecha: new Date().toISOString(),
        estado: 'activa',
      };
      if (tipo === 'musica') {
        const b = await detectBeats(file, 0, Math.min(90, duracion)).catch(() => null);
        if (b && (b.confianza ?? 0) >= 0.3) item.bpm = Math.round(b.bpm);
      }
      // Si la app se cerró a mitad, el archivo puede estar ya en el bucket: no se vuelve a subir
      if (shared && !knownKeys.has(key)) await putFile(key, file, LIBRARY_EXT[ext], { nombre: encodeURIComponent(item.nombre) });
      await fs.copyFile(file, path.join(/*turbopackIgnore: true*/ localDir(), `${id}${ext}`));
      seen.add(huella);
      pending.push(item);
      job.nuevos++;
      if (pending.length >= FLUSH_EVERY) await flush();
    } catch (err) {
      if (job.errores.length < 200) job.errores.push({ archivo: rel, error: err instanceof Error ? err.message : String(err) });
    } finally {
      job.hechos++;
    }
  }
  await flush();
  job.actual = undefined;
  if (job.estado !== 'cancelado') job.estado = 'terminado';
  job.fin = new Date().toISOString();
}
