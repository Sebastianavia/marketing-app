import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { isInside } from '@/lib/fs/inside';

/**
 * Carpeta de material: una carpeta del PC que la persona elige para un proyecto (edición,
 * producción del Director, Estudio Claude) para que Claude vea dónde están los archivos del
 * video. Claude la puede LEER (Read, Glob, Grep y, en macOS/Linux, Bash aislado) pero no escribir;
 * copia a su carpeta lo que vaya a usar.
 *
 * Se guarda aparte del proyecto, en `<datos>/material/<clave>.json`, con la misma clave que los
 * turnos de Claude (`edit:<id>`, `director:<id>`, `studio:<id>`): el motor de agentes la encuentra
 * sin que cada herramienta cambie su formato.
 */

export class MaterialError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const MATERIAL_KEY = /^(edit|director|studio):[A-Za-z0-9_-]{1,80}$/;

export type MaterialKind = 'imagen' | 'video' | 'audio' | 'pdf' | 'texto' | 'diseno' | 'otro';

const KINDS: Record<string, MaterialKind> = {
  jpg: 'imagen', jpeg: 'imagen', png: 'imagen', webp: 'imagen', gif: 'imagen', heic: 'imagen', avif: 'imagen', svg: 'imagen', bmp: 'imagen', tif: 'imagen', tiff: 'imagen',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
  pdf: 'pdf',
  txt: 'texto', md: 'texto', doc: 'texto', docx: 'texto', rtf: 'texto', csv: 'texto', json: 'texto', srt: 'texto', vtt: 'texto', xlsx: 'texto', pptx: 'texto',
  psd: 'diseno', ai: 'diseno', fig: 'diseno', ttf: 'diseno', otf: 'diseno', woff: 'diseno', woff2: 'diseno', lut: 'diseno', cube: 'diseno',
};

export function kindOf(file: string): MaterialKind {
  return KINDS[path.extname(file).slice(1).toLowerCase()] ?? 'otro';
}

function repoRoot(): string {
  // process.cwd() = frontend/
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..');
}

const hidden = (name: string) => name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN' || name === 'System Volume Information';

/**
 * Comprueba que la carpeta se puede ofrecer a Claude y devuelve su ruta real. No vale: la raíz de
 * un disco, la carpeta personal entera, el código de la app, la carpeta de datos (claves, tokens) ni
 * carpetas ocultas o de configuración (.ssh, .claude, AppData…).
 */
