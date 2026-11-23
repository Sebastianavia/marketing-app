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
  // Rutas reales también aquí: /tmp → /private/tmp en macOS, unidades montadas…
  const real2 = async (p: string) => fs.realpath(p).catch(() => path.resolve(/*turbopackIgnore: true*/ p));
  for (const blocked of await Promise.all([repoRoot(), getDataDir()].map(real2))) {
    if (isInside(blocked, resolved) || isInside(resolved, blocked)) throw new MaterialError('Esa carpeta tiene archivos internos de Lulo Studio: elige otra.');
  }
  const parts = path.relative(path.parse(resolved).root, resolved).split(path.sep);
  // ~/Library (macOS) es configuración; una carpeta «Library» en otro sitio es material normal
  const macLibrary = process.platform === 'darwin' && isInside(path.join(/*turbopackIgnore: true*/ home, 'Library'), resolved);
  if (macLibrary || parts.some((s) => hidden(s) || s.toLowerCase() === 'appdata')) {
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
  carpeta: string | null;
  elegida: string;
  extras?: TaggedMaterialFolder[];
}

export interface TaggedMaterialFolder {
  carpeta: string;
  etiqueta: string;
}

export const MAX_TAGGED_FOLDERS = 12;

export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function readStored(clave: string): Promise<Stored | null> {
  try {
    const s = JSON.parse(await fs.readFile(storeFile(clave), 'utf8')) as Partial<Stored>;
    return {
      carpeta: typeof s.carpeta === 'string' && s.carpeta ? s.carpeta : null,
      elegida: typeof s.elegida === 'string' ? s.elegida : new Date().toISOString(),
      extras: Array.isArray(s.extras)
        ? s.extras
            .filter((e): e is TaggedMaterialFolder => !!e && typeof e.carpeta === 'string' && !!e.carpeta && typeof e.etiqueta === 'string')
            .map((e) => ({ carpeta: e.carpeta, etiqueta: normalizeTag(e.etiqueta) || path.basename(e.carpeta) }))
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Carpeta guardada para el proyecto (sin validar: puede haberse borrado o movido). */
export async function getMaterialFolder(clave: string): Promise<string | null> {
  return (await readStored(clave))?.carpeta ?? null;
}

/** Carpetas extra etiquetadas guardadas para el proyecto (sin validar). */
export async function getTaggedMaterialFolders(clave: string): Promise<TaggedMaterialFolder[]> {
  return (await readStored(clave))?.extras ?? [];
}

/** Valida una lista de carpetas etiquetadas (rutas reales y etiquetas no vacías). */
export async function validateTaggedMaterialFolders(input: TaggedMaterialFolder[]): Promise<TaggedMaterialFolder[]> {
  if (input.length > MAX_TAGGED_FOLDERS) {
    throw new MaterialError(`Se admiten como máximo ${MAX_TAGGED_FOLDERS} carpetas adicionales.`);
  }
  const out: TaggedMaterialFolder[] = [];
  for (const item of input) {
    const etiqueta = normalizeTag(item.etiqueta);
    if (!etiqueta) throw new MaterialError('Ponle una etiqueta a la carpeta adicional (p. ej. "Resultados de estudiantes").');
    const carpeta = await validateMaterialFolder(item.carpeta);
    out.push({ carpeta, etiqueta });
  }
  return out;
}

async function writeStored(clave: string, carpeta: string | null, extras: TaggedMaterialFolder[]): Promise<void> {
  const file = storeFile(clave);
  if (!carpeta && extras.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, {
    carpeta,
    elegida: new Date().toISOString(),
    ...(extras.length ? { extras } : {}),
  } satisfies Stored);
}

/** Guarda (o quita, con null) la carpeta de material principal del proyecto. Conserva las carpetas extra. */
export async function setMaterialFolder(clave: string, carpeta: string | null): Promise<string | null> {
  const prev = await readStored(clave);
  const real = carpeta ? await validateMaterialFolder(carpeta) : null;
  await writeStored(clave, real, prev?.extras ?? []);
  return real;
}

/** Guarda las carpetas adicionales con etiqueta del proyecto (conservando la carpeta principal). */
export async function setTaggedMaterialFolders(clave: string, extras: TaggedMaterialFolder[]): Promise<TaggedMaterialFolder[]> {
  const prev = await readStored(clave);
  const validated = await validateTaggedMaterialFolders(extras);
  await writeStored(clave, prev?.carpeta ?? null, validated);
  return validated;
}

/** La carpeta del proyecto si sigue existiendo y siendo válida; si no, null. */
export async function usableMaterialFolder(clave: string): Promise<string | null> {
  const c = await getMaterialFolder(clave);
  if (!c) return null;
  return validateMaterialFolder(c).catch(() => null);
}

/** Las carpetas extra con etiqueta que siguen existiendo y siendo válidas. */
export async function usableTaggedMaterialFolders(clave: string): Promise<TaggedMaterialFolder[]> {
  const raw = await getTaggedMaterialFolders(clave);
  const out: TaggedMaterialFolder[] = [];
  for (const e of raw) {
    const ok = await validateMaterialFolder(e.carpeta).catch(() => null);
    if (ok && e.etiqueta) out.push({ carpeta: ok, etiqueta: e.etiqueta });
  }
  return out;
}

/** Bloque del prompt de sistema de Claude con la carpeta principal y/o las carpetas etiquetadas por tema. */
export async function materialPrompt(
  dir: string | null,
  o: { puedeCopiar: boolean; comoUsar: string; extras?: TaggedMaterialFolder[] }
): Promise<string> {
  const sections: string[] = [];
  const copyRule = o.puedeCopiar
    ? 'Lo más cómodo es copiar a tu carpeta lo que vayas a usar (p. ej. `mkdir -p claude/material && cp "<archivo>" claude/material/`) y trabajar con la copia.'
    : 'No puedes copiar archivos (Bash está desactivado): léelos con Read y explica a la persona qué necesitas que adjunte.';

  if (dir) {
    const { archivos, truncado } = await listMaterial(dir, 250);
    const lista = archivos.map((a) => `- ${a.ruta} (${a.tipo}, ${a.mb} MB)`).join('\n') || '(vacía por ahora)';
    sections.push(`## Carpeta de material del proyecto
La persona eligió esta carpeta con el material general para este video: \`${dir}\`
Úsala como fuente principal: mira lo que hay ANTES de decidir (fotos y PDF con Read; videos y audios con FFmpeg/ffprobe para saber duración y contenido; textos con Read) y básate en ese material en vez de inventar.
Puedes leer todo y crear archivos nuevos ahí si te sirve, pero NO cambies, muevas ni borres los originales de la persona. ${copyRule} ${o.comoUsar}
Archivos (${archivos.length}${truncado ? '+, lista recortada: usa Glob para ver el resto' : ''}; la lista es de cuando empezó este mensaje):
${lista}`);
  }

  const extras = o.extras ?? [];
  if (extras.length > 0) {
    const blocks: string[] = [];
    for (const ex of extras) {
      const { archivos, truncado } = await listMaterial(ex.carpeta, 150);
      const lista = archivos.map((a) => `  - ${a.ruta} (${a.tipo}, ${a.mb} MB)`).join('\n') || '  (vacía por ahora)';
      blocks.push(`### Etiqueta / Tema: «${ex.etiqueta}»
Carpeta: \`${ex.carpeta}\`
REGLA ESTRICTA DE USO CONDICIONAL: NO tomes ni uses ningún archivo de esta carpeta a menos que en las instrucciones/pedido de la persona, en lo que se dice en el guion/transcripción del video, o en un documento/guion dentro de la carpeta de material principal se mencione, pida o corresponda hablar de «${ex.etiqueta}» (o su tema equivalente). Si en una parte del video SÍ va o se menciona ese tema, usa los archivos de esta carpeta en esa parte exactamente (copiándolos primero a \`claude/material/\` sin modificar los originales). Si en ningún momento del video ni de las instrucciones aplica «${ex.etiqueta}», ignora esta carpeta por completo.
Archivos (${archivos.length}${truncado ? '+, lista recortada: usa Glob para ver el resto' : ''}):
${lista}`);
    }
    sections.push(`## Carpetas adicionales por etiqueta (USO SOLO SI APLICA EL TEMA)
La persona adjuntó ${extras.length === 1 ? 'esta carpeta temática opcional' : 'estas carpetas temáticas opcionales'}. A diferencia de la carpeta de material general, cada carpeta con etiqueta es CONDICIONAL:
- PROHIBIDO usarla por relleno o si el video no toca ese tema.
- ÚSALA ÚNICAMENTE en la parte donde el pedido/instrucciones, el guion hablado en el video o un documento/guion de la carpeta de material indique o mencione el tema de su etiqueta (por ejemplo: si la etiqueta es «Resultados de estudiantes», «Resultados de clientes», «Testimonios», etc., úsala solo cuando en esa parte del guion o las instrucciones vaya o se hable de eso).
- ${copyRule}

${blocks.join('\n\n')}`);
  }

  return sections.length ? '\n' + sections.join('\n\n') : '';
}
