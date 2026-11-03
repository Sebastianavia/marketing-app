import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { DEFAULT_GRAPHICS, DEFAULT_PROFILES, DEFAULT_SOUND, ProfileInputSchema, type EditProfile, type ProfileInput } from '@/config/editor-looks';

/**
 * Biblioteca de perfiles de edición: <datos>/edit-profiles/<id>.json.
 * La primera vez se crean los perfiles de ejemplo; después son de la persona (los puede cambiar o borrar).
 * Borrar = mover a edit-profiles/_papelera.
 */

export class ProfileError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function dir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'edit-profiles');
  await fs.mkdir(d, { recursive: true });
  return d;
}

const SEEDED_FLAG = '.ejemplos-creados';

function safeId(id: string): string {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new ProfileError('Perfil no válido.', 404);
  return id;
}

function now() {
  return new Date().toISOString();
}

async function seedIfNeeded(d: string) {
  const flag = path.join(/*turbopackIgnore: true*/ d, SEEDED_FLAG);
  if (fsSync.existsSync(flag)) return;
  for (const input of DEFAULT_PROFILES) {
    const p: EditProfile = { ...JSON.parse(JSON.stringify(input)), id: crypto.randomUUID(), creado: now(), actualizado: now() };
    await writeJsonAtomic(path.join(/*turbopackIgnore: true*/ d, `${p.id}.json`), p);
  }
  await fs.writeFile(flag, now(), 'utf-8');
}

/** Completa campos que falten (perfiles guardados con una versión anterior). */
function normalize(p: EditProfile): EditProfile {
  const base = DEFAULT_PROFILES[0];
  return {
    ...p,
    descripcion: p.descripcion ?? '',
    sobreTi: p.sobreTi ?? '',
    instrucciones: p.instrucciones ?? '',
    formato: p.formato ?? base.formato,
    red: p.red ?? 'instagram',
    subtitulos: { ...base.subtitulos, ...p.subtitulos },
    gancho: { ...base.gancho, ...p.gancho },
    ritmo: { ...base.ritmo, ...p.ritmo },
    sonido: { ...DEFAULT_SOUND, ...p.sonido },
    graficos: { ...DEFAULT_GRAPHICS, ...p.graficos },
  };
}

let seeding: Promise<void> | null = null;

export async function listProfiles(): Promise<EditProfile[]> {
  const d = await dir();
  if (!seeding) seeding = seedIfNeeded(d).catch((err) => {
    seeding = null;
    throw err;
  });
  await seeding;
  const files = (await fs.readdir(d)).filter((f) => f.endsWith('.json'));
  const out: EditProfile[] = [];
  for (const f of files) {
    const p = await readJson<EditProfile | null>(path.join(/*turbopackIgnore: true*/ d, f), null);
    if (p?.id && p.nombre) out.push(normalize(p));
  }
  return out.sort((a, b) => a.creado.localeCompare(b.creado));
}

/** Para ediciones creadas antes de que existieran algunos campos del perfil. */
export function normalizeProfile(p: EditProfile): EditProfile {
  return normalize(p);
}

export async function getProfile(id: string): Promise<EditProfile> {
  const d = await dir();
  const p = await readJson<EditProfile | null>(path.join(/*turbopackIgnore: true*/ d, `${safeId(id)}.json`), null);
  if (!p) throw new ProfileError('Ese perfil ya no existe.', 404);
  return normalize(p);
}

export function parseProfileInput(raw: unknown): ProfileInput {
  const r = ProfileInputSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ProfileError(`${first?.path.join(' › ') || 'Perfil'}: ${first?.message ?? 'datos no válidos'}`);
  }
  return r.data;
}

export async function createProfile(raw: unknown): Promise<EditProfile> {
  const input = parseProfileInput(raw);
  const d = await dir();
  const p: EditProfile = { ...input, id: crypto.randomUUID(), creado: now(), actualizado: now() };
  await writeJsonAtomic(path.join(/*turbopackIgnore: true*/ d, `${p.id}.json`), p);
  return p;
}

export async function updateProfile(id: string, raw: unknown): Promise<EditProfile> {
  const current = await getProfile(id);
  const input = parseProfileInput(raw);
  const p: EditProfile = { ...input, id: current.id, creado: current.creado, actualizado: now() };
  const d = await dir();
  await writeJsonAtomic(path.join(/*turbopackIgnore: true*/ d, `${p.id}.json`), p);
  return p;
}

export async function deleteProfile(id: string): Promise<void> {
  const d = await dir();
  const file = path.join(/*turbopackIgnore: true*/ d, `${safeId(id)}.json`);
  if (!fsSync.existsSync(file)) throw new ProfileError('Ese perfil ya no existe.', 404);
  const trash = path.join(/*turbopackIgnore: true*/ d, '_papelera');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(file, path.join(/*turbopackIgnore: true*/ trash, `${id}-${Date.now()}.json`));
}
