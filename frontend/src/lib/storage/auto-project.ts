import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  getStorageBasePath,
  saveProject,
  sanitizeProjectName,
  type ProjectCategory,
  type ProjectMetadata,
  type SaveProjectPayload,
} from './project-storage';

/**
 * Guardado automático en Proyectos: en cuanto un video o una imagen termina, se crea su
 * carpeta de proyecto con los archivos DENTRO (video.mp4, imagen_1.png, voz.mp3…), además
 * de la copia que ya queda en Generados. Así nada depende de pulsar "Guardar".
 *
 *   <carpeta de proyectos>\TextToVideo\Mi-anuncio-2026-10-13-23h40\video.mp4
 */

function stamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

/** Nombre de carpeta libre: "Título 2026-10-13 23h40", y si existe, "... (2)". */
async function freeProjectDir(category: ProjectCategory, title: string): Promise<{ name: string; dir: string }> {
  const base = await getStorageBasePath();
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 50) || 'Proyecto';
  for (let i = 1; i < 100; i++) {
    const name = sanitizeProjectName(`${clean} ${stamp()}${i > 1 ? ` (${i})` : ''}`);
    const dir = path.join(/*turbopackIgnore: true*/ base, category, name);
    if (!fsSync.existsSync(dir)) return { name, dir };
  }
  const name = sanitizeProjectName(`${clean} ${Date.now()}`);
  return { name, dir: path.join(/*turbopackIgnore: true*/ base, category, name) };
}

/** Pone un archivo dentro de la carpeta del proyecto sin duplicar espacio si se puede (enlace duro). */
async function placeFile(src: string, destDir: string, destName: string): Promise<string | undefined> {
  if (!src || !fsSync.existsSync(src)) return undefined;
  const dest = path.join(/*turbopackIgnore: true*/ destDir, destName);
  if (fsSync.existsSync(dest)) return dest;
  try {
    await fs.link(src, dest); // mismo disco: no ocupa espacio extra
  } catch {
    await fs.copyFile(src, dest); // otro disco o sin permisos de enlace
  }
  return dest;
}

export interface AutoProjectMedia {
  /** Video final (ruta local, normalmente en Generados). */
  videoPath?: string;
  /** Audio de voz (ruta local). */
  audioPath?: string;
  /** Imagen principal: foto de la persona o portada (ruta local). */
  imagePath?: string;
  /** Varias imágenes generadas (Creación de imágenes). */
  imagePaths?: string[];
}

/**
 * Crea el proyecto con sus archivos dentro. Nunca lanza: si falla, lo registra en consola
 * y devuelve null (el archivo sigue en Generados y el costo en Costos).
 */
export async function autoSaveProject(
  category: ProjectCategory,
  title: string,
  data: SaveProjectPayload,
  media: AutoProjectMedia = {}
): Promise<ProjectMetadata | null> {
  try {
    const { name, dir } = await freeProjectDir(category, title);
    await fs.mkdir(dir, { recursive: true });

    const ext = (p?: string, fallback = '') => (p ? path.extname(p).toLowerCase() : fallback) || fallback;
    const videoPath = media.videoPath ? await placeFile(media.videoPath, dir, `video${ext(media.videoPath, '.mp4')}`) : undefined;
    const audioPath = media.audioPath ? await placeFile(media.audioPath, dir, `voz${ext(media.audioPath, '.mp3')}`) : undefined;
    const imagePath = media.imagePath ? await placeFile(media.imagePath, dir, `foto${ext(media.imagePath, '.png')}`) : undefined;
    const imagePaths: string[] = [];
    for (const [i, src] of (media.imagePaths ?? []).entries()) {
      const placed = await placeFile(src, dir, `imagen_${i + 1}${ext(src, '.png')}`);
      if (placed) imagePaths.push(placed);
    }

    const { project } = await saveProject(category, name, {
      ...data,
      title: data.title || title,
      videoPath: videoPath ?? data.videoPath,
      audioPath: audioPath ?? data.audioPath,
      imagePath: imagePath ?? data.imagePath ?? imagePaths[0],
      imagePaths: imagePaths.length ? imagePaths : data.imagePaths,
      status: data.status || 'rendered',
      tags: [...new Set([...(data.tags ?? []), 'auto'])],
    });
    return project;
  } catch (err) {
    console.warn('[proyectos] No se pudo guardar automáticamente:', err instanceof Error ? err.message : err);
    return null;
  }
}
