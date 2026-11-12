import { spawn } from 'child_process';
import fsSync from 'fs';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { MUSIC_CATALOG, type MusicStyle } from './music';

/**
 * Cuadrícula de beats de la música (Fase 2 · sonido): para cortar, hacer zoom o meter un efecto
 * justo en el golpe. Música generada → exacta (se conoce el BPM y empieza en el primer tiempo).
 * Archivo → detección propia sin dependencias: flujo espectral (FFT) → tempo por autocorrelación
 * → fase de la cuadrícula → cada beat se ajusta al golpe real más cercano (±40 ms).
 * Todos los tiempos son del video (la música empieza en el segundo 0 del video).
 */

export interface BeatGrid {
  bpm: number;
  fuente: 'generada' | 'archivo';
  /** 0–1: qué tan clara es la pulsación detectada (solo archivo). */
  confianza?: number;
  /** Cada tiempo (negra). */
  beats: number[];
  /** Primer tiempo de cada compás (4/4): los mejores puntos para cambios grandes. */
  compases: number[];
  /** Golpes más fuertes (bombos, entradas, «drops»): para punch, impacto o un corte fuerte. */
  golpes: number[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Música generada por la app: cuadrícula exacta; en secciones de silencio no hay beats y su final es un «drop». */
export function generatedBeats(estilo: MusicStyle, duracion: number, secciones: Array<{ desde: number; hasta: number; energia: string }> = []): BeatGrid {
  const bpm = MUSIC_CATALOG[estilo].bpm;
  const beat = 60 / bpm;
  const silent = (t: number) => secciones.some((s) => s.energia === 'silencio' && t >= s.desde && t < s.hasta);
  const beats: number[] = [];
  const compases: number[] = [];
  for (let i = 0; i * beat < duracion; i++) {
    const t = i * beat;
    if (silent(t)) continue;
    beats.push(r3(t));
    if (i % 4 === 0) compases.push(r3(t));
  }
  // Golpes: inicio, vuelta tras cada silencio («drop») y paso de suave a completa
  const golpes = new Set<number>([0]);
  for (const s of secciones) if ((s.energia === 'silencio' || s.energia === 'suave') && s.hasta < duracion) golpes.add(r3(Math.round(s.hasta / beat) * beat));
  return { bpm, fuente: 'generada', beats, compases, golpes: [...golpes].sort((a, b) => a - b) };
}

const RATE = 11025;
const HOP = 256;
const WIN = 1024;

function decode(file: string, desde: number, dur: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', ...(desde > 0 ? ['-ss', desde.toFixed(3)] : []), '-t', dur.toFixed(3), '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'];
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`No se pudo leer la música: ${err.slice(-300)}`));
      const b = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(b.length / 4));
      for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
      resolve(out);
    });
  });
}

/** FFT radix-2 en sitio (re, im de longitud potencia de 2). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar;
        im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar;
        im[i + j] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Envolvente de inicio de notas (flujo espectral positivo en escala log), una muestra por HOP. */
export function onsetEnvelope(x: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((x.length - WIN) / HOP));
  const env = new Float64Array(frames);
  const hann = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  let prev = new Float64Array(WIN / 2);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WIN; i++) {
      re[i] = x[f * HOP + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(WIN / 2);
    let flux = 0;
    for (let k = 1; k < WIN / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      // Pesa más los graves (bombo) sin ignorar el resto
      if (d > 0) flux += k < 24 ? d * 2 : d;
    }
    env[f] = flux;
    prev = mag;
  }
  // Quita la tendencia (media móvil de ~0,5 s) y recorta lo negativo
  const w = Math.round((0.5 * RATE) / HOP);
  const out = new Float64Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += env[i];
    if (i >= w) acc -= env[i - w];
    out[i] = Math.max(0, env[i] - acc / Math.min(i + 1, w));
  }
  return out;
}

