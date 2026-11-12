import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { getDataDir } from '@/lib/data/data-dir';
import { getClaudeCodeStatus } from '@/lib/ai/claude-code/bridge';
import { HYPERFRAMES_VERSION } from '@/lib/ai/claude-code/code-video';
import { AGENT_VIDEO_SKILLS } from '@/lib/ai/claude-code/video-skills';

/**
 * Inventario de lo que pueden usar los Claude de la app en ESTE PC (pestaña Herramientas): Claude
 * Code, Node, HyperFrames (con su Chrome y el quitafondos), las skills de video, los paquetes de
 * Python que Claude se ha ido instalando en su carpeta de herramientas y programas extra del sistema.
 */

/** Para qué sirve cada paquete conocido (lo demás se lista con su nombre). */
const PACKAGE_USE: Record<string, string> = {
  mediapipe: 'Detectar y recortar a la persona, manos y cara',
  'opencv-python': 'Visión por computador: caras, máscaras, seguimiento',
  'opencv-python-headless': 'Visión por computador: caras, máscaras, seguimiento',
  'opencv-contrib-python': 'Visión por computador (con módulos extra)',
  numpy: 'Cálculo numérico (base de casi todo)',
  scipy: 'Cálculo científico y señales de audio',
  matplotlib: 'Gráficos de datos',
  pillow: 'Solo pieza interna de MediaPipe y Matplotlib: Claude no la usa para dibujar nada en pantalla',
  fonttools: 'Leer y recortar fuentes tipográficas',
  'ai-edge-litert': 'Modelos de IA ligeros (los usa MediaPipe)',
  jax: 'Cálculo acelerado (dependencia de MediaPipe)',
  jaxlib: 'Cálculo acelerado (dependencia de MediaPipe)',
  tqdm: 'Barras de progreso',
  rembg: 'Quitar fondos de imágenes',
  'openai-whisper': 'Transcripción local',
  torch: 'Motor de IA (PyTorch)',
  librosa: 'Análisis de audio (ritmo, beats)',
  moviepy: 'Edición de video con Python',
  'python-docx': 'Leer documentos Word',
  pypdf: 'Leer PDF',
};

/** Programas del sistema que Claude aprovecha si están instalados. */
const SYSTEM_TOOLS: Array<{ bin: string; para: string }> = [
  { bin: 'yt-dlp', para: 'Descargar videos de referencia (YouTube, TikTok…)' },
  { bin: 'magick', para: 'ImageMagick: procesar imágenes por lotes' },
  { bin: 'rembg', para: 'Quitar fondos de imágenes' },
  { bin: 'sox', para: 'Procesar audio' },
  { bin: 'exiftool', para: 'Leer metadatos de fotos y videos' },
  { bin: 'gifski', para: 'GIF de alta calidad' },
  { bin: 'deno', para: 'Ejecutar scripts' },
];

export interface ClaudeToolbox {
  carpeta: string;
  totalMb: number;
  claudeCode: { instalado: boolean; version: string | null };
  node: string;
  hyperframes: { version: string; chrome: boolean; quitarFondo: boolean };
  skills: string[];
  python: { carpetas: Array<{ nombre: string; mb: number }>; paquetes: Array<{ nombre: string; version: string; para?: string; carpeta: string }> };
  programas: Array<{ nombre: string; ruta: string; para: string }>;
}

export function toolsRoot(): string {
  return path.join(/*turbopackIgnore: true*/ getDataDir(), 'claude-herramientas');
}

/** Carpetas de paquetes de Python que Claude ha creado (py, py2, py3…): todas van en PYTHONPATH. */
export function pythonPackageDirs(root = toolsRoot()): string[] {
  try {
    return fsSync
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^py\d*$/.test(e.name))
      .map((e) => path.join(/*turbopackIgnore: true*/ root, e.name))
      .sort();
  } catch {
    return [path.join(/*turbopackIgnore: true*/ root, 'py')];
  }
}

