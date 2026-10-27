import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { probeMedia } from '@/lib/video/ffmpeg';
import { ProductionError } from '@/lib/director/production-store';
import type { DirectorRef, RefMedia } from './types';

/**
 * Archivos de + Ref dentro de la carpeta de la producción (`referencias/`).
 * Aquí solo se escribe y se lee disco; registrarlos en produccion.json lo hace el motor bajo el candado.
 */

export const REF_DIR = 'referencias';
export const TRASH_DIR = '_borradas';
export const MAX_REFS = 40;
export const MAX_AUDIO_SECONDS = 10 * 60;

const MB = 1024 * 1024;
export const REF_LIMITS: Record<RefMedia, number> = { imagen: 15 * MB, audio: 50 * MB, pdf: 20 * MB };

/** Extensión → medio y tipo MIME (también lo usa la ruta que sirve los archivos). */
export const REF_TYPES: Record<string, { medio: RefMedia; mime: string }> = {
  '.jpg': { medio: 'imagen', mime: 'image/jpeg' },
  '.jpeg': { medio: 'imagen', mime: 'image/jpeg' },
  '.png': { medio: 'imagen', mime: 'image/png' },
  '.webp': { medio: 'imagen', mime: 'image/webp' },
  '.mp3': { medio: 'audio', mime: 'audio/mpeg' },
  // Algunos navegadores guardan los MP3 como «archivo.mp3.mpeg»: es el mismo formato
  '.mpeg': { medio: 'audio', mime: 'audio/mpeg' },
  '.mpga': { medio: 'audio', mime: 'audio/mpeg' },
  '.wav': { medio: 'audio', mime: 'audio/wav' },
  '.m4a': { medio: 'audio', mime: 'audio/mp4' },
  '.aac': { medio: 'audio', mime: 'audio/aac' },
  '.ogg': { medio: 'audio', mime: 'audio/ogg' },
  '.flac': { medio: 'audio', mime: 'audio/flac' },
  '.pdf': { medio: 'pdf', mime: 'application/pdf' },
};

const PREFIX: Record<RefMedia, string> = { imagen: 'foto', audio: 'audio', pdf: 'material' };

export interface IncomingRef {
  name: string;
  bytes: Buffer;
}

export type WrittenRef = Pick<DirectorRef, 'archivo' | 'nombreOriginal' | 'medio' | 'bytes' | 'duracionSeg'>;

export function refType(name: string) {
  return REF_TYPES[path.extname(name).toLowerCase()] ?? null;
}

/** Ruta absoluta de una referencia, comprobando que no se sale de la carpeta de la producción. */
export function refAbsPath(carpeta: string, archivo: string): string {
  const root = path.resolve(/*turbopackIgnore: true*/ carpeta);
  const abs = path.resolve(root, archivo);
  if (!abs.startsWith(root + path.sep)) throw new ProductionError('Ruta de referencia no válida.', 400);
  return abs;
}

function nextFree(dir: string, prefix: string, ext: string): string {
  for (let i = 1; ; i++) {
    const name = `${prefix}-${String(i).padStart(2, '0')}${ext}`;
    if (!fsSync.existsSync(path.join(/*turbopackIgnore: true*/ dir, name))) return name;
  }
}

/** Comprueba tipos y tamaños antes de escribir nada. */
export function validateIncoming(files: IncomingRef[], already: number) {
  if (!files.length) throw new ProductionError('No llegó ningún archivo.');
  if (already + files.length > MAX_REFS) throw new ProductionError(`Máximo ${MAX_REFS} referencias por proyecto (ya hay ${already}).`);
  for (const f of files) {
    const t = refType(f.name);
    if (!t) throw new ProductionError(`«${f.name}»: solo se admiten imágenes (JPG, PNG, WebP), audio (MP3, WAV, M4A, AAC, OGG, FLAC) o PDF.`);
    if (f.bytes.length > REF_LIMITS[t.medio]) throw new ProductionError(`«${f.name}» pesa más de ${REF_LIMITS[t.medio] / MB} MB.`);
  }
}

