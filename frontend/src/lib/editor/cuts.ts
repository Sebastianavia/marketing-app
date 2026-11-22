import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { RhythmSettings } from '@/config/editor-looks';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { keptIntervals, type KeptInterval } from './timeline';
import type { EditPhrase, EditProject } from './types';

/**
 * Cortes que siguen al SONIDO, no solo a los tiempos de la transcripción.
 *
 * Problemas medidos con los videos reales (nov 2026):
 *  - Scribe marca el inicio de las palabras tarde (el sonido empieza de mediana 65 ms antes, hasta
 *    ~250 ms) y con márgenes de 50 ms la entrada se comía la primera consonante.
 *  - Las colas (la «s» final, la reverberación) siguen sonando después del fin que marca Scribe:
 *    cortar ahí deja el corte seco.
 *  - Redondear al fotograma más cercano podía meter el corte 16 ms dentro de la palabra.
 *
 * Solución: una envolvente de energía del audio original (cada 5 ms, en tiempo de MUESTRAS = el de
 * la transcripción) y, en cada borde de tramo, buscar dónde empieza y acaba de verdad el sonido de
 * la palabra, sin invadir la palabra vecina (aunque esté cortada) ni las voces de fondo. El
 * redondeo a fotograma va hacia fuera (conserva más) si cabe. Cada tramo lleva además cuánto audio
 * extra hay a cada lado (`hl`/`hr`) para fundir los cortes con un fundido cruzado sin silencios.
 *
 * Todo el servidor usa `editIntervals` (render, palabras_borrador, nota, variantes…): así los
 * tiempos que ve Claude son los mismos que se renderizan.
 */

export const FPS = 30;
const WIN = 0.005;
/** Aire antes del ataque y después de la cola. */
const PRE = 0.05;
const POST = 0.06;
/** Cuánto se busca hacia atrás el ataque y hacia delante la cola. */
const MAX_ONSET = 0.2;
const MAX_TAIL = 0.35;

/**
 * Umbrales sobre el ruido de fondo. El ataque se busca con un umbral de VOZ (si no, una
 * inspiración de −53 dB antes de hablar contaba como palabra y el tramo empezaba con la
 * respiración: medido en Santi R18, 0,30–0,66 s). La cola, con uno bajo: la caída de la palabra
 * y la reverberación son flojas pero cortarlas es lo que suena seco.
 */
export function cutThresholds(env: Pick<Envelope, 'floor' | 'voice'>) {
  const span = Math.max(10, env.voice - env.floor);
  return { onset: env.floor + Math.max(10, 0.4 * span), tail: env.floor + Math.max(5, 0.2 * span) };
}
/** Audio extra máximo a cada lado del corte para el fundido cruzado. */
export const MAX_HANDLE = 0.025;

export interface Envelope {
  /** dB por ventana de 5 ms. */
  db: Float32Array;
  floor: number;
  voice: number;
}

// ── Envolvente ───────────────────────────────────────────────────────────────

const envFile = (carpeta: string) => path.join(/*turbopackIgnore: true*/ carpeta, 'envolvente-v1.bin');

const g = globalThis as unknown as { __luloEnv?: Map<string, { mtime: number; env: Envelope }> };
const cache = (g.__luloEnv ??= new Map());

function stats(db: Float32Array): Envelope {
  const sorted = Float32Array.from(db).sort();
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? -90;
  return { db, floor: pick(0.1), voice: pick(0.9) };
}

