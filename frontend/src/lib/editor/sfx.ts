import { spawn } from 'child_process';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { SR, TAU, lpCoef, normalizePeak, rng, sfxImpact, sfxWhoosh } from './synth';

/**
 * Biblioteca de efectos de sonido para la edición dirigida por Claude.
 * Todos se sintetizan aquí (deterministas, sin archivos de terceros: no hay derechos que pagar).
 * Claude coloca decenas a lo largo del video; se mezclan en UNA pista (buildSfxTrack) en vez de
 * una entrada de FFmpeg por efecto, así no hay límite práctico de cantidad.
 */

export const SFX_TYPES = [
  'click',
  'tick',
  'pop',
  'blip',
  'swish',
  'whoosh',
  'swipe',
  'riser',
  'impacto',
  'boom',
  'thud',
  'ding',
  'exito',
  'error',
  'shutter',
  'typing',
  'glitch',
  'brillo',
  'clap',
  'caja_registradora',
] as const;
export type SfxType = (typeof SFX_TYPES)[number];

/** Para el catálogo que ve Claude: qué es cada uno y cuándo usarlo. */
export const SFX_CATALOG: Record<SfxType, string> = {
  click: 'Clic de ratón seco. Al seleccionar algo, al aparecer un ítem de lista, al "pulsar" un botón en pantalla.',
  tick: 'Tic suave de interfaz (selección, scroll, cambio de opción). Ideal en ráfagas para contar o recorrer opciones.',
  pop: 'Pop de burbuja. Cuando aparece una palabra clave, un sticker, un emoji o una imagen flotante.',
  blip: 'Bip digital corto que sube. Datos, números, notificación discreta, aparición de texto técnico.',
  swish: 'Whoosh corto y rápido (0,3 s). Entradas y salidas rápidas de elementos, cambios de cámara.',
  whoosh: 'Whoosh largo (0,7 s). Transiciones grandes, pantalla completa que entra, cambio de escena.',
  swipe: 'Deslizar de dedo/papel. Cambiar de pantalla, pasar de diapositiva, pantalla dividida que entra.',
  riser: 'Subida de tensión (1,2 s). Antes de una revelación, de un dato fuerte o del clímax: termina justo en el golpe.',
  impacto: 'Golpe grave con transitorio. Primer fotograma (gancho), frase contundente, palabra gigante.',
  boom: 'Caída de subgrave cinematográfica (1,5 s). Momento clave, reveal grande, cierre potente. Úsalo poco.',
  thud: 'Golpe sordo corto. Énfasis en una palabra, cada ítem de una lista "que cae", punch-in de cámara.',
  ding: 'Campanita brillante. Idea, acierto, dato curioso, notificación.',
  exito: 'Arpegio ascendente de logro. Resultado, antes/después positivo, CTA conseguido.',
  error: 'Zumbido descendente de "incorrecto". Mito, error común, lo que NO hay que hacer.',
  shutter: 'Obturador de cámara. Cuando aparece una foto o captura.',
  typing: 'Ráfaga de teclado (0,6 s). Cuando aparece texto escribiéndose, una búsqueda, un prompt.',
  glitch: 'Glitch digital. Con la transición glitch, cortes bruscos, algo "roto" o tecnológico.',
  brillo: 'Destello brillante (sparkle). Algo nuevo, premium, mágico, antes/después.',
  clap: 'Palmada seca. Acento rítmico, aplauso a un logro, golpe de inicio de sección.',
  caja_registradora: 'Ka-ching. Dinero, precio, ahorro, ventas.',
};

const env = (t: number, attack: number, decay: number) => Math.min(1, t / Math.max(1e-4, attack)) * Math.exp(-t / Math.max(1e-4, decay));

function buf(seconds: number) {
  return new Float32Array(Math.max(1, Math.round(SR * seconds)));
}

function tone(freqs: number[], seconds: number, decay: number, opts: { attack?: number; harm?: number; glideTo?: number } = {}) {
  const out = buf(seconds);
  const ph = freqs.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = i / out.length;
    let v = 0;
    freqs.forEach((f0, k) => {
      const f = opts.glideTo ? f0 * Math.pow(opts.glideTo / freqs[0], p) : f0;
      ph[k] += (TAU * f) / SR;
      v += Math.sin(ph[k]) + (opts.harm ?? 0) * Math.sin(2 * ph[k]);
    });
    out[i] = (v / freqs.length) * env(t, opts.attack ?? 0.002, decay);
  }
  return out;
}

function noiseBurst(seconds: number, decay: number, fc: number, seed: number, hp = false) {
  const r = rng(seed);
  const out = buf(seconds);
  let lp = 0;
  const a = lpCoef(fc);
  for (let i = 0; i < out.length; i++) {
    const x = r() * 2 - 1;
    lp += a * (x - lp);
    out[i] = (hp ? x - lp : lp) * env(i / SR, 0.001, decay);
  }
  return out;
}