/**
 * Escribe los archivos en `referencias/` (foto-01.jpg, audio-01.mp3, material-01.pdf…).
 * El audio se mide con FFmpeg; si pasa de 10 minutos se borra y se rechaza.
 */
export async function writeRefFiles(carpeta: string, files: IncomingRef[]): Promise<WrittenRef[]> {
  const dir = path.join(/*turbopackIgnore: true*/ carpeta, REF_DIR);
  await fs.mkdir(dir, { recursive: true });
  const out: WrittenRef[] = [];
  try {
    for (const f of files) {
      const t = refType(f.name)!;
      const ext = path.extname(f.name).toLowerCase().replace('.jpeg', '.jpg').replace(/^\.(mpeg|mpga)$/, '.mp3');
      const name = nextFree(dir, PREFIX[t.medio], ext);
      const abs = path.join(/*turbopackIgnore: true*/ dir, name);
      await fs.writeFile(abs, f.bytes);
      const ref: WrittenRef = { archivo: `${REF_DIR}/${name}`, nombreOriginal: f.name.slice(0, 200), medio: t.medio, bytes: f.bytes.length };
      out.push(ref);
      if (t.medio === 'audio') {
        const { duration } = await probeMedia(abs).catch(() => ({ duration: null }));
        if (duration && duration > MAX_AUDIO_SECONDS) {
          throw new ProductionError(`«${f.name}» dura ${Math.round(duration / 60)} min: el máximo es ${MAX_AUDIO_SECONDS / 60} min.`);
        }
        if (duration) ref.duracionSeg = Math.round(duration * 100) / 100;
      }
    }
    return out;
  } catch (err) {
    // Si algo falla, no quedan archivos sueltos sin registrar
    await Promise.all(out.map((r) => fs.rm(path.join(/*turbopackIgnore: true*/ carpeta, r.archivo), { force: true })));
    throw err;
  }
}

/** Lo borrado no se pierde: pasa a `referencias/_borradas/`. */
export async function trashRefFile(carpeta: string, archivo: string) {
  const abs = refAbsPath(carpeta, archivo);
  if (!fsSync.existsSync(abs)) return;
  const dir = path.join(/*turbopackIgnore: true*/ carpeta, REF_DIR, TRASH_DIR);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(abs);
  let target = path.join(/*turbopackIgnore: true*/ dir, base);
  for (let i = 2; fsSync.existsSync(target); i++) target = path.join(/*turbopackIgnore: true*/ dir, `${path.parse(base).name}-${i}${path.extname(base)}`);
  await fs.rename(abs, target);
}

type SharpFn = (input: Buffer) => {
  rotate: () => { resize: (o: object) => { jpeg: (o: object) => { toBuffer: () => Promise<Buffer> } } };
};

let sharpCache: SharpFn | null | undefined;
async function loadSharp(): Promise<SharpFn | null> {
  if (sharpCache !== undefined) return sharpCache;
  try {
    sharpCache = ((await import('sharp')) as unknown as { default: SharpFn }).default;
  } catch {
    sharpCache = null;
  }
  return sharpCache;
}

/** Foto reducida (768 px, JPEG) para que la IA la mire sin gastar cuota de más. */
export async function imageForModel(carpeta: string, ref: DirectorRef): Promise<{ data: Uint8Array; mediaType: string; filename: string }> {
  const raw = await fs.readFile(refAbsPath(carpeta, ref.archivo));
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const small = await sharp(raw).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      return { data: new Uint8Array(small), mediaType: 'image/jpeg', filename: path.basename(ref.archivo) };
    } catch {
      // si falla, va la original
    }
  }
  return { data: new Uint8Array(raw), mediaType: refType(ref.archivo)!.mime, filename: path.basename(ref.archivo) };
}