/** Envolvente (dB cada 5 ms, voz entre 80 Hz y 7 kHz) de cualquier archivo con audio. */
export async function computeEnvelope(file: string, cwd?: string): Promise<Envelope> {
  const bin = await resolveFfmpegPath();
  if (!bin) throw new Error('FFmpeg no está disponible.');
  const SR = 16000;
  const hop = SR * WIN;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-af', 'highpass=f=80,lowpass=f=7000', '-f', 's16le', 'pipe:1'], { cwd, windowsHide: true });
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg terminó con código ${code} al leer el audio.`))));
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(Math.floor(n / hop));
  for (let k = 0; k < out.length; k++) {
    let s = 0;
    for (let j = 0; j < hop; j++) {
      const v = buf.readInt16LE((k * hop + j) * 2) / 32768;
      s += v * v;
    }
    out[k] = 10 * Math.log10(s / hop + 1e-10);
  }
  return stats(out);
}

/** Crea (una vez) la envolvente del original de la edición. */
export async function ensureEnvelope(p: Pick<EditProject, 'carpeta' | 'original'>): Promise<Envelope | null> {
  const loaded = loadEnvelope(p);
  if (loaded) return loaded;
  try {
    const env = await computeEnvelope(path.join(/*turbopackIgnore: true*/ p.carpeta, p.original.archivo), p.carpeta);
    await fs.writeFile(envFile(p.carpeta), Buffer.from(env.db.buffer, env.db.byteOffset, env.db.byteLength));
    cache.delete(p.carpeta);
    return loadEnvelope(p);
  } catch (err) {
    console.warn('[cortes] Sin envolvente de audio:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** La envolvente guardada (sin calcularla). */
export function loadEnvelope(p: Pick<EditProject, 'carpeta' | 'original'>): Envelope | null {
  if (!p.original.tieneAudio) return null;
  const file = envFile(p.carpeta);
  let mtime: number;
  try {
    mtime = fsSync.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(p.carpeta);
  if (hit && hit.mtime === mtime) return hit.env;
  const raw = fsSync.readFileSync(file);
  const db = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const env = stats(db);
  cache.set(p.carpeta, { mtime, env });
  return env;
}

// ── Rejilla de fotogramas ─────────────────────────────────────────────────────

/** Ajusta los tramos a la rejilla de fotogramas para que audio y video midan lo mismo. */
export function snapToFrames(intervals: KeptInterval[]): KeptInterval[] {
  const snap = (t: number) => Math.round(t * FPS) / FPS;
  let out = 0;
  const res: KeptInterval[] = [];
  for (const iv of intervals) {
    const s = snap(iv.s);
    const e = snap(iv.e);
    if (e - s < 2 / FPS) continue;
    res.push({ ...iv, s, e, out });
    out += e - s;
  }
  return res;
}

// ── Afinar los bordes con el sonido ──────────────────────────────────────────

export interface CutReport {
  /** Uniones donde no había silencio: el corte cae sobre voz (corte por palabra en habla seguida). */
  sobreVoz: number[];
}

/**
 * Afina los tramos de `keptIntervals` con la envolvente. Devuelve tramos ya en la rejilla de
 * fotogramas, con `hl`/`hr` (audio disponible a cada lado para el fundido cruzado).
 */
export function refineIntervals(
  raw: KeptInterval[],
  phrases: EditPhrase[],
  duracion: number,
  env: Envelope,
  report?: CutReport
): KeptInterval[] {
  const th = cutThresholds(env);
  const quiet = th.tail;
  const n = env.db.length;
  const val = (t: number) => env.db[Math.max(0, Math.min(n - 1, Math.round(t / WIN)))];

  /** Primer instante (hacia atrás desde t) en que la palabra ya suena; tolera huecos de 25 ms. */
  const onsetBefore = (t: number, lo: number) => {
    let last = t;
    let dip = 0;
    for (let u = t; u >= lo; u -= WIN) {
      if (val(u) > th.onset) {
        last = u;
        dip = 0;
      } else if ((dip += WIN) > 0.025) break;
    }
    return last;
  };
  /** Último instante (hacia delante desde t) en que la palabra aún suena. */
  const tailAfter = (t: number, hi: number) => {
    let last = t;
    let dip = 0;
    for (let u = t; u <= hi; u += WIN) {
      if (val(u) > quiet) {
        last = u;
        dip = 0;
      } else if ((dip += WIN) > 0.025) break;
    }
    return last;
  };
  /** El punto más silencioso entre a y b. */
  const valley = (a: number, b: number) => {
    let best = a;
    let bv = Infinity;
    for (let u = a; u <= b; u += WIN) {
      const v = val(u);
      if (v < bv) {
        bv = v;
        best = u;
      }
    }
    return { t: best, db: bv };
  };

  // Todo lo que suena (palabras, también las cortadas, y voces de fondo), para no invadirlo
  const sounds = [...phrases.flatMap((p) => p.palabras.map((w) => ({ s: w.s, e: w.e }))), ...phrases.flatMap((p) => p.huecos ?? [])].sort((a, b) => a.s - b.s);
  const kept = phrases
    .filter((p) => !p.cortar)
    .flatMap((p) => p.palabras.filter((w) => !w.cortar))
    .sort((a, b) => a.s - b.s);

  const refined: Array<KeptInterval & { lo: number; hi: number }> = [];
  for (const iv of raw) {
    const inside = kept.filter((w) => w.s >= iv.s - 0.001 && w.e <= iv.e + 0.001);
    if (!inside.length) {
      refined.push({ ...iv, lo: iv.s, hi: iv.e });
      continue;
    }
    const first = inside[0];
    const last = inside[inside.length - 1];
    const prev = [...sounds].reverse().find((x) => x.e <= first.s - 0.001 && !(x.s === first.s && x.e === first.e));
    const next = sounds.find((x) => x.s >= last.e + 0.001);

    // Entrada
    const onset = onsetBefore(first.s, Math.max(prev ? prev.e : 0, first.s - MAX_ONSET));
    let s: number;
    let lo: number;
    if (prev) {
      const prevTail = tailAfter(prev.e, onset);
      lo = prevTail + 0.01;
      if (prevTail >= onset - 0.01) {
        // Habla seguida: el corte va al punto más silencioso entre las dos palabras
        const v = valley(prev.e, first.s);
        s = v.t;
        lo = Math.min(v.t, prev.e + 0.005);
        if (v.db > quiet + 6) report?.sobreVoz.push(s);
      } else {
        s = Math.max(lo, Math.min(iv.s, onset - PRE));
      }
    } else {
      lo = 0;
      s = Math.max(0, Math.min(iv.s, onset - PRE));
    }

    // Salida
    const tail = tailAfter(last.e, Math.min(next ? next.s : duracion, last.e + MAX_TAIL));
    let e: number;
    let hi: number;
    if (next) {
      const nextOnset = onsetBefore(next.s, tail);
      hi = nextOnset - 0.01;
      if (nextOnset <= tail + 0.01) {
        const v = valley(last.e, next.s);
        e = v.t;
        hi = Math.max(v.t, next.s - 0.005);
        if (v.db > quiet + 6) report?.sobreVoz.push(e);
      } else {
        e = Math.min(hi, Math.max(iv.e, tail + POST));
      }
    } else {
      hi = duracion;
      e = Math.min(duracion, Math.max(iv.e, tail + POST));
    }
    if (e - s < 0.05) {
      s = iv.s;
      e = iv.e;
    }
    refined.push({ s, e, out: 0, lo, hi });
  }

  // Al fotograma, hacia fuera si no invade lo vecino
  const snapped = refined.map((r) => {
    let s = Math.floor(r.s * FPS + 1e-6) / FPS;
    if (s < r.lo - 1e-6) s = Math.ceil(r.s * FPS - 1e-6) / FPS;
    let e = Math.ceil(r.e * FPS - 1e-6) / FPS;
    if (e > r.hi + 1e-6) e = Math.floor(r.e * FPS + 1e-6) / FPS;
    return { s, e, lo: r.lo, hi: r.hi };
  });

  // Unir lo que se toca (si no había silencio para cortar, la pausa se queda) y calcular el «out»
  snapped.sort((a, b) => a.s - b.s);
  const merged: typeof snapped = [];
  for (const iv of snapped) {
    if (iv.e - iv.s < 2 / FPS) continue;
    const prevIv = merged[merged.length - 1];
    if (prevIv && iv.s <= prevIv.e + 1.5 / FPS) {
      prevIv.e = Math.max(prevIv.e, iv.e);
      prevIv.hi = Math.max(prevIv.hi, iv.hi);
    } else merged.push({ ...iv });
  }
  let out = 0;
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  return merged.map((iv) => {
    const k: KeptInterval = {
      s: r4(iv.s),
      e: r4(iv.e),
      out: r4(out),
      hl: r4(Math.max(0, Math.min(MAX_HANDLE, iv.s - iv.lo))),
      hr: r4(Math.max(0, Math.min(MAX_HANDLE, iv.hi - iv.e))),
    };
    out += k.e - k.s;
    return k;
  });
}

/**
 * Tramos definitivos de una edición (los que se renderizan). Con envolvente, afinados con el
 * sonido; sin ella (edición sin audio o aún sin analizar), los de la transcripción al fotograma.
 */
export function editIntervals(
  p: Pick<EditProject, 'frases' | 'original' | 'carpeta'>,
  ritmo: Pick<RhythmSettings, 'pausaMaxSeg' | 'margenSeg'>,
  report?: CutReport
): KeptInterval[] {
  const raw = keptIntervals(p.frases, ritmo, p.original.duracion);
  const env = loadEnvelope(p);
  if (!env) return snapToFrames(raw);
  return refineIntervals(raw, p.frases, p.original.duracion, env, report);
}
