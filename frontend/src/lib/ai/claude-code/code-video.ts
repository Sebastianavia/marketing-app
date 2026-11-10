import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import spawn from 'cross-spawn';
import { z } from 'zod';
import { isInside } from '@/lib/fs/inside';
import { probeVideo } from '@/lib/editor/media';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { childEnv } from './bridge';

/**
 * Render de videos hechos con código (HyperFrames: HTML + GSAP → MP4) para los Claude de la app.
 *
 * Claude escribe la composición en la carpeta de su proyecto con las skills de video (plugin
 * lulo-video, ver video-skills.ts) y la renderiza con esta herramienta. El render corre en el
 * servidor y no en el Bash de Claude porque el aislamiento de macOS no deja arrancar Chrome.
 * Seguridad: solo carpetas dentro del proyecto de Claude; sin enlaces simbólicos ni duros (el
 * servidor de HyperFrames solo sirve esa carpeta: file:// y ../ ya están bloqueados, probado
 * 2026-11-10); versión fija del CLI; sin telemetría; un render a la vez.
 */

export const HYPERFRAMES_VERSION = process.env.LULO_HYPERFRAMES_VERSION?.trim() || '0.9.28';

export const CodeVideoSchema = z.object({
  proyecto: z.string().min(1).max(260).describe('Carpeta del proyecto HyperFrames (con index.html), relativa a tu carpeta, p. ej. "claude/intro".'),
  salida: z.string().min(1).max(260).describe('Archivo de salida relativo a tu carpeta, p. ej. "claude/intro.mp4".'),
  composicion: z.string().max(260).optional().describe('Sub-composición a renderizar (p. ej. "compositions/intro.html"); vacío = index.html.'),
  calidad: z.enum(['draft', 'looks', 'delivery']).default('looks').describe('draft para probar rápido, looks normal, delivery para la entrega final.'),
  formato: z.enum(['mp4', 'webm', 'mov']).default('mp4').describe('webm/mov conservan la transparencia (para superponer sobre otro video con FFmpeg).'),
  fps: z.number().int().min(1).max(60).optional(),
});
export type CodeVideoInput = z.infer<typeof CodeVideoSchema>;

export const CODE_VIDEO_DESCRIPTION =
  'Renderiza un proyecto HyperFrames (HTML + GSAP, hecho con las skills hyperframes/hyperframes-registry) a video, en este PC y gratis ($0). Úsala en vez de `npx hyperframes render` (en Bash no arranca Chrome). El proyecto y la salida van dentro de tu carpeta. Tarda de segundos a pocos minutos. Devuelve el archivo, duración y tamaño; míralo con fotogramas (FFmpeg + Read) antes de entregarlo.';

export const CodeCheckSchema = z.object({
  proyecto: z.string().min(1).max(260).describe('Carpeta del proyecto HyperFrames, relativa a tu carpeta.'),
  composicion: z.string().max(260).optional().describe('Sub-composición a revisar; vacío = index.html.'),
  en: z.array(z.number().min(0).max(3600)).max(20).optional().describe('Segundos concretos a revisar (además de las muestras).'),
});
export type CodeCheckInput = z.infer<typeof CodeCheckSchema>;

export const CODE_CHECK_DESCRIPTION =
  'Revisa un proyecto HyperFrames como `npx hyperframes check` (lint, maquetación, textos cortados o encimados, contraste, tramos muertos) con Chrome en este PC. $0. Úsala en vez del check de Bash (ahí no arranca Chrome) antes de renderizar.';

export class CodeVideoError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function inside(base: string, rel: string, what: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ base, rel);
  if (!isInside(base, abs) || abs === path.resolve(/*turbopackIgnore: true*/ base)) {
    throw new CodeVideoError(`${what} tiene que estar dentro de tu carpeta.`);
  }
  return abs;
}

/** Recorre el proyecto: sin enlaces (podrían apuntar fuera) y con un límite razonable de archivos. */
async function assertSafeProject(dir: string) {
  let count = 0;
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(/*turbopackIgnore: true*/ d, e.name);
      if (e.isSymbolicLink()) throw new CodeVideoError(`El proyecto no puede tener enlaces (${path.relative(dir, full)}): copia el archivo dentro.`);
      if (e.isDirectory()) {
        if (e.name === 'renders') continue;
        await walk(full);
      } else if (e.isFile()) {
        if (++count > 5000) throw new CodeVideoError('El proyecto tiene demasiados archivos (máx. 5000).');
        const st = await fs.stat(full);
        if (st.nlink > 1) throw new CodeVideoError(`El proyecto no puede tener enlaces duros (${path.relative(dir, full)}): copia el archivo dentro.`);
      }
    }
  };
  await walk(dir);
}

