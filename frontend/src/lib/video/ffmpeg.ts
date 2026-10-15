import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

/**
 * Utilidades de ffmpeg (servidor). La app corre en escritorio con ffmpeg instalado;
 * FFMPEG_PATH permite apuntar a un binario específico.
 */

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
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
    FFMPEG,
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
  await run(FFMPEG, ['-y', '-sseof', '-0.15', '-i', videoFile, '-update', '1', '-q:v', '2', out]);
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
    FFMPEG,
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
