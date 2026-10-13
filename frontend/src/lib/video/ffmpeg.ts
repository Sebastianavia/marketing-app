import { spawn } from 'child_process';
import { createRequire } from 'module';
import fsSync from 'fs';
import path from 'path';

/**
 * FFmpeg para cortar la voz por escenas y montar el video final.
 * Busca el ejecutable en este orden:
 *   1. FFMPEG_PATH en .env.local
 *   2. el paquete npm `ffmpeg-static` (npm i ffmpeg-static), que el futuro .exe puede incluir
 *   3. `ffmpeg` instalado en el sistema (PATH)
 */

let cached: string | null = null;

export function resolveFfmpegPath(): string {
  if (cached) return cached;
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && fsSync.existsSync(fromEnv)) return (cached = fromEnv);
  try {
    const req = createRequire(path.join(process.cwd(), 'package.json'));
    const pkg = 'ffmpeg-static';
    const p = req(pkg) as string | null;
    if (p && fsSync.existsSync(p)) return (cached = p);
  } catch {
    // ffmpeg-static no instalado
  }
  return (cached = 'ffmpeg');
}

export function runFfmpeg(args: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  const bin = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('FFmpeg tardó demasiado y se detuvo.'));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'No se encontró FFmpeg. En la carpeta frontend ejecuta: npm i ffmpeg-static (o define FFMPEG_PATH en .env.local).'
            : `No se pudo ejecutar FFmpeg: ${err.message}`
        )
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg falló (código ${code}): ${stderr.split('\n').slice(-6).join(' ').trim()}`));
    });
  });
}

/** Devuelve la versión de FFmpeg o null si no está disponible. */
export async function ffmpegVersion(): Promise<string | null> {
  try {
    const bin = resolveFfmpegPath();
    return await new Promise((resolve) => {
      const child = spawn(bin, ['-version'], { windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 ? out.split('\n')[0].trim() : null));
    });
  } catch {
    return null;
  }
}

/** Corta un tramo de audio [start, end] en segundos a un MP3 nuevo. */
export async function sliceAudio(input: string, start: number, end: number, output: string) {
  await runFfmpeg([
    '-y', '-i', input,
    '-ss', start.toFixed(3), '-to', end.toFixed(3),
    '-c:a', 'libmp3lame', '-b:a', '192k',
    output,
  ]);
}

export interface StitchClip {
  path: string;
}

export interface StitchOptions {
  clips: StitchClip[];
  /** Segundo del video final en el que empieza cada escena (la primera en 0). */
  starts: number[];
  /** Duración total = duración de la voz. */
  total: number;
  audioPath: string;
  output: string;
  width: number;
  height: number;
  fps?: number;
  /** Fundido entre clips, en segundos. */
  crossfade?: number;
}

/**
 * Argumentos de FFmpeg para el montaje: cada clip se ajusta al cuadro, se congela
 * el último fotograma si es más corto que su escena (tpad), se recorta a su duración,
 * y se une con xfade. Encima va la voz completa, sin cortes.
 */
export function buildStitchArgs(o: StitchOptions): string[] {
  const n = o.clips.length;
  if (n === 0) throw new Error('No hay clips para montar.');
  if (o.starts.length !== n) throw new Error('Cada clip necesita su inicio.');
  const fps = o.fps ?? 30;
  const d = n > 1 ? Math.max(0, o.crossfade ?? 0.5) : 0;

  const lens = o.clips.map((_, i) =>
    i < n - 1 ? o.starts[i + 1] - o.starts[i] + d : o.total - o.starts[i]
  );
  if (lens.some((l) => !(l > d))) throw new Error('Hay una escena demasiado corta para el fundido.');

  const args: string[] = ['-y'];
  o.clips.forEach((c) => args.push('-i', c.path));
  args.push('-i', o.audioPath);

  const f: string[] = [];
  o.clips.forEach((_, i) => {
    f.push(
      `[${i}:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height},` +
        `fps=${fps},format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=${lens[i].toFixed(3)},` +
        `trim=duration=${lens[i].toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`
    );
  });
  let last = 'v0';
  for (let k = 1; k < n; k++) {
    const out = k === n - 1 ? 'vout' : `x${k}`;
    f.push(`[${last}][v${k}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${o.starts[k].toFixed(3)}[${out}]`);
    last = out;
  }
  if (n === 1) f.push(`[v0]null[vout]`);

  args.push(
    '-filter_complex', f.join(';'),
    '-map', '[vout]', '-map', `${n}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', o.total.toFixed(3),
    '-movflags', '+faststart',
    o.output
  );
  return args;
}

export async function stitchScenes(o: StitchOptions) {
  await runFfmpeg(buildStitchArgs(o));
}

export function frameSize(aspect: '9:16' | '16:9' | '1:1'): { width: number; height: number } {
  if (aspect === '16:9') return { width: 1280, height: 720 };
  if (aspect === '1:1') return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}