/** Tempo, fase y golpes a partir de la envolvente. Exportado para pruebas. */
export function gridFromEnvelope(env: Float64Array, duracion: number): Omit<BeatGrid, 'fuente'> {
  const fps = RATE / HOP;
  const n = env.length;
  const mean = env.reduce((s, v) => s + v, 0) / Math.max(1, n);
  // Autocorrelación entre 70 y 180 BPM, con preferencia suave por ~115 BPM (evita doblar o partir el tempo)
  let bestLag = 0;
  let bestScore = -Infinity;
  const minLag = Math.floor((60 / 180) * fps);
  const maxLag = Math.ceil((60 / 70) * fps);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i] - mean) * (env[i + lag] - mean);
    s /= Math.max(1, n - lag);
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.6, 2));
    const score = s * w;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i] - mean) * (env[i + lag] - mean);
    return s / Math.max(1, n - lag);
  };
  // Tempo doble o mitad: se prefiere el que cae en 80–150 BPM si su pulsación también es clara
  const bpm0 = (60 * fps) / bestLag;
  if (bpm0 > 150 && ac(bestLag * 2) > 0.35 * ac(bestLag)) bestLag *= 2;
  else if (bpm0 < 80 && bestLag >= 2 * minLag && ac(Math.round(bestLag / 2)) > 0.5 * ac(bestLag)) bestLag = Math.round(bestLag / 2);
  // Afinar el periodo con interpolación parabólica sobre la autocorrelación
  const a = ac(bestLag - 1);
  const b = ac(bestLag);
  const c = ac(bestLag + 1);
  const denom = a - 2 * b + c;
  const period = bestLag + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0);
  const bpm = Math.round(((60 * fps) / period) * 10) / 10;
  const confianza = Math.max(0, Math.min(1, b / Math.max(1e-9, ac(0))));

  // Fase: el desfase que más energía recoge sobre la cuadrícula
  const at = (pos: number) => {
    const i = Math.round(pos);
    return i >= 0 && i < n ? env[i] : 0;
  };
  let bestPhase = 0;
  let bestSum = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let p = ph; p < n; p += period) s += at(p) + 0.5 * (at(p - 1) + at(p + 1));
    if (s > bestSum) {
      bestSum = s;
      bestPhase = ph;
    }
  }
  // Cada beat se ajusta al pico real más cercano (±40 ms)
  const snap = Math.max(1, Math.round(0.04 * fps));
  const frames: number[] = [];
  for (let p = bestPhase; p < n; p += period) {
    let bi = Math.round(p);
    let bv = at(bi);
    for (let d = -snap; d <= snap; d++) {
      const v = at(Math.round(p) + d);
      if (v > bv * 1.15) {
        bv = v;
        bi = Math.round(p) + d;
      }
    }
    frames.push(bi);
  }
  const toT = (f: number) => r3((f * HOP + WIN / 2) / RATE);
  const beats = frames.map(toT).filter((t) => t < duracion);
  // Compás: de las 4 posiciones posibles, la que tiene los golpes más fuertes
  let bar0 = 0;
  let barBest = -1;
  for (let k = 0; k < 4; k++) {
    let s = 0;
    for (let i = k; i < frames.length; i += 4) s += at(frames[i]);
    if (s > barBest) {
      barBest = s;
      bar0 = k;
    }
  }
  const compases = beats.filter((_, i) => i % 4 === bar0);
  // Golpes fuertes: picos muy por encima de la media, separados ≥ 0,25 s (máx. 40)
  const std = Math.sqrt(env.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n));
  const peaks: Array<{ i: number; v: number }> = [];
  for (let i = 1; i < n - 1; i++) if (env[i] > mean + 2.2 * std && env[i] >= env[i - 1] && env[i] >= env[i + 1]) peaks.push({ i, v: env[i] });
  peaks.sort((x, y) => y.v - x.v);
  const minGap = 0.25 * fps;
  const chosen: number[] = [];
  for (const p of peaks) {
    if (chosen.length >= 40) break;
    if (chosen.every((q) => Math.abs(q - p.i) >= minGap)) chosen.push(p.i);
  }
  const golpes = chosen.map(toT).filter((t) => t < duracion).sort((x, y) => x - y);
  return { bpm, confianza: Math.round(confianza * 100) / 100, beats, compases, golpes };
}

const cache = new Map<string, BeatGrid>();

/** Beats de un archivo de música tal como suena en el video (desde `inicioArchivo`, `duracion` s). */
export async function detectBeats(file: string, inicioArchivo: number, duracion: number): Promise<BeatGrid> {
  const mtime = fsSync.statSync(file).mtimeMs;
  const key = `${file}|${mtime}|${inicioArchivo}|${duracion.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const x = await decode(file, inicioArchivo, Math.min(600, duracion + 0.5));
  const realDur = x.length / RATE;
  const g = gridFromEnvelope(onsetEnvelope(x), Math.min(duracion, realDur));
  // Si el archivo es más corto que el video, la música vuelve a empezar: se repite la cuadrícula
  const grid: BeatGrid = { ...g, fuente: 'archivo' };
  if (realDur > 4 && realDur < duracion - 0.5) {
    const rep = (xs: number[]) => {
      const out = [...xs];
      for (let off = realDur; off < duracion; off += realDur) for (const t of xs) if (t + off < duracion) out.push(r3(t + off));
      return out;
    };
    grid.beats = rep(g.beats);
    grid.compases = rep(g.compases);
    grid.golpes = rep(g.golpes);
  }
  if (cache.size > 50) cache.clear();
  cache.set(key, grid);
  return grid;
}

/** ¿Cuántos de estos tiempos caen en un beat (±tol s)? */
export function beatAlignment(times: number[], beats: number[], tol = 0.08): { alineados: number; total: number; fraccion: number; fuera: number[] } {
  const sorted = [...beats].sort((a, b) => a - b);
  const near = (t: number) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(Math.abs(sorted[lo] - t), lo > 0 ? Math.abs(sorted[lo - 1] - t) : Infinity);
  };
  const fuera = sorted.length ? times.filter((t) => near(t) > tol) : [...times];
  const alineados = times.length - fuera.length;
  return { alineados, total: times.length, fraccion: times.length ? alineados / times.length : 1, fuera: fuera.map(r3) };
}

/** El beat más cercano a t (para sugerir a Claude dónde mover un corte). */
export function nearestBeat(t: number, beats: number[]): number | undefined {
  let best: number | undefined;
  for (const b of beats) if (best === undefined || Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
}
