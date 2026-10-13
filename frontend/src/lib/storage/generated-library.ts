import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getStorageBasePath } from './project-storage';

/**
 * Biblioteca de todo lo generado: cada audio y video se copia aquí en cuanto existe,
 * aunque nadie pulse "Guardar proyecto". Vive en la carpeta de proyectos del usuario
 * (fuera de la app), organizada por mes:
 *
 *   <carpeta de proyectos>\Generados\2026-10\video_2026-10-12_21-30-05_<id>.mp4
 */
export async function getGeneratedDir(date = new Date()): Promise<string> {
  const base = await getStorageBasePath();
  const month = date.toISOString().slice(0, 7);
  const dir = path.join(/*turbopackIgnore: true*/ base, 'Generados', month);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}

function stamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** Guarda un buffer en la biblioteca y devuelve la ruta absoluta. */
export async function saveGenerated(
  kind: 'audio' | 'video' | 'image',
  buffer: Buffer | Uint8Array,
  ext: string,
  id: string,
): Promise<string> {
  const now = new Date();
  const dir = await getGeneratedDir(now);
  const file = path.join(/*turbopackIgnore: true*/ dir, `${kind}_${stamp(now)}_${id.slice(0, 8)}.${ext.replace(/^\./, '')}`);
  await fs.writeFile(file, buffer);
  return file;
}

/** Descarga una URL (p. ej. el MP4 del proveedor) directamente a la biblioteca. */
export async function downloadToLibrary(
  url: string,
  kind: 'audio' | 'video' | 'image',
  ext: string,
  id: string,
  headers?: Record<string, string>,
): Promise<{ path: string; bytes: Buffer }> {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el archivo generado (${res.status}).`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const filePath = await saveGenerated(kind, bytes, ext, id);
  return { path: filePath, bytes };
}

/** URL para que la app muestre un archivo local (usa la ruta de medios existente). */
export function localMediaUrl(filePath: string): string {
  return `/api/projects/media?path=${encodeURIComponent(filePath)}`;
}
