import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getStorageBasePath, sanitizeProjectName } from '@/lib/storage/project-storage';
import { writeJsonAtomic } from '@/lib/data/data-dir';

/**
 * Avatares: personas guardadas con varias fotos para usarlas como referencia
 * en "Creación de imágenes". Cada avatar es una carpeta propia dentro de la
 * carpeta de proyectos del usuario (fuera de la app, sobrevive a actualizaciones):
 *
 *   <carpeta de proyectos>\Avatares\Valentina-3f9a2c\avatar.json
 *   <carpeta de proyectos>\Avatares\Valentina-3f9a2c\foto_2026-10-13_ab12cd.jpg
 *
 * Nada se borra de verdad: lo eliminado se mueve a Avatares\_papelera.
 */

/** Los modelos de imagen aceptan hasta 14 referencias en total. */
export const MAX_AVATAR_PHOTOS = 14;
export const AVATAR_PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp'] as const;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export interface AvatarPhoto {
  file: string;
  addedAt: string;
}

export interface Avatar {
  id: string;
  name: string;
  description: string;
  cover: string | null;
  photos: AvatarPhoto[];
  createdAt: string;
  updatedAt: string;
}

export class AvatarError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function avatarsRoot(): Promise<string> {
  const dir = path.join(/*turbopackIgnore: true*/ await getStorageBasePath(), 'Avatares');
  if (!fsSync.existsSync(dir)) await fs.mkdir(dir, { recursive: true });
  return dir;
}

function assertId(id: string) {
  if (!/^[\w.-]{1,100}$/.test(id) || id.includes('..') || id.startsWith('_')) {
    throw new AvatarError('Avatar no válido.');
  }
}

export async function avatarDir(id: string): Promise<string> {
  assertId(id);
  return path.join(/*turbopackIgnore: true*/ await avatarsRoot(), id);
}

async function readAvatar(id: string): Promise<Avatar | null> {
  const file = path.join(/*turbopackIgnore: true*/ await avatarDir(id), 'avatar.json');
  try {
    const a = JSON.parse(await fs.readFile(file, 'utf-8')) as Avatar;
    return { ...a, id, photos: Array.isArray(a.photos) ? a.photos : [] };
  } catch {
    return null;
  }
}

async function writeAvatar(a: Avatar) {
  const file = path.join(/*turbopackIgnore: true*/ await avatarDir(a.id), 'avatar.json');
  await writeJsonAtomic(file, a);
}

export async function getAvatar(id: string): Promise<Avatar> {
  const a = await readAvatar(id);
  if (!a) throw new AvatarError('No se encontró ese avatar.', 404);
  return a;
}

export async function listAvatars(): Promise<Avatar[]> {
  const root = await avatarsRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out: Avatar[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const a = await readAvatar(e.name).catch(() => null);
    if (a) out.push(a);
  }
  return out.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}

export async function createAvatar(name: string, description = ''): Promise<Avatar> {
  const clean = name.trim();
  if (clean.length < 2) throw new AvatarError('Ponle un nombre al avatar.');
  const slug = sanitizeProjectName(clean.normalize('NFD').replace(/[̀-ͯ]/g, '')).replace(/[^\w.-]/g, '').replace(/^[_.]+/, '').slice(0, 60) || 'avatar';
  const id = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.mkdir(await avatarDir(id), { recursive: true });
  const now = new Date().toISOString();
  const a: Avatar = { id, name: clean.slice(0, 80), description: description.trim().slice(0, 500), cover: null, photos: [], createdAt: now, updatedAt: now };
  await writeAvatar(a);
  return a;
}

export async function updateAvatar(id: string, patch: { name?: string; description?: string; cover?: string }): Promise<Avatar> {
  const a = await getAvatar(id);
  if (patch.name !== undefined) {
    if (patch.name.trim().length < 2) throw new AvatarError('El nombre es muy corto.');
    a.name = patch.name.trim().slice(0, 80);
  }
  if (patch.description !== undefined) a.description = patch.description.trim().slice(0, 500);
  if (patch.cover !== undefined) {
    if (!a.photos.some((p) => p.file === patch.cover)) throw new AvatarError('Esa foto no es de este avatar.');
    a.cover = patch.cover;
  }
  a.updatedAt = new Date().toISOString();
  await writeAvatar(a);
  return a;
}

