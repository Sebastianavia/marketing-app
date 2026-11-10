import fs from 'fs/promises';

/**
 * Música y efectos de sonido generados por la app (síntesis propia, sin archivos de terceros).
 * Todo es determinista: la misma semilla da el mismo audio.
 *  - Efectos: golpe (gancho) y whoosh (cortes con zoom).
 *  - Música: "pad" (acordes cálidos estilo lo-fi, 80 BPM) y "pulso" (synth con bajo y batería, 110 BPM).
 * La música se genera en bucles exactos de 4 acordes para poder repetirla sin saltos.
 */

export const SR = 48000;
export const TAU = Math.PI * 2;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const lpCoef = (fc: number) => 1 - Math.exp((-TAU * fc) / SR);

/** WAV estéreo de 16 bits a 48 kHz. */
export async function writeWav(file: string, left: Float32Array, right: Float32Array = left) {
  const n = Math.min(left.length, right.length);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  await fs.writeFile(file, buf);
}

export function normalizePeak(chs: Float32Array[], peak = 0.89) {
  let max = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) max = Math.max(max, Math.abs(c[i]));
  if (max <= 0) return;
  const g = peak / max;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g;
}

// ── Efectos ──────────────────────────────────────────────────────────────────

/** Golpe grave con transitorio: para el primer fotograma (el gancho). */
export function sfxImpact(seed = 7): Float32Array {
  const r = rng(seed);
  const n = Math.round(SR * 1.1);
  const out = new Float32Array(n);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(900);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 34 + 58 * Math.exp(-t * 9);
    phase += (TAU * f) / SR;
    const sub = Math.sin(phase) * Math.exp(-t * 3.2);
    lp += a * (r() * 2 - 1 - lp);
    const noise = lp * Math.exp(-t * 28) * 0.9;
    const click = t < 0.004 ? (1 - t / 0.004) * 0.6 : 0;
    out[i] = Math.tanh((sub * 0.95 + noise + click) * 1.4);
  }
  normalizePeak([out]);
  return out;
}

/** Whoosh: ruido filtrado que sube y baja, para los cambios de plano. */
export function sfxWhoosh(seed = 11, seconds = 0.7): Float32Array {
  const r = rng(seed);
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const shape = Math.sin(Math.PI * Math.pow(p, 0.8));
    const fc = 250 + 3800 * Math.pow(shape, 1.6);
    const a = lpCoef(fc);
    lp1 += a * (r() * 2 - 1 - lp1);
    lp2 += a * (lp1 - lp2);
    const hp = lp1 - lp2 * 0.6;
    out[i] = hp * shape * shape;
  }
  normalizePeak([out]);
  return out;
}

// ── Música ───────────────────────────────────────────────────────────────────

/** La m – Fa – Do – Sol (notas MIDI de cada acorde y su bajo). */
const PROGRESSION = [
  { notes: [57, 60, 64], bass: 45 },
  { notes: [53, 57, 60], bass: 41 },
  { notes: [55, 60, 64], bass: 48 },
  { notes: [55, 59, 62], bass: 43 },
];

export type GeneratedMusic = 'pad' | 'pulso';

/** Duración exacta de un ciclo de 4 acordes (para repetir sin saltos). */
export function musicCycleSeconds(kind: GeneratedMusic): number {
  return kind === 'pad' ? (60 / 80) * 8 * 4 : (60 / 110) * 4 * 4;
}

/** Oscilador suave (pocos armónicos, sin aliasing). */
const soft = (ph: number) => Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph) + 0.05 * Math.sin(4 * ph);