async function dirMb(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string) => {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(/*turbopackIgnore: true*/ d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) total += await fs.stat(full).then((s) => s.size).catch(() => 0);
    }
  };
  await walk(dir);
  return Math.round(total / 1048576);
}

/** Paquetes instalados en una carpeta --target (por sus carpetas *.dist-info). */
function packagesIn(dir: string): Array<{ nombre: string; version: string }> {
  try {
    return fsSync
      .readdirSync(dir)
      .map((n) => /^(.+?)-([^-]+)\.dist-info$/.exec(n))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ nombre: m[1].toLowerCase().replace(/_/g, '-'), version: m[2] }));
  } catch {
    return [];
  }
}

function findInPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).concat(path.join(toolsRoot(), 'bin'))) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(/*turbopackIgnore: true*/ dir, bin + ext);
      if (fsSync.existsSync(full)) return full;
    }
  }
  return null;
}

const g = globalThis as unknown as { __luloToolbox?: { at: number; data: ClaudeToolbox } };

export async function claudeToolbox(force = false): Promise<ClaudeToolbox> {
  if (!force && g.__luloToolbox && Date.now() - g.__luloToolbox.at < 5 * 60_000) return g.__luloToolbox.data;
  const root = toolsRoot();
  const hfCache = path.join(/*turbopackIgnore: true*/ os.homedir(), '.cache', 'hyperframes');
  const dirs = pythonPackageDirs(root).filter((d) => fsSync.existsSync(d));
  const seen = new Map<string, { nombre: string; version: string; para?: string; carpeta: string }>();
  for (const d of dirs) {
    for (const p of packagesIn(d)) {
      if (!seen.has(p.nombre)) seen.set(p.nombre, { ...p, para: PACKAGE_USE[p.nombre], carpeta: path.basename(d) });
    }
  }
  // Los conocidos primero (lo que más le sirve a Claude), luego el resto por nombre
  const paquetes = [...seen.values()].sort((a, b) => Number(!a.para) - Number(!b.para) || a.nombre.localeCompare(b.nombre));
  const status = await getClaudeCodeStatus().catch(() => null);
  const data: ClaudeToolbox = {
    carpeta: root,
    totalMb: fsSync.existsSync(root) ? await dirMb(root) : 0,
    claudeCode: { instalado: !!status?.installed, version: status?.version ?? null },
    node: process.versions.node,
    hyperframes: {
      version: HYPERFRAMES_VERSION,
      chrome: fsSync.existsSync(path.join(/*turbopackIgnore: true*/ hfCache, 'chrome')),
      quitarFondo: fsSync.existsSync(path.join(/*turbopackIgnore: true*/ hfCache, 'background-removal', 'models')),
    },
    skills: [...AGENT_VIDEO_SKILLS],
    python: { carpetas: await Promise.all(dirs.map(async (d) => ({ nombre: path.basename(d), mb: await dirMb(d) }))), paquetes },
    programas: SYSTEM_TOOLS.map((t) => ({ nombre: t.bin, ruta: findInPath(t.bin) ?? '', para: t.para })).filter((t) => t.ruta),
  };
  g.__luloToolbox = { at: Date.now(), data };
  return data;
}

/** Una línea para el prompt de Claude: lo que ya tiene instalado (para reutilizarlo, no reinstalar). */
export async function toolboxPromptLine(): Promise<string> {
  const t = await claudeToolbox().catch(() => null);
  if (!t) return '';
  const pk = t.python.paquetes.filter((p) => p.para && p.nombre !== 'pillow').map((p) => p.nombre);
  const parts = [
    pk.length ? `paquetes de Python ya instalados (reutilízalos, no los reinstales): ${pk.join(', ')}` : '',
    t.programas.length ? `programas: ${t.programas.map((p) => p.nombre).join(', ')}` : '',
    t.hyperframes.quitarFondo ? 'HyperFrames ya tiene descargado su modelo para quitar fondos' : '',
  ].filter(Boolean);
  return parts.length ? `- Ya tienes en este PC: ${parts.join('; ')}.` : '';
}
