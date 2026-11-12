import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { feedbackConfigured, getFile, getJsonTagged, putFile, putJsonIfUnchanged } from '@/lib/feedback/r2';
import { getSettings } from '@/lib/data/settings';
import { probeMedia } from '@/lib/video/ffmpeg';
import { detectBeats } from './beats';

/**
 * Biblioteca de audio del equipo (Fase 2 · sonido): efectos, música y ambientes REALES que sube el
 * equipo, cada uno con su licencia. COMPARTIDA por los 4 en el bucket R2 de la app de feedback (como
 * el manual): catálogo `_lulo/audio/catalogo.json` (escrituras condicionales) y archivos en
 * `_lulo/audio/archivos/<id>.<ext>`. Caché local en `<datos>/audio-biblioteca/` (lo ya bajado no se
 * vuelve a bajar). Sin R2 configurado, la biblioteca es solo de este PC.
 *
 * Claude la ve en `biblioteca_audio` y la usa en el plan con `archivo: "biblioteca:<id>"`; al guardar
 * el plan la app copia el archivo a la carpeta de la edición. Las entradas «solo en la app» (sonidos
 * en tendencia con licencia de la plataforma) no se meten en el MP4: se añaden al publicar.
 */

export const AUDIO_KINDS = ['efecto', 'musica', 'ambiente'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];
export const LIBRARY_EXT: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

export interface LibraryItem {
  id: string;
  nombre: string;
  tipo: AudioKind;
  etiquetas: string[];
  /** Licencia (obligatoria): «CC0», «Pixabay License», «comprado en Epidemic (cuenta Lulo)»… */
  licencia: string;
  /** De dónde salió (URL o nombre del sitio). */
  fuente?: string;
  /** Para qué sirve / cuándo usarlo (lo lee Claude). */
  nota?: string;
  /** Sonido en tendencia que solo se puede usar desde la propia app (TikTok/Instagram): no va en el MP4. */
  soloEnApp?: boolean;
  duracion: number;
  bpm?: number;
  ext: string;
  bytes: number;
  subidoPor: string;
  fecha: string;
  estado: 'activa' | 'retirada';
}

export interface AudioLibrary {
  version: number;
  actualizado: string;
  items: LibraryItem[];
}

export const LibraryInputSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  tipo: z.enum(AUDIO_KINDS),
  etiquetas: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  licencia: z.string().trim().min(3, 'Indica la licencia (p. ej. «CC0», «Pixabay License»).').max(200),
  fuente: z.string().trim().max(300).optional(),
  nota: z.string().trim().max(300).optional(),
  soloEnApp: z.boolean().default(false),
});
export type LibraryInput = z.infer<typeof LibraryInputSchema>;

export class LibraryError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const CATALOG_KEY = '_lulo/audio/catalogo.json';
const fileKey = (it: Pick<LibraryItem, 'id' | 'ext'>) => `_lulo/audio/archivos/${it.id}${it.ext}`;
const localDir = () => path.join(/*turbopackIgnore: true*/ getDataDir(), 'audio-biblioteca');
const localCatalog = () => path.join(localDir(), 'catalogo.json');
export const localItemPath = (it: Pick<LibraryItem, 'id' | 'ext'>) => path.join(localDir(), `${it.id}${it.ext}`);

const empty = (): AudioLibrary => ({ version: 0, actualizado: new Date().toISOString(), items: [] });

async function readLocal(): Promise<AudioLibrary | null> {
  try {
    return JSON.parse(await fs.readFile(localCatalog(), 'utf8')) as AudioLibrary;
  } catch {
    return null;
  }
}
async function saveLocal(l: AudioLibrary) {
  await fs.mkdir(localDir(), { recursive: true });
  await writeJsonAtomic(localCatalog(), l).catch(() => undefined);
}

export async function loadLibrary(): Promise<{ biblioteca: AudioLibrary; compartida: boolean; aviso?: string }> {
  if (feedbackConfigured()) {
    try {
      const { data } = await getJsonTagged<AudioLibrary>(CATALOG_KEY);
      const lib = data ?? empty();
      await saveLocal(lib);
      return { biblioteca: lib, compartida: true };
    } catch (err) {
      return { biblioteca: (await readLocal()) ?? empty(), compartida: false, aviso: `Sin conexión con la biblioteca compartida (${err instanceof Error ? err.message : 'error'}): se muestra la copia de este PC.` };
    }
  }
  return { biblioteca: (await readLocal()) ?? empty(), compartida: false, aviso: 'La biblioteca es solo de este PC: configura la app de feedback (FEEDBACK_R2_*) para compartirla con el equipo.' };
}