export function generateMusic(kind: GeneratedMusic, minSeconds: number, seed = 3): { left: Float32Array; right: Float32Array; seconds: number } {
  const cycle = musicCycleSeconds(kind);
  const cycles = Math.max(1, Math.ceil(Math.min(Math.max(minSeconds, cycle), 120) / cycle));
  const seconds = cycle * cycles;
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(seed);
  const bpm = kind === 'pad' ? 80 : 110;
  const beat = 60 / bpm;
  const chordLen = kind === 'pad' ? beat * 8 : beat * 4;

  // Acordes (pad): voces desafinadas a izquierda y derecha, ataque lento y filtro cálido
  const padLp = [0, 0];
  const aPad = lpCoef(kind === 'pad' ? 1400 : 1900);
  const phases: number[][] = PROGRESSION.map((c) => c.notes.map(() => 0));
  const phasesR: number[][] = PROGRESSION.map((c) => c.notes.map(() => 0));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ci = Math.floor(t / chordLen) % PROGRESSION.length;
    const tc = t % chordLen;
    // Fundido entre acordes: 0,6 s de entrada, 0,6 s de salida
    const env = Math.min(1, tc / 0.6) * Math.min(1, (chordLen - tc) / 0.6);
    let l = 0;
    let rr = 0;
    PROGRESSION[ci].notes.forEach((m, k) => {
      const f = midi(m);
      phases[ci][k] = (phases[ci][k] + (TAU * f * 0.9985) / SR) % TAU;
      phasesR[ci][k] = (phasesR[ci][k] + (TAU * f * 1.0015) / SR) % TAU;
      l += soft(phases[ci][k]);
      rr += soft(phasesR[ci][k]);
    });
    padLp[0] += aPad * (l - padLp[0]);
    padLp[1] += aPad * (rr - padLp[1]);
    const lvl = kind === 'pad' ? 0.16 : 0.09;
    L[i] += padLp[0] * env * lvl;
    R[i] += padLp[1] * env * lvl;
  }

  // Bajo
  let bph = 0;
  const bassStep = kind === 'pad' ? beat * 2 : beat / 2;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ci = Math.floor(t / chordLen) % PROGRESSION.length;
    const tn = t % bassStep;
    const f = midi(PROGRESSION[ci].bass);
    bph = (bph + (TAU * f) / SR) % TAU;
    const env = kind === 'pad' ? Math.exp(-tn * 1.2) * Math.min(1, tn / 0.02) : Math.exp(-tn * 7) * Math.min(1, tn / 0.005);
    const v = (kind === 'pad' ? Math.sin(bph) : Math.tanh(soft(bph) * 1.6)) * env * (kind === 'pad' ? 0.22 : 0.2);
    L[i] += v;
    R[i] += v;
  }

  // Batería
  const addHit = (start: number, len: number, fn: (t: number) => number, pan = 0) => {
    const i0 = Math.round(start * SR);
    const m = Math.round(len * SR);
    for (let j = 0; j < m && i0 + j < n; j++) {
      const v = fn(j / SR);
      L[i0 + j] += v * (1 - Math.max(0, pan));
      R[i0 + j] += v * (1 + Math.min(0, pan));
    }
  };
  const kick = (lvl: number) => {
    let ph = 0;
    return (t: number) => {
      ph += (TAU * (45 + 90 * Math.exp(-t * 30))) / SR;
      return Math.sin(ph) * Math.exp(-t * 9) * lvl;
    };
  };
  const noiseHit = (decay: number, lvl: number, hp: boolean) => {
    let lp = 0;
    return (t: number) => {
      const x = r() * 2 - 1;
      lp += lpCoef(hp ? 6000 : 2200) * (x - lp);
      return (hp ? x - lp : lp) * Math.exp(-t * decay) * lvl;
    };
  };
  const beats = Math.round(seconds / beat);
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    if (kind === 'pad') {
      if (b % 4 === 0 || b % 4 === 2) addHit(t, 0.35, kick(0.32));
      if (b % 4 === 1 || b % 4 === 3) addHit(t, 0.25, noiseHit(16, 0.07, false));
      addHit(t + beat / 2, 0.06, noiseHit(70, 0.035, true), 0.3);
    } else {
      addHit(t, 0.35, kick(0.42));
      if (b % 2 === 1) addHit(t, 0.25, noiseHit(14, 0.13, false));
      addHit(t, 0.05, noiseHit(80, 0.04, true), -0.25);
      addHit(t + beat / 2, 0.05, noiseHit(80, 0.05, true), 0.25);
    }
  }

  // Arpegio (solo pulso): semicorcheas sobre las notas del acorde, una octava arriba
  if (kind === 'pulso') {
    const step = beat / 4;
    const steps = Math.round(seconds / step);
    for (let s = 0; s < steps; s++) {
      const t = s * step;
      const ci = Math.floor(t / chordLen + 1e-9) % PROGRESSION.length;
      const notes = PROGRESSION[ci].notes;
      const f = midi(notes[s % notes.length] + 12);
      let ph = 0;
      const pan = s % 2 ? 0.35 : -0.35;
      addHit(
        t,
        step * 0.95,
        (tt) => {
          ph += (TAU * f) / SR;
          return Math.tanh(Math.sin(ph) * 2.2) * Math.exp(-tt * 14) * 0.045;
        },
        pan
      );
    }
  } else {
    // Crepitar de vinilo muy suave (lo-fi)
    for (let i = 0; i < n; i++) {
      if (r() < 0.00025) {
        const v = (r() * 2 - 1) * 0.05;
        L[i] += v;
        R[i] += v * 0.8;
      }
    }
  }

  normalizePeak([L, R]);
  return { left: L, right: R, seconds };
}