function run(args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; stdout: string }> {
  const ffmpeg = resolveFfmpegPath();
  const extra: Record<string, string> = { HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', CI: '1' };
  if (path.isAbsolute(ffmpeg)) {
    extra.HYPERFRAMES_FFMPEG_PATH = ffmpeg;
    const probe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    extra.HYPERFRAMES_FFPROBE_PATH = probe;
  }
  return new Promise((resolve) => {
    // childEnv: lista blanca, ninguna clave de .env.local llega al render
    // cwd neutro: dentro del proyecto npx usaría un node_modules/.npmrc que Claude hubiera puesto ahí
    // y ese código correría fuera del aislamiento
    const child = spawn('npx', ['-y', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
      cwd: os.tmpdir(),
      env: childEnv(extra),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let stdout = '';
    const keep = (d: Buffer) => {
      out = (out + d.toString()).slice(-8000);
    };
    child.stdout?.on('data', (d: Buffer) => {
      keep(d);
      if (stdout.length < 2_000_000) stdout += d.toString();
    });
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, out: out + String(err), stdout });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, stdout });
    });
  });
}

/** Carpeta del proyecto validada (dentro de la base, existe, sin enlaces). */
async function projectDir(base: string, proyecto: string, composicion?: string) {
  const dir = inside(base, proyecto, 'El proyecto');
  const st = await fs.lstat(dir).catch(() => null);
  if (!st?.isDirectory()) throw new CodeVideoError(`No existe la carpeta ${proyecto}.`, 404);
  const entry = composicion ? inside(dir, composicion, 'La composición') : path.join(/*turbopackIgnore: true*/ dir, 'index.html');
  await fs.access(entry).catch(() => {
    throw new CodeVideoError(`No existe ${path.relative(base, entry)}.`, 404);
  });
  await assertSafeProject(dir);
  return { dir, entry };
}

// Un render o revisión a la vez (cada uno abre varios Chrome)
const g = globalThis as unknown as { __luloCodeVideoQueue?: Promise<unknown> };

export async function renderCodeVideo(base: string, input: CodeVideoInput) {
  const out = inside(base, input.salida, 'La salida');
  if (path.extname(out).toLowerCase() !== `.${input.formato}`) throw new CodeVideoError(`La salida tiene que terminar en .${input.formato}.`);
  const { dir, entry } = await projectDir(base, input.proyecto, input.composicion);
  if (isInside(dir, out) && path.relative(dir, out).split(path.sep)[0] !== 'renders') {
    // Dentro del proyecto el servidor la serviría en el siguiente render: mejor fuera o en renders/
    throw new CodeVideoError('Guarda la salida fuera de la carpeta del proyecto (o en su subcarpeta renders/).');
  }
  await fs.mkdir(path.dirname(out), { recursive: true });

  const args = ['render', dir, '--output', out, '--quality', input.calidad, '--format', input.formato, '--quiet'];
  if (input.composicion) args.push('--composition', path.relative(dir, entry));
  if (input.fps) args.push('--fps', String(input.fps));

  const job = (g.__luloCodeVideoQueue ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const started = Date.now();
    const r = await run(args, 20 * 60_000);
    const ok = await fs.stat(out).then((s) => s.size > 0).catch(() => false);
    if (r.code !== 0 || !ok) {
      const tail = r.out.split('\n').filter((l) => /error|fail|cannot|not found|invalid/i.test(l)).slice(-12).join('\n') || r.out.slice(-1500);
      throw new CodeVideoError(`HyperFrames no pudo renderizar:\n${tail}`, 500);
    }
    const info = input.formato === 'mp4' ? await probeVideo(out).catch(() => null) : null;
    const size = (await fs.stat(out)).size;
    return {
      ok: true,
      archivo: path.relative(base, out),
      duracionSeg: info?.duracion ? Number(info.duracion.toFixed(2)) : undefined,
      tamanoMB: Number((size / 1048576).toFixed(2)),
      segundosDeRender: Math.round((Date.now() - started) / 1000),
      motor: `hyperframes@${HYPERFRAMES_VERSION}`,
    };
  });
  g.__luloCodeVideoQueue = job;
  return job;
}

export async function checkCodeVideo(base: string, input: CodeCheckInput) {
  const { dir, entry } = await projectDir(base, input.proyecto, input.composicion);
  const args = ['check', dir, '--json', '--budget', '3m', '--no-cache'];
  if (path.relative(dir, entry) !== 'index.html') args.push('--composition', path.relative(dir, entry));
  if (input.en?.length) args.push('--at', input.en.join(','));
  const job = (g.__luloCodeVideoQueue ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const r = await run(args, 5 * 60_000);
    const start = r.stdout.indexOf('{');
    const json = start >= 0 ? r.stdout.slice(start).trim() : '';
    try {
      return { ok: true, resultado: JSON.parse(json) as unknown };
    } catch {
      // Salida cortada o no JSON: se devuelve el texto tal cual (recortado)
      if (r.code !== 0 && !json) throw new CodeVideoError(`HyperFrames no pudo revisar:\n${r.out.slice(-1500)}`, 500);
      return { ok: r.code === 0, salida: r.out.slice(-6000) };
    }
  });
  g.__luloCodeVideoQueue = job;
  return job;
}