function mixInto(dst: Float32Array, src: Float32Array, at: number, gain = 1) {
  const i0 = Math.round(at * SR);
  for (let j = 0; j < src.length && i0 + j < dst.length; j++) if (i0 + j >= 0) dst[i0 + j] += src[j] * gain;
}

function finish(x: Float32Array): Float32Array {
  normalizePeak([x]);
  return x;
}

const cache = new Map<SfxType, Float32Array>();

/** Muestras (mono, 48 kHz, pico ~0,89) de un efecto. */
export function sfxSamples(tipo: SfxType): Float32Array {
  const hit = cache.get(tipo);
  if (hit) return hit;
  let x: Float32Array;
  switch (tipo) {
    case 'click': {
      x = buf(0.06);
      mixInto(x, noiseBurst(0.02, 0.003, 7000, 3, true), 0, 0.9);
      mixInto(x, tone([2200], 0.03, 0.006), 0, 0.5);
      mixInto(x, noiseBurst(0.02, 0.002, 5000, 4, true), 0.018, 0.35);
      break;
    }
    case 'tick':
      x = buf(0.05);
      mixInto(x, tone([3200, 4800], 0.04, 0.008), 0, 0.7);
      mixInto(x, noiseBurst(0.01, 0.002, 9000, 5, true), 0, 0.3);
      break;
    case 'pop': {
      x = buf(0.14);
      let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / SR;
        ph += (TAU * (380 + 900 * Math.exp(-t * 60))) / SR;
        x[i] = Math.sin(ph) * env(t, 0.001, 0.035);
      }
      mixInto(x, noiseBurst(0.01, 0.002, 4000, 6), 0, 0.3);
      break;
    }
    case 'blip':
      x = tone([880], 0.12, 0.05, { glideTo: 1760, harm: 0.2 });
      break;
    case 'swish':
      x = sfxWhoosh(17, 0.32);
      break;
    case 'whoosh':
      x = sfxWhoosh(11, 0.7);
      break;
    case 'swipe': {
      const r = rng(21);
      x = buf(0.22);
      let lp = 0;
      for (let i = 0; i < x.length; i++) {
        const p = i / x.length;
        const a = lpCoef(1500 + 5000 * p);
        const n = r() * 2 - 1;
        lp += a * (n - lp);
        x[i] = (n - lp) * Math.sin(Math.PI * p) * 0.8;
      }
      break;
    }
    case 'riser': {
      const r = rng(31);
      x = buf(1.2);
      let ph = 0;
      let lp = 0;
      for (let i = 0; i < x.length; i++) {
        const p = i / x.length;
        const t = i / SR;
        ph += (TAU * (180 * Math.pow(6, p))) / SR;
        const a = lpCoef(400 + 9000 * p * p);
        lp += a * (r() * 2 - 1 - lp);
        const shape = Math.pow(p, 1.8) * (p > 0.97 ? (1 - p) / 0.03 : 1);
        x[i] = (Math.sin(ph) * 0.35 + lp * 0.9) * shape + Math.sin(TAU * 55 * t) * 0.15 * p;
      }
      break;
    }
    case 'impacto':
      x = sfxImpact(7);
      break;
    case 'boom': {
      x = buf(1.6);
      let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / SR;
        ph += (TAU * (28 + 70 * Math.exp(-t * 4))) / SR;
        x[i] = Math.tanh(Math.sin(ph) * 1.8) * env(t, 0.004, 0.7);
      }
      mixInto(x, noiseBurst(0.4, 0.08, 1200, 8), 0, 0.5);
      break;
    }
    case 'thud': {
      x = buf(0.25);
      let ph = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / SR;
        ph += (TAU * (60 + 120 * Math.exp(-t * 40))) / SR;
        x[i] = Math.sin(ph) * env(t, 0.001, 0.06);
      }
      mixInto(x, noiseBurst(0.03, 0.006, 2500, 9), 0, 0.4);
      break;
    }
    case 'ding':
      x = tone([1318.5, 2637, 3951], 1.0, 0.35, { attack: 0.001 });
      break;
    case 'exito': {
      x = buf(0.75);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => mixInto(x, tone([f, f * 2], 0.5, 0.18, { harm: 0.15 }), k * 0.07, 0.8));
      break;
    }
    case 'error': {
      x = buf(0.45);
      [311.1, 233.1].forEach((f, k) => {
        const s = buf(0.2);
        let ph = 0;
        for (let i = 0; i < s.length; i++) {
          ph += (TAU * f) / SR;
          s[i] = Math.sign(Math.sin(ph)) * 0.4 * env(i / SR, 0.004, 0.09);
        }
        mixInto(x, s, k * 0.18);
      });
      let lp = 0;
      const a = lpCoef(1800);
      for (let i = 0; i < x.length; i++) {
        lp += a * (x[i] - lp);
        x[i] = lp;
      }
      break;
    }
    case 'shutter':
      x = buf(0.18);
      mixInto(x, noiseBurst(0.04, 0.01, 6000, 12, true), 0);
      mixInto(x, noiseBurst(0.05, 0.012, 3500, 13), 0.075, 0.8);
      mixInto(x, tone([1500], 0.02, 0.004), 0.075, 0.3);
      break;
    case 'typing': {
      x = buf(0.65);
      const r = rng(41);
      for (let k = 0; k < 9; k++) {
        const at = k * 0.065 + r() * 0.02;
        mixInto(x, noiseBurst(0.025, 0.004, 4000 + r() * 3000, 50 + k, true), at, 0.6 + r() * 0.4);
        mixInto(x, tone([180 + r() * 60], 0.02, 0.006), at, 0.3);
      }
      break;
    }
    case 'glitch': {
      x = buf(0.35);
      const r = rng(61);
      for (let k = 0; k < 7; k++) {
        const at = k * 0.045;
        const f = 200 + r() * 1800;
        const seg = buf(0.03 + r() * 0.03);
        let ph = 0;
        for (let i = 0; i < seg.length; i++) {
          ph += (TAU * f) / SR;
          seg[i] = (Math.sign(Math.sin(ph)) * 0.5 + (r() * 2 - 1) * 0.5) * (r() < 0.9 ? 1 : 0);
        }
        mixInto(x, seg, at, 0.7);
      }
      break;
    }
    case 'brillo': {
      x = buf(0.9);
      const r = rng(71);
      for (let k = 0; k < 10; k++) mixInto(x, tone([2500 + r() * 3500], 0.3, 0.08), k * 0.05 + r() * 0.03, 0.4 + r() * 0.3);
      break;
    }
    case 'clap': {
      x = buf(0.25);
      for (let k = 0; k < 3; k++) mixInto(x, noiseBurst(0.02, 0.004, 3000, 80 + k), k * 0.011, 0.6);
      mixInto(x, noiseBurst(0.22, 0.05, 2400, 84), 0.033, 0.8);
      break;
    }
    case 'caja_registradora': {
      x = buf(0.9);
      mixInto(x, noiseBurst(0.06, 0.015, 5000, 90), 0, 0.6);
      mixInto(x, tone([2093, 2637, 3136], 0.8, 0.28, { attack: 0.001 }), 0.08, 0.9);
      break;
    }
  }
  const out = finish(x);
  cache.set(tipo, out);
  return out;
}

