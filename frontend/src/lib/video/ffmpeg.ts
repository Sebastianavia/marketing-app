import { execFile, spawn } from 'child_process';
import { createRequire } from 'module';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

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
  /** Duración total = duración de la voz (o de los clips si se usa su propio audio). */
  total: number;
  /** Voz continua encima de todo. Si falta, se usa el audio de cada clip (clipHasAudio). */
  audioPath?: string;
  /** Duración de cada clip a usar (si no, sale de los inicios). */
  lens?: number[];
  /** Con audio propio de los clips: si cada clip trae pista de audio. */
  clipHasAudio?: boolean[];
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

  const lens =
    o.lens ??
    o.clips.map((_, i) => (i < n - 1 ? o.starts[i + 1] - o.starts[i] + d : o.total - o.starts[i]));
  const useClipAudio = !o.audioPath;
  if (useClipAudio && !o.clipHasAudio) throw new Error('Falta saber qué clips traen audio.');
  if (lens.some((l) => !(l > d))) throw new Error('Hay una escena demasiado corta para el fundido.');

  const args: string[] = ['-y'];
  o.clips.forEach((c) => args.push('-i', c.path));
  if (o.audioPath) args.push('-i', o.audioPath);

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

  let audioMap = `${n}:a`;
  if (useClipAudio) {
    // Audio de cada clip (o silencio si no trae), recortado a su duración y unido con fundido cruzado
    o.clips.forEach((_, i) => {
      f.push(
        o.clipHasAudio![i]
          ? `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${lens[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
          : `anullsrc=r=44100:cl=stereo,atrim=duration=${lens[i].toFixed(3)}[a${i}]`
      );
    });
    let la = 'a0';
    for (let k = 1; k < n; k++) {
      const out = k === n - 1 ? 'aout' : `ax${k}`;
      f.push(`[${la}][a${k}]acrossfade=d=${d.toFixed(3)}[${out}]`);
      la = out;
    }
    if (n === 1) f.push(`[a0]anull[aout]`);
    audioMap = '[aout]';
  }

  args.push(
    '-filter_complex', f.join(';'),
    '-map', '[vout]', '-map', audioMap,
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

/** Duración y si trae audio, leyendo la cabecera con FFmpeg. */
export async function probeMedia(file: string): Promise<{ duration: number | null; hasAudio: boolean }> {
  const bin = resolveFfmpegPath();
  const stderr: string = await new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(err));
  });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  return { duration, hasAudio: /Stream #\S+.*Audio:/.test(stderr) };
}

export function frameSize(aspect: '9:16' | '16:9' | '1:1'): { width: number; height: number } {
  if (aspect === '16:9') return { width: 1280, height: 720 };
  if (aspect === '1:1') return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}

// =============================================================================
// UGC Studio: unión de escenas encadenadas (recortes, degradado de color, ventanas A/V)
// =============================================================================

const run = promisify(execFile);
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export async function makeTempDir(prefix = 'ugc-studio-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function probeDurationSeconds(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(stdout.trim()) || 0;
}

/**
 * Ventana de la pista de video en la línea de tiempo del archivo. En los clips de heygen el video
 * empieza en ~0.083 s y termina antes que el audio: usar esta ventana para ambas pistas evita
 * desfases de labios y huecos congelados al unir.
 */
export async function probeVideoWindow(file: string): Promise<{ start: number; end: number }> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time,duration', '-of', 'json', file]);
  const stream = JSON.parse(stdout).streams?.[0] ?? {};
  const start = parseFloat(stream.start_time) || 0;
  const duration = parseFloat(stream.duration) || (await probeDurationSeconds(file)) - start;
  return { start, end: start + duration };
}

export async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return stdout.trim().length > 0;
}

// Recorte inicial de las escenas que arrancan desde el último fotograma de la anterior:
// heygen deja el arranque casi quieto y en silencio. 0.1 s acorta la pausa sin que se note el salto.
export const CONTINUOUS_LEAD_TRIM_SECONDS = 0.1;

// -----------------------------------------------------------------------------
// Igualación de color entre escenas encadenadas
// -----------------------------------------------------------------------------
// heygen no mantiene exactamente la exposición al continuar una escena (medido 2026-10-15: el clip
// nuevo arrancaba 6-7 niveles más oscuro y con más contraste). Una corrección fija en el corte se
// sigue notando, así que se hace un degradado: los últimos segundos de la escena anterior migran
// hacia un punto intermedio y la escena nueva arranca en ese punto y vuelve poco a poco a su color.

/** Segundos de degradado de color a cada lado de un corte entre escenas encadenadas. */
export const COLOR_RAMP_SECONDS = 2;

/** Escala llenando el cuadro y recorta lo que sobra (sin franjas negras). */
function fillCrop(size: { width: number; height: number }): string {
  return `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`;
}

export type ColorStats = { mean: number; std: number }[]; // R, G, B

const STATS_WIDTH = 96;
const STATS_HEIGHT = 170;

/**
 * Media y desviación por canal de un fotograma (`start` segundos desde el inicio o `fromEnd` desde el final).
 * Se mide con el mismo escalado y recorte que usa concatClips (`size`), o el promedio no coincide con lo que se corrige.
 */
export async function frameColorStats(
  file: string,
  at: { start?: number; fromEnd?: number },
  size: { width: number; height: number }
): Promise<ColorStats> {
  const seek = at.fromEnd !== undefined ? ['-sseof', `-${at.fromEnd}`] : ['-ss', String(at.start ?? 0)];
  const { stdout } = await promisify(execFile)(
    resolveFfmpegPath(),
    ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', `${fillCrop(size)},scale=${STATS_WIDTH}:${STATS_HEIGHT},format=rgb24`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
  );
  const data = stdout as Buffer;
  return [0, 1, 2].map((c) => {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = c; i < data.length; i += 3) {
      sum += data[i];
      sumSq += data[i] * data[i];
      n++;
    }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
  });
}

/** Ganancia por canal acotada: corrige diferencias de luz sin deformar un plano realmente distinto. */
function channelGain(target: { std: number }, source: { std: number }): number {
  return source.std > 1 ? Math.min(1.25, Math.max(0.8, target.std / source.std)) : 1;
}

/** Filtro lutrgb que lleva `source` a `target`; null si la diferencia es imperceptible. */
export function colorMatchFilter(target: ColorStats, source: ColorStats): string | null {
  const parts = source.map((s, c) => {
    const gain = channelGain(target[c], s);
    const offset = Math.max(-40, Math.min(40, target[c].mean - s.mean));
    return { gain, offset, expr: `clip((val-${s.mean.toFixed(2)})*${gain.toFixed(4)}+${(s.mean + offset).toFixed(2)},0,255)` };
  });
  if (parts.every((p) => Math.abs(p.offset) < 1.5 && Math.abs(p.gain - 1) < 0.02)) return null;
  return `lutrgb=${['r', 'g', 'b'].map((ch, c) => `${ch}='${parts[c].expr}'`).join(':')}`;
}

/** Punto intermedio entre dos looks: ahí se encuentran las dos escenas en el corte. */
export function colorMidpoint(a: ColorStats, b: ColorStats): ColorStats {
  return a.map((x, c) => ({ mean: (x.mean + b[c].mean) / 2, std: (x.std + b[c].std) / 2 }));
}

/** Degradado de color de un clip: `in` se aplica completo al inicio y se desvanece; `out` aparece hacia el final. */
export interface ColorRamp {
  in?: string | null;
  out?: string | null;
}

/** Extrae el último fotograma como JPG (se usa como first_frame de la escena siguiente). */
export async function extractLastFrame(videoFile: string): Promise<Buffer> {
  const out = path.join(path.dirname(videoFile), `${path.basename(videoFile, path.extname(videoFile))}_last.jpg`);
  await run(resolveFfmpegPath(), ['-y', '-sseof', '-0.15', '-i', videoFile, '-update', '1', '-q:v', '2', out]);
  return fs.readFile(out);
}

/**
 * Une los clips en orden. `crossfadeAfter[i]` = segundos de fundido entre el clip i y el i+1
 * (0 = corte directo). `trimStart[i]` = segundos que se recortan al inicio del clip i.
 * `colorRamps[i]` = degradado de color al inicio/final del clip i (ver colorMatchFilter).
 * Re-codifica para normalizar resolución/fps entre clips. Escala llenando el cuadro y recorta lo que
 * sobra: heygen entrega 768x1344 o 480x832, y rellenar con franjas negras cambiaba el encuadre en cada corte.
 */
export async function concatClips(
  files: string[],
  crossfadeAfter: number[],
  output: string,
  size: { width: number; height: number },
  trimStart: number[] = [],
  colorRamps: ColorRamp[] = []
): Promise<void> {
  const trims = files.map((_, i) => trimStart[i] || 0);
  const windows = await Promise.all(files.map(probeVideoWindow));
  // Video y audio se cortan en la misma ventana (la del video) para que no se desfasen
  const cutStart = windows.map((w, i) => w.start + trims[i]);
  const durations = windows.map((w, i) => Math.max(0.1, w.end - cutStart[i]));
  const audio = await Promise.all(files.map(hasAudioStream));
  const filters: string[] = [];

  files.forEach((_, i) => {
    filters.push(
      `[${i}:v]trim=start=${cutStart[i].toFixed(4)}:end=${windows[i].end.toFixed(4)},setpts=PTS-STARTPTS,${fillCrop(size)},setsar=1,fps=30,settb=AVTB,format=yuv420p[b${i}_0]`
    );
    // Degradados: se mezcla el clip con su versión corregida, con un peso que varía en el tiempo (T)
    const ramp = Math.min(COLOR_RAMP_SECONDS, durations[i] / 2);
    const stages: { filter: string; weight: string }[] = [];
    if (colorRamps[i]?.in) stages.push({ filter: colorRamps[i].in!, weight: `clip(1-T/${ramp.toFixed(3)},0,1)` });
    if (colorRamps[i]?.out)
      stages.push({ filter: colorRamps[i].out!, weight: `clip((T-${(durations[i] - ramp).toFixed(3)})/${ramp.toFixed(3)},0,1)` });
    stages.forEach((stage, k) => {
      const src = `b${i}_${k}`;
      filters.push(
        `[${src}]split[${src}o][${src}s];[${src}s]format=rgb24,${stage.filter},format=yuv420p[${src}c];` +
          `[${src}o][${src}c]blend=all_expr='A*(1-${stage.weight})+B*${stage.weight}'[b${i}_${k + 1}]`
      );
    });
    filters.push(`[b${i}_${stages.length}]null[v${i}]`);
    filters.push(
      audio[i]
        ? `[${i}:a]apad,atrim=start=${cutStart[i].toFixed(4)}:end=${windows[i].end.toFixed(4)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a${i}]`
        : `anullsrc=r=44100:cl=stereo,atrim=0:${durations[i]}[a${i}]`
    );
  });

  let vPrev = 'v0';
  let aPrev = 'a0';
  let offset = durations[0];
  for (let i = 1; i < files.length; i++) {
    const fade = Math.min(crossfadeAfter[i - 1] || 0, durations[i - 1] / 2, durations[i] / 2);
    const vOut = `vx${i}`;
    const aOut = `ax${i}`;
    if (fade > 0) {
      offset -= fade;
      filters.push(`[${vPrev}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}[${vOut}]`);
      filters.push(`[${aPrev}][a${i}]acrossfade=d=${fade}[${aOut}]`);
    } else {
      filters.push(`[${vPrev}][${aPrev}][v${i}][a${i}]concat=n=2:v=1:a=1[${vOut}][${aOut}]`);
    }
    offset += durations[i];
    vPrev = vOut;
    aPrev = aOut;
  }

  await run(
    resolveFfmpegPath(),
    [
      '-y',
      ...files.flatMap((f) => ['-i', f]),
      '-filter_complex',
      filters.join(';'),
      '-map',
      `[${vPrev}]`,
      '-map',
      `[${aPrev}]`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      output,
    ],
    { maxBuffer: 20 * 1024 * 1024 }
  );
}