async function updateLibrary<T>(fn: (l: AudioLibrary) => T): Promise<{ biblioteca: AudioLibrary; result: T }> {
  const apply = (l: AudioLibrary) => {
    const copy: AudioLibrary = JSON.parse(JSON.stringify(l));
    const result = fn(copy);
    copy.version = (l.version ?? 0) + 1;
    copy.actualizado = new Date().toISOString();
    return { copy, result };
  };
  if (feedbackConfigured()) {
    for (let i = 0; i < 6; i++) {
      const { data, etag } = await getJsonTagged<AudioLibrary>(CATALOG_KEY);
      const { copy, result } = apply(data ?? empty());
      if (await putJsonIfUnchanged(CATALOG_KEY, copy, data ? etag : null)) {
        await saveLocal(copy);
        return { biblioteca: copy, result };
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    }
    throw new LibraryError('Otra persona está cambiando la biblioteca a la vez: vuelve a intentarlo.', 409);
  }
  const { copy, result } = apply((await readLocal()) ?? empty());
  await saveLocal(copy);
  return { biblioteca: copy, result };
}

/** Añade un audio (ya en disco, en `tmpFile`) a la biblioteca. */
export async function addToLibrary(tmpFile: string, originalName: string, input: LibraryInput): Promise<LibraryItem> {
  const ext = path.extname(originalName).toLowerCase();
  if (!LIBRARY_EXT[ext]) throw new LibraryError(`Formato no admitido (${Object.keys(LIBRARY_EXT).join(', ')}).`);
  const info = await probeMedia(tmpFile).catch(() => null);
  const duracion = Math.round((info?.duration ?? 0) * 100) / 100;
  if (!duracion) throw new LibraryError('No se pudo leer el audio (¿archivo dañado?).');
  if (input.tipo === 'efecto' && duracion > 20) throw new LibraryError('Un efecto dura como mucho 20 s: súbelo como música o ambiente.');
  const settings = await getSettings().catch(() => null);
  const item: LibraryItem = {
    id: `a${randomUUID().replace(/-/g, '').slice(0, 10)}`,
    ...input,
    duracion,
    ext,
    bytes: fsSync.statSync(tmpFile).size,
    subidoPor: (settings as { personName?: string } | null)?.personName?.trim() || 'Equipo',
    fecha: new Date().toISOString(),
    estado: 'activa',
  };
  if (input.tipo === 'musica' && !input.soloEnApp) {
    const g = await detectBeats(tmpFile, 0, Math.min(90, duracion)).catch(() => null);
    if (g && (g.confianza ?? 0) >= 0.3) item.bpm = Math.round(g.bpm);
  }
  await fs.mkdir(localDir(), { recursive: true });
  await fs.copyFile(tmpFile, localItemPath(item));
  if (feedbackConfigured()) await putFile(fileKey(item), tmpFile, LIBRARY_EXT[ext], { nombre: item.nombre, licencia: item.licencia });
  await updateLibrary((l) => l.items.push(item));
  return item;
}

export async function setItemState(id: string, estado: LibraryItem['estado']): Promise<LibraryItem> {
  const { result } = await updateLibrary((l) => {
    const it = l.items.find((x) => x.id === id);
    if (!it) throw new LibraryError('Ese audio no está en la biblioteca.', 404);
    it.estado = estado;
    return it;
  });
  return result;
}

export async function editItem(id: string, patch: Partial<LibraryInput>): Promise<LibraryItem> {
  const clean = LibraryInputSchema.partial().parse(patch);
  const { result } = await updateLibrary((l) => {
    const it = l.items.find((x) => x.id === id);
    if (!it) throw new LibraryError('Ese audio no está en la biblioteca.', 404);
    Object.assign(it, clean);
    return it;
  });
  return result;
}

/** Ruta local del audio (lo baja de R2 si este PC aún no lo tiene). */
export async function ensureLocal(it: LibraryItem): Promise<string> {
  const p = localItemPath(it);
  if (fsSync.existsSync(p)) return p;
  if (!feedbackConfigured()) throw new LibraryError(`«${it.nombre}» no está en este PC.`, 404);
  await fs.mkdir(localDir(), { recursive: true });
  await getFile(fileKey(it), p);
  return p;
}

export async function findItem(id: string): Promise<LibraryItem> {
  const { biblioteca } = await loadLibrary();
  const it = biblioteca.items.find((x) => x.id === id);
  if (!it) throw new LibraryError(`biblioteca:${id} no existe (mira biblioteca_audio).`, 404);
  return it;
}

/** Lo que ve Claude: solo lo activo, filtrado. */
export function libraryForClaude(l: AudioLibrary, filtro: { tipo?: AudioKind; texto?: string } = {}) {
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = filtro.texto ? norm(filtro.texto) : '';
  return l.items
    .filter((it) => it.estado === 'activa')
    .filter((it) => !filtro.tipo || it.tipo === filtro.tipo)
    .filter((it) => !q || norm([it.nombre, it.nota ?? '', ...it.etiquetas].join(' ')).includes(q))
    .map((it) => ({
      ref: `biblioteca:${it.id}`,
      nombre: it.nombre,
      tipo: it.tipo,
      etiquetas: it.etiquetas,
      duracion: it.duracion,
      ...(it.bpm ? { bpm: it.bpm } : {}),
      ...(it.nota ? { nota: it.nota } : {}),
      licencia: it.licencia,
      ...(it.soloEnApp ? { soloEnApp: 'Sonido en tendencia: NO va en el MP4; recomiéndalo para añadirlo al publicar.' } : {}),
    }));
}

const REF = /^biblioteca:([a-z0-9]+)$/i;

/**
 * Copia a la carpeta de la edición (`biblioteca/`) todo audio del plan que venga como
 * «biblioteca:<id>» y cambia la referencia por la ruta relativa. Muta `plan`. Devuelve los problemas.
 */
export async function materializeLibraryRefs(carpeta: string, plan: { sonidos?: Array<{ tipo: string; archivo?: string }>; musica?: { modo: string; archivo?: string }; ambientes?: Array<{ tipo: string; archivo?: string }> }): Promise<string[]> {
  const problems: string[] = [];
  const refs: Array<{ obj: { archivo?: string }; what: string }> = [];
  plan.sonidos?.forEach((s, i) => s.archivo && REF.test(s.archivo) && refs.push({ obj: s, what: `sonidos[${i}]` }));
  if (plan.musica?.archivo && REF.test(plan.musica.archivo)) refs.push({ obj: plan.musica, what: 'musica' });
  plan.ambientes?.forEach((a, i) => a.archivo && REF.test(a.archivo) && refs.push({ obj: a, what: `ambientes[${i}]` }));
  if (!refs.length) return problems;
  const { biblioteca } = await loadLibrary();
  const dest = path.join(/*turbopackIgnore: true*/ carpeta, 'biblioteca');
  await fs.mkdir(dest, { recursive: true });
  const done = new Map<string, string>();
  for (const r of refs) {
    const id = REF.exec(r.obj.archivo!)![1];
    const it = biblioteca.items.find((x) => x.id === id);
    if (!it) {
      problems.push(`${r.what}: biblioteca:${id} no existe (mira biblioteca_audio).`);
      continue;
    }
    if (it.soloEnApp) {
      problems.push(`${r.what}: «${it.nombre}» es un sonido en tendencia que solo se puede añadir desde la app de la red al publicar; no va en el MP4.`);
      continue;
    }
    if (!done.has(id)) {
      try {
        const src = await ensureLocal(it);
        const rel = `biblioteca/${it.id}${it.ext}`;
        if (!fsSync.existsSync(path.join(/*turbopackIgnore: true*/ carpeta, rel))) await fs.copyFile(src, path.join(/*turbopackIgnore: true*/ carpeta, rel));
        done.set(id, rel);
      } catch (err) {
        problems.push(`${r.what}: no se pudo traer «${it.nombre}» (${err instanceof Error ? err.message : 'error'}).`);
        continue;
      }
    }
    r.obj.archivo = done.get(id);
    // Música de la biblioteca: siempre como archivo
    if (r.what === 'musica' && 'modo' in r.obj) (r.obj as { modo: string }).modo = 'archivo';
  }
  return problems;
}