/** Decodifica un audio (efecto propio) a mono 48 kHz en flotantes con FFmpeg. */
export function decodeMono(file: string, maxSeconds = 20): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-t', String(maxSeconds), '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`No se pudo leer el efecto ${file}: ${err.slice(-300)}`));
      const b = Buffer.concat(chunks);
      const out = new Float32Array(Math.floor(b.length / 4));
      for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
      normalizePeak([out]);
      resolve(out);
    });
  });
}

export interface SfxPlacement {
  /** Segundo del video final. */
  t: number;
  muestras: Float32Array;
  /** dB respecto al nivel normal de efectos (−18…+6). */
  volumenDb: number;
  /** −1 (izquierda) … 1 (derecha). */
  pan: number;
}

/**
 * Una sola pista estéreo con todos los efectos, a −6 dB de margen (la mezcla le aplica la ganancia
 * final). Si se pisan, un limitador suave evita que saturen.
 */
export function buildSfxTrack(duracion: number, efectos: SfxPlacement[]): { left: Float32Array; right: Float32Array } {
  const n = Math.max(1, Math.round(duracion * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (const e of efectos) {
    const g = 0.5 * Math.pow(10, e.volumenDb / 20);
    const pan = Math.max(-1, Math.min(1, e.pan));
    const gl = g * Math.sqrt((1 - pan) / 2) * Math.SQRT2;
    const gr = g * Math.sqrt((1 + pan) / 2) * Math.SQRT2;
    const i0 = Math.round(e.t * SR);
    for (let j = 0; j < e.muestras.length && i0 + j < n; j++) {
      if (i0 + j < 0) continue;
      L[i0 + j] += e.muestras[j] * gl;
      R[i0 + j] += e.muestras[j] * gr;
    }
  }
  for (const c of [L, R]) for (let i = 0; i < n; i++) if (Math.abs(c[i]) > 0.8) c[i] = Math.sign(c[i]) * (0.8 + 0.2 * Math.tanh((Math.abs(c[i]) - 0.8) / 0.2));
  return { left: L, right: R };
}