export async function addAvatarPhoto(id: string, originalName: string, bytes: Buffer): Promise<Avatar> {
  const a = await getAvatar(id);
  if (a.photos.length >= MAX_AVATAR_PHOTOS) {
    throw new AvatarError(`Un avatar puede tener hasta ${MAX_AVATAR_PHOTOS} fotos (es el máximo que aceptan los modelos de imagen).`);
  }
  const ext = path.extname(originalName).toLowerCase();
  if (!(AVATAR_PHOTO_EXT as readonly string[]).includes(ext)) {
    throw new AvatarError(`${originalName}: usa JPG, PNG o WEBP (las fotos HEIC del iPhone conviértelas antes).`);
  }
  if (bytes.length > MAX_PHOTO_BYTES) throw new AvatarError(`${originalName} pesa más de 15 MB.`);
  const file = `foto_${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(4).toString('hex')}${ext === '.jpeg' ? '.jpg' : ext}`;
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ await avatarDir(id), file), bytes);
  a.photos.push({ file, addedAt: new Date().toISOString() });
  if (!a.cover) a.cover = file;
  a.updatedAt = new Date().toISOString();
  await writeAvatar(a);
  return a;
}

async function toTrash(src: string, label: string) {
  const trash = path.join(/*turbopackIgnore: true*/ await avatarsRoot(), '_papelera');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(src, path.join(/*turbopackIgnore: true*/ trash, `${Date.now()}_${label}`));
}

export async function removeAvatarPhoto(id: string, file: string): Promise<Avatar> {
  const a = await getAvatar(id);
  if (!a.photos.some((p) => p.file === file)) throw new AvatarError('Esa foto no es de este avatar.', 404);
  const src = path.join(/*turbopackIgnore: true*/ await avatarDir(id), file);
  if (fsSync.existsSync(src)) await toTrash(src, `${id}_${file}`);
  a.photos = a.photos.filter((p) => p.file !== file);
  if (a.cover === file) a.cover = a.photos[0]?.file ?? null;
  a.updatedAt = new Date().toISOString();
  await writeAvatar(a);
  return a;
}

export async function deleteAvatar(id: string): Promise<void> {
  const dir = await avatarDir(id);
  if (!fsSync.existsSync(dir)) throw new AvatarError('No se encontró ese avatar.', 404);
  await toTrash(dir, id);
}

/** Ruta absoluta de una foto del avatar (validada). */
export async function avatarPhotoPath(id: string, file: string): Promise<string> {
  return path.join(/*turbopackIgnore: true*/ await avatarDir(id), path.basename(file));
}

/**
 * Fotos del avatar como data URLs para la API de imágenes, portada primero.
 * Se reducen a 1536 px por lado (si sharp está disponible) para no enviar fotos de 10 MB.
 */
export async function avatarReferenceDataUrls(id: string, max: number): Promise<{ avatar: Avatar; urls: string[] }> {
  const avatar = await getAvatar(id);
  const ordered = [...avatar.photos].sort((x, y) => (x.file === avatar.cover ? -1 : y.file === avatar.cover ? 1 : 0));
  type SharpFn = (input: Buffer) => {
    rotate: () => { resize: (o: object) => { jpeg: (o: object) => { toBuffer: () => Promise<Buffer> } } };
  };
  let sharp: SharpFn | null = null;
  try {
    sharp = ((await import('sharp')) as unknown as { default: SharpFn }).default;
  } catch {
    sharp = null;
  }
  const urls: string[] = [];
  for (const p of ordered.slice(0, Math.max(0, max))) {
    const raw = await fs.readFile(await avatarPhotoPath(id, p.file)).catch(() => null);
    if (!raw) continue;
    if (sharp) {
      try {
        const small = await sharp(raw).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        urls.push(`data:image/jpeg;base64,${small.toString('base64')}`);
        continue;
      } catch {
        // si falla el redimensionado se envía la original
      }
    }
    const ext = path.extname(p.file).slice(1).replace('jpg', 'jpeg');
    urls.push(`data:image/${ext};base64,${raw.toString('base64')}`);
  }
  return { avatar, urls };
}