export async function validateMaterialFolder(input: string): Promise<string> {
  const raw = input.trim().replace(/^["']|["']$/g, '');
  if (!raw) throw new MaterialError('Escribe o elige una carpeta.');
  if (!path.isAbsolute(raw)) throw new MaterialError('La carpeta tiene que ser una ruta completa (p. ej. D:\\Material\\Campaña).');
  const real = await fs.realpath(raw).catch(() => null);
  if (!real) throw new MaterialError('Esa carpeta no existe.', 404);
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new MaterialError('Eso es un archivo, no una carpeta.');

  const resolved = path.resolve(/*turbopackIgnore: true*/ real);
  if (path.parse(resolved).root === resolved || path.dirname(resolved) === resolved) throw new MaterialError('Elige una carpeta concreta, no la raíz del disco.');
  const home = path.resolve(/*turbopackIgnore: true*/ os.homedir());
  if (isInside(resolved, home)) throw new MaterialError('Elige una carpeta concreta (no la carpeta personal completa).');
  for (const blocked of [repoRoot(), getDataDir()]) {
    if (isInside(blocked, resolved) || isInside(resolved, blocked)) throw new MaterialError('Esa carpeta tiene archivos internos de Lulo Studio: elige otra.');
  }
  const parts = path.relative(path.parse(resolved).root, resolved).split(path.sep);
  if (parts.some((s) => hidden(s) || s.toLowerCase() === 'appdata' || s === 'Library')) {
    throw new MaterialError('No se pueden usar carpetas ocultas o de configuración del sistema.');
  }
  return resolved;
}

export interface MaterialFile {
  ruta: string; // relativa a la carpeta
  tipo: MaterialKind;
  mb: number;
}

/** Archivos de la carpeta (hasta 4 niveles y `max` archivos; sin ocultos). */
export async function listMaterial(dir: string, max = 400): Promise<{ archivos: MaterialFile[]; truncado: boolean }> {
  const archivos: MaterialFile[] = [];
  let truncado = false;
  const walk = async (d: string, depth: number) => {
    if (truncado) return;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    for (const e of entries) {
      if (hidden(e.name)) continue;
      const full = path.join(/*turbopackIgnore: true*/ d, e.name);
      if (e.isDirectory()) {
        if (depth < 4) await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (archivos.length >= max) {
          truncado = true;
          return;
        }
        const size = await fs.stat(full).then((s) => s.size).catch(() => 0);
        archivos.push({ ruta: path.relative(dir, full), tipo: kindOf(e.name), mb: Number((size / 1048576).toFixed(2)) });
      }
    }
  };
  await walk(dir, 0);
  return { archivos, truncado };
}

export function summarize(archivos: MaterialFile[]): Partial<Record<MaterialKind, number>> {
  const out: Partial<Record<MaterialKind, number>> = {};
  for (const a of archivos) out[a.tipo] = (out[a.tipo] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Almacén por clave
// ---------------------------------------------------------------------------

function storeFile(clave: string): string {
  if (!MATERIAL_KEY.test(clave)) throw new MaterialError('Proyecto no válido.');
  return path.join(/*turbopackIgnore: true*/ getDataDir(), 'material', `${clave.replace(':', '_')}.json`);
}

interface Stored {
  carpeta: string;
  elegida: string;
}

/** Carpeta guardada para el proyecto (sin validar: puede haberse borrado o movido). */
export async function getMaterialFolder(clave: string): Promise<string | null> {
  try {
    const s = JSON.parse(await fs.readFile(storeFile(clave), 'utf8')) as Stored;
    return typeof s.carpeta === 'string' && s.carpeta ? s.carpeta : null;
  } catch {
    return null;
  }
}

/** Guarda (o quita, con null) la carpeta de material del proyecto. Devuelve la ruta real guardada. */
export async function setMaterialFolder(clave: string, carpeta: string | null): Promise<string | null> {
  const file = storeFile(clave);
  if (!carpeta) {
    await fs.rm(file, { force: true });
    return null;
  }
  const real = await validateMaterialFolder(carpeta);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, { carpeta: real, elegida: new Date().toISOString() } satisfies Stored);
  return real;
}

/** La carpeta del proyecto si sigue existiendo y siendo válida; si no, null. */
export async function usableMaterialFolder(clave: string): Promise<string | null> {
  const c = await getMaterialFolder(clave);
  if (!c) return null;
  return validateMaterialFolder(c).catch(() => null);
}

/** Bloque del prompt de sistema de Claude con la carpeta y sus archivos. */
export async function materialPrompt(dir: string, o: { puedeCopiar: boolean; comoUsar: string }): Promise<string> {
  const { archivos, truncado } = await listMaterial(dir, 250);
  const lista = archivos.map((a) => `- ${a.ruta} (${a.tipo}, ${a.mb} MB)`).join('\n') || '(vacía por ahora)';
  return `
## Carpeta de material del proyecto
La persona eligió esta carpeta con el material para este video: \`${dir}\`
Úsala como fuente principal: mira lo que hay ANTES de decidir (fotos y PDF con Read; videos y audios con FFmpeg/ffprobe para saber duración y contenido; textos con Read) y básate en ese material en vez de inventar.
Es de SOLO LECTURA: no cambies, muevas ni borres nada ahí. ${o.puedeCopiar ? 'Para usar un archivo, cópialo primero a tu carpeta (p. ej. `mkdir -p claude/material && cp "<archivo>" claude/material/`) y trabaja con la copia.' : 'No puedes copiar archivos (Bash está desactivado): léelos con Read y explica a la persona qué necesitas que adjunte.'} ${o.comoUsar}
Archivos (${archivos.length}${truncado ? '+, lista recortada: usa Glob para ver el resto' : ''}; la lista es de cuando empezó este mensaje):
${lista}`;
}
