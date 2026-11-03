import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { ensureDataDir } from '@/lib/data/data-dir';

/**
 * FFmpeg para la edición: leer el video, sacar el audio para transcribir y renderizar.
 * Usa el mismo ejecutable que el resto de la app (FFMPEG_PATH → ffmpeg-static → PATH).
 */

export interface FfmpegRun {
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  /** Duración esperada de la salida (s) para calcular el progreso. */
  totalSeconds?: number;
  onProgress?: (pct: number) => void;
}

export function ffmpeg({ args, cwd, timeoutMs = 30 * 60 * 1000, totalSeconds, onProgress }: FfmpegRun): Promise<string> {
  const bin = resolveFfmpegPath();
  const withProgress = onProgress && totalSeconds ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, withProgress, { windowsHide: true, cwd });
    let stderr = '';
    let lastPct = -1;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('FFmpeg tardó demasiado y se detuvo.'));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (!onProgress || !totalSeconds) return;
      const m = /out_time_(?:ms|us)=(\d+)/g;
      let match: RegExpExecArray | null;
      let last: number | null = null;
      while ((match = m.exec(d.toString()))) last = Number(match[1]) / 1_000_000;
      if (last === null) return;
      const pct = Math.max(0, Math.min(99, Math.round((last / totalSeconds) * 100)));
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress(pct);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-12000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'No se encontró FFmpeg. Instálalo (o en la carpeta frontend ejecuta: npm i ffmpeg-static) y reinicia la app.'
            : `No se pudo ejecutar FFmpeg: ${err.message}`
        )
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg falló (código ${code}): ${stderr.split('\n').filter(Boolean).slice(-5).join(' ').trim()}`));
    });
  });
}

export interface VideoInfo {
  duracion: number;
  ancho: number;
  alto: number;
  tieneAudio: boolean;
  tieneVideo: boolean;
}

/** Lee duración, tamaño (ya girado si el celular lo grabó rotado) y si tiene audio. */
export async function probeVideo(file: string): Promise<VideoInfo> {
  const bin = resolveFfmpegPath();
  const stderr: string = await new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(err));
  });
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duracion = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const videoLine = stderr.split('\n').find((l) => /Stream #\S+.*Video:/.test(l)) ?? '';
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(videoLine);
  let ancho = size ? Number(size[1]) : 0;
  let alto = size ? Number(size[2]) : 0;
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr) ?? /rotate\s*:\s*(-?\d+)/.exec(stderr);
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [ancho, alto] = [alto, ancho];
  return {
    duracion,
    ancho,
    alto,
    tieneAudio: /Stream #\S+.*Audio:/.test(stderr),
    tieneVideo: Boolean(videoLine),
  };
}

/** Audio pequeño para transcribir: mono, 16 kHz, 64 kbps. */
export async function extractAudio(video: string, out: string): Promise<void> {
  await ffmpeg({ args: ['-y', '-hide_banner', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out], timeoutMs: 10 * 60 * 1000 });
}

let subtitlesSupport: boolean | null = null;

/** ¿Este FFmpeg puede quemar subtítulos (filtro "subtitles" de libass)? */
export async function hasSubtitlesFilter(): Promise<boolean> {
  if (subtitlesSupport !== null) return subtitlesSupport;
  const bin = resolveFfmpegPath();
  const out: string = await new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-filters'], { windowsHide: true });
    let o = '';
    child.stdout.on('data', (d) => (o += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(o));
  });
  subtitlesSupport = /^\s*\S*\s+subtitles\s/m.test(out);
  return subtitlesSupport;
}

/** Carpeta de fuentes propias (.ttf/.otf) para los subtítulos: <datos>/fuentes. */
export async function fontsDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'fuentes');
  await fs.mkdir(d, { recursive: true });
  return d;
}

/** Copia las fuentes propias junto al trabajo (FFmpeg las lee por ruta relativa: sin líos de comillas en Windows). */
export async function stageFonts(workDir: string): Promise<string | null> {
  const src = await fontsDir();
  const files = (await fs.readdir(src)).filter((f) => /\.(ttf|otf|ttc)$/i.test(f));
  if (!files.length) return null;
  const dest = path.join(/*turbopackIgnore: true*/ workDir, 'fuentes');
  await fs.mkdir(dest, { recursive: true });
  for (const f of files) {
    const to = path.join(/*turbopackIgnore: true*/ dest, f);
    if (!fsSync.existsSync(to)) await fs.copyFile(path.join(/*turbopackIgnore: true*/ src, f), to);
  }
  return 'fuentes';
}

let scriptFlag: string | null = null;

/**
 * Opción para leer el grafo de filtros desde un archivo.
 * FFmpeg 7+ usa "-/filter_complex <archivo>" (y versiones nuevas ya quitaron -filter_complex_script);
 * FFmpeg 4–6 solo entiende -filter_complex_script.
 */
export async function filterScriptArgs(file: string): Promise<string[]> {
  if (!scriptFlag) {
    const bin = resolveFfmpegPath();
    const first: string = await new Promise((resolve) => {
      const child = spawn(bin, ['-version'], { windowsHide: true });
      let o = '';
      child.stdout.on('data', (d) => (o += d.toString()));
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(o.split('\n')[0] ?? ''));
    });
    const m = /ffmpeg version n?(\d+)\./i.exec(first);
    // Versión numerada menor que 7 → opción antigua; compilaciones git/nightly sin número → la nueva
    scriptFlag = m && Number(m[1]) < 7 ? '-filter_complex_script' : '-/filter_complex';
  }
  return [scriptFlag, file];
}
