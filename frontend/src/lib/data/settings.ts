import os from 'os';
import path from 'path';
import { ensureDataDir, readJson, writeJsonAtomic } from './data-dir';

export interface AppSettings {
  /** Carpeta donde se guardan proyectos, voces y todo lo generado. */
  basePath?: string;
  /** Nombre de quien usa este PC; aparece en el registro de costos. */
  personName?: string;
  /** Límite de gasto diario en USD (0 o vacío = sin límite). */
  dailyLimitUSD?: number;
}

async function settingsPath() {
  const dir = await ensureDataDir();
  return path.join(/*turbopackIgnore: true*/ dir, 'settings.json');
}

export async function getSettings(): Promise<AppSettings> {
  return readJson<AppSettings>(await settingsPath(), {});
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const file = await settingsPath();
  const current = await readJson<AppSettings>(file, {});
  const next = { ...current, ...patch };
  await writeJsonAtomic(file, next);
  return next;
}

/** Nombre para el registro: el configurado o, si no hay, el usuario de Windows. */
export async function getPersonName(): Promise<string> {
  const s = await getSettings();
  if (s.personName?.trim()) return s.personName.trim();
  try {
    return os.userInfo().username || 'Sin nombre';
  } catch {
    return 'Sin nombre';
  }
}
