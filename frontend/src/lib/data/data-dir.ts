import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Carpeta de datos del usuario, FUERA de la carpeta de la app.
 *
 * Aquí viven los datos que no se pueden perder al actualizar, reinstalar o
 * empaquetar la app como .exe: ajustes, registro de costos y trabajos de render.
 * Los videos y audios generados van a la carpeta de proyectos (ver generated-library.ts).
 *
 * Prioridad:
 *  1. LULO_DATA_DIR (el futuro .exe de Electron puede pasar app.getPath('userData'))
 *  2. Windows: %APPDATA%\LuloStudio
 *  3. macOS / Linux: ~/.lulo-studio
 */
export function getDataDir(): string {
  const override = process.env.LULO_DATA_DIR?.trim();
  if (override) return override;
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(/*turbopackIgnore: true*/ process.env.APPDATA, 'LuloStudio');
  }
  return path.join(/*turbopackIgnore: true*/ os.homedir(), '.lulo-studio');
}

/** Versión del formato de los datos guardados. Subirla solo junto a una migración. */
export const DATA_SCHEMA_VERSION = 1;

interface DataMeta {
  schemaVersion: number;
  createdAt: string;
  migratedAt?: string;
}

let ready: Promise<string> | null = null;

/**
 * Crea la carpeta de datos y aplica migraciones pendientes una sola vez por proceso.
 * Las migraciones nunca borran datos: solo copian o transforman hacia adelante.
 */
export function ensureDataDir(): Promise<string> {
  if (!ready) {
    ready = (async () => {
      const dir = getDataDir();
      for (const sub of ['', 'usage', 'jobs', 'backups']) {
        await fsp.mkdir(path.join(/*turbopackIgnore: true*/ dir, sub), { recursive: true });
      }

      const metaPath = path.join(/*turbopackIgnore: true*/ dir, 'meta.json');
      let meta: DataMeta = { schemaVersion: 0, createdAt: new Date().toISOString() };
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8'));
        } catch {
          // Si meta.json está dañado, se reescribe; los datos no se tocan.
        }
      }

      if (meta.schemaVersion < 1) {
        await migrateLegacyStorageConfig(dir);
        meta.schemaVersion = 1;
        meta.migratedAt = new Date().toISOString();
      }

      await writeJsonAtomic(metaPath, meta);
      return dir;
    })();
  }
  return ready;
}

/** v0 → v1: storage-config.json vivía dentro de la carpeta de la app (se perdía al actualizar). */
async function migrateLegacyStorageConfig(dir: string) {
  const legacy = path.join(/*turbopackIgnore: true*/ process.cwd(), 'storage-config.json');
  const settingsPath = path.join(/*turbopackIgnore: true*/ dir, 'settings.json');
  if (!fs.existsSync(legacy) || fs.existsSync(settingsPath)) return;
  try {
    const parsed = JSON.parse(await fsp.readFile(legacy, 'utf-8'));
    if (parsed?.basePath) {
      await writeJsonAtomic(settingsPath, { basePath: parsed.basePath });
    }
  } catch (err) {
    console.warn('[data-dir] No se pudo migrar storage-config.json:', err);
  }
}

/** Escritura atómica: primero a un archivo temporal y luego renombrar, para no dejar JSON a medias. */
export async function writeJsonAtomic(filePath: string, data: unknown) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmp, filePath);
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(await fsp.readFile(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
