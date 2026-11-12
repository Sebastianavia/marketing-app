import { SR, TAU, lpCoef, midi, normalizePeak, rng } from './synth';

/**
 * Música generada por la app para la edición dirigida por Claude (sin derechos de autor: es síntesis
 * propia). Varios géneros que suenan en redes y SECCIONES de energía para editar con la música:
 * «suave» (sin batería, para frases serias o el inicio), «completa» y «silencio» (el clásico corte de
 * la música justo antes del remate, y vuelve con todo: el «drop»).
 *
 * Se genera en dos capas (batería y armonía) que se mezclan con ganancias por tiempo suavizadas.
 */

export const MUSIC_STYLES = ['trap', 'house', 'phonk', 'motivacional', 'cinematico', 'lofi', 'synthpop'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];

export const MUSIC_CATALOG: Record<MusicStyle, { bpm: number; descripcion: string }> = {
  trap: { bpm: 140, descripcion: 'Trap moderno: 808 grave, hi-hats con redobles, campana oscura. Energía, actitud, negocios, "flex", consejos directos.' },
  house: { bpm: 124, descripcion: 'House/dance: bombo a negras, palmas, acordes de piano en contratiempo. Positivo, lifestyle, producto, tutorial dinámico.' },
  phonk: { bpm: 130, descripcion: 'Phonk (cencerro y 808 saturado). Muy viral en TikTok: retos, gym, autos, antes/después, humor intenso.' },
  motivacional: { bpm: 112, descripcion: 'Pop/corporativo motivacional: plucks, palmas y acordes mayores. Historias de superación, emprendimiento, educación.' },
  cinematico: { bpm: 90, descripcion: 'Cinemático épico: pads amplios, tambores graves, sin hi-hats. Storytelling, reveals, datos impactantes.' },
  lofi: { bpm: 80, descripcion: 'Lo-fi chill: acordes jazz (maj7), batería suave y crepitar de vinilo. Explicaciones tranquilas, rutinas, reflexión.' },
  synthpop: { bpm: 110, descripcion: 'Synth retro con arpegio y bajo. Tecnología, apps, IA, futuro.' },
};

export type MusicEnergy = 'silencio' | 'suave' | 'completa';
export interface MusicSection {
  desde: number;
  hasta: number;
  energia: MusicEnergy;
}

interface Chord {
  notes: number[];
  bass: number;
}

const PROG = {
  menorOscura: [
    { notes: [60, 63, 67], bass: 36 },
    { notes: [56, 60, 63], bass: 32 },
    { notes: [63, 67, 70], bass: 39 },
    { notes: [58, 62, 65], bass: 34 },
  ],
  mayor: [
    { notes: [60, 64, 67], bass: 36 },
    { notes: [55, 59, 62], bass: 31 },
    { notes: [57, 60, 64], bass: 33 },
    { notes: [53, 57, 60], bass: 29 },
  ],
  jazz: [
    { notes: [53, 57, 60, 64], bass: 41 },
    { notes: [52, 55, 59, 62], bass: 40 },
    { notes: [50, 53, 57, 60], bass: 38 },
    { notes: [48, 52, 55, 59], bass: 36 },
  ],
  menor: [
    { notes: [57, 60, 64], bass: 33 },
    { notes: [53, 57, 60], bass: 29 },
    { notes: [55, 60, 64], bass: 36 },
    { notes: [55, 59, 62], bass: 31 },
  ],
} satisfies Record<string, Chord[]>;

interface Style {
  bpm: number;
  prog: Chord[];
  /** Pasos de 16avos de cada compás (0–15). */
  kick: number[];
  snare: number[];
  clap?: number[];
  hat: number[];
  openHat?: number[];
  /** 808 / bajo: en qué pasos suena (sigue el acorde). */
  bass: number[];
  bassKind: '808' | 'synth' | 'sub' | 'pluck';
  harmony: 'pad' | 'stab' | 'pluck' | 'bell' | 'cowbell' | 'arp' | 'epiano';
  harmonySteps?: number[];
  swing?: number;
  roll?: boolean;
  toms?: number[];
  crackle?: boolean;
  /** Nivel de la armonía (0–1). */
  hLevel: number;
}

const STYLES: Record<MusicStyle, Style> = {
  trap: { bpm: 140, prog: PROG.menorOscura, kick: [0, 7, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 7, 10], bassKind: '808', harmony: 'bell', harmonySteps: [0, 3, 6, 10, 12], roll: true, hLevel: 0.5 },
  house: { bpm: 124, prog: PROG.mayor, kick: [0, 4, 8, 12], snare: [], clap: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15], openHat: [2, 6, 10, 14], bass: [2, 6, 10, 14], bassKind: 'synth', harmony: 'stab', harmonySteps: [3, 6, 11, 14], hLevel: 0.6 },
  phonk: { bpm: 130, prog: PROG.menorOscura, kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 6, 10], bassKind: '808', harmony: 'cowbell', harmonySteps: [0, 2, 3, 6, 8, 10, 11, 14], hLevel: 0.55 },
  motivacional: { bpm: 112, prog: PROG.mayor, kick: [0, 8, 10], snare: [], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14], bassKind: 'pluck', harmony: 'pluck', hLevel: 0.55 },
  cinematico: { bpm: 90, prog: PROG.menor, kick: [0], snare: [], hat: [], bass: [0], bassKind: 'sub', harmony: 'pad', toms: [0, 6, 8, 14], hLevel: 0.75 },
  lofi: { bpm: 80, prog: PROG.jazz, kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], bass: [0, 8], bassKind: 'sub', harmony: 'epiano', swing: 0.14, crackle: true, hLevel: 0.7 },
  synthpop: { bpm: 110, prog: PROG.menor, kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], bass: [0, 2, 4, 6, 8, 10, 12, 14], bassKind: 'synth', harmony: 'arp', hLevel: 0.5 },
};

const soft = (ph: number) => Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);

export function generateStyledMusic(
  style: MusicStyle,
  seconds: number,
  sections: MusicSection[] = [],
  seed = 3,
  /** false en videos en bucle: sin desvanecido final (el video vuelve a empezar). */
  fadeOut = true
): { left: Float32Array; right: Float32Array; bpm: number } {
  const st = STYLES[style];
  const D = Math.max(2, Math.min(600, seconds));
  const n = Math.round(D * SR);
  const dL = new Float32Array(n);
  const dR = new Float32Array(n);
  const hL = new Float32Array(n);
  const hR = new Float32Array(n);
  const r = rng(seed);
  const beat = 60 / st.bpm;
  const step = beat / 4;
  const bar = beat * 4;
  const chordAt = (t: number) => st.prog[Math.floor(t / bar) % st.prog.length];

  const add = (L: Float32Array, R: Float32Array, start: number, len: number, fn: (t: number) => number, pan = 0) => {
    const i0 = Math.round(start * SR);
    const m = Math.round(len * SR);
    const gl = 1 - Math.max(0, pan);
    const gr = 1 + Math.min(0, pan);
    for (let j = 0; j < m && i0 + j < n; j++) {
      if (i0 + j < 0) continue;
      const v = fn(j / SR);
      L[i0 + j] += v * gl;
      R[i0 + j] += v * gr;
    }
  };

  // ── Instrumentos ──
  const kick = (lvl: number) => {
    let ph = 0;
    return (t: number) => {
      ph += (TAU * (45 + 110 * Math.exp(-t * 35))) / SR;
      return Math.tanh(Math.sin(ph) * 1.4) * Math.exp(-t * 8) * lvl;
    };
  };
  const noise = (fc: number, decay: number, lvl: number, hp: boolean) => {
    let lp = 0;
    const a = lpCoef(fc);
    return (t: number) => {
      const x = r() * 2 - 1;
      lp += a * (x - lp);
      return (hp ? x - lp : lp) * Math.exp(-t * decay) * lvl;
    };
  };
  const snare = (lvl: number) => {
    const nz = noise(3500, 18, lvl, false);
    let ph = 0;
    return (t: number) => {
      ph += (TAU * 190) / SR;
      return nz(t) + Math.sin(ph) * Math.exp(-t * 30) * lvl * 0.6;
    };
  };
  const clap = (lvl: number) => {
    const nz = noise(2600, 22, lvl, false);
    return (t: number) => nz(t) * (t < 0.03 ? 0.6 + 0.4 * Math.sin(t * 900) : 1);
  };
  const bassVoice = (note: number, kind: Style['bassKind'], len: number, nextNote?: number) => {
    let ph = 0;
    const f0 = midi(note);
    const f1 = nextNote !== undefined ? midi(nextNote) : f0;
    return (t: number) => {
      const glide = kind === '808' && t > len * 0.75 ? Math.pow(f1 / f0, Math.min(1, (t - len * 0.75) / (len * 0.25))) : 1;
      ph += (TAU * f0 * glide) / SR;
      if (kind === '808') return Math.tanh(Math.sin(ph) * (style === 'phonk' ? 3.2 : 1.6)) * Math.exp(-t * 1.6) * Math.min(1, t / 0.004) * 0.55;
      if (kind === 'synth') return Math.tanh(soft(ph) * 1.5) * Math.exp(-t * 6) * Math.min(1, t / 0.004) * 0.3;
      if (kind === 'pluck') return soft(ph) * Math.exp(-t * 9) * 0.25;
      return Math.sin(ph) * Math.min(1, t / 0.05) * Math.exp(-t * 0.7) * 0.4;
    };
  };

  const bars = Math.ceil(D / bar);
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const ch = chordAt(t0);
    const nextCh = chordAt(t0 + bar);
    const sw = (s: number) => (st.swing && s % 2 === 1 ? st.swing * step : 0);

    // Batería
    for (const s of st.kick) add(dL, dR, t0 + s * step + sw(s), 0.4, kick(0.55));
    for (const s of st.snare) add(dL, dR, t0 + s * step + sw(s), 0.3, snare(style === 'lofi' ? 0.12 : 0.22), 0.05);
    for (const s of st.clap ?? []) add(dL, dR, t0 + s * step, 0.3, clap(0.25), -0.05);
    for (const s of st.hat) add(dL, dR, t0 + s * step + sw(s), 0.06, noise(7000, 70, style === 'lofi' ? 0.035 : 0.06, true), 0.25);
    for (const s of st.openHat ?? []) add(dL, dR, t0 + s * step, 0.2, noise(7500, 14, 0.05, true), -0.25);
    if (st.roll && b % 2 === 1) for (let k = 0; k < 6; k++) add(dL, dR, t0 + 12 * step + (k * step * 4) / 6, 0.04, noise(8000, 90, 0.05, true), 0.3);
    for (const s of st.toms ?? []) {
      let ph = 0;
      add(dL, dR, t0 + s * step, 0.8, (t) => {
        ph += (TAU * (70 + 40 * Math.exp(-t * 12))) / SR;
        return Math.sin(ph) * Math.exp(-t * 4) * 0.45;
      });
    }
    // 808 / bajo (va con la batería: en las secciones suaves desaparece)
    st.bass.forEach((s, k) => {
      const nextS = st.bass[k + 1] ?? 16;
      const len = (nextS - s) * step;
      const note = ch.bass + (st.bassKind === 'pluck' || st.bassKind === 'synth' ? 12 : 0);
      add(dL, dR, t0 + s * step + sw(s), len, bassVoice(note, st.bassKind, len, k === st.bass.length - 1 ? nextCh.bass : undefined));
    });

    // Armonía
    const H = st.hLevel;
    if (st.harmony === 'pad' || st.harmony === 'epiano') {
      ch.notes.forEach((m, k) => {
        const f = midi(m);
        let pl = 0;
        let pr = 0;
        let lp = 0;
        const a = lpCoef(st.harmony === 'pad' ? 1200 : 2400);
        add(hL, hR, t0, bar, (t) => {
          pl += (TAU * f * 0.998) / SR;
          pr += (TAU * f * 1.002) / SR;
          const raw = st.harmony === 'pad' ? soft(pl) + soft(pr) : (Math.sin(pl) + 0.3 * Math.sin(3 * pl)) * Math.exp(-t * 1.2) * 2;
          lp += a * (raw - lp);
          const e = st.harmony === 'pad' ? Math.min(1, t / 0.5) * Math.min(1, (bar - t) / 0.4) : Math.min(1, t / 0.01);
          return lp * e * 0.08 * H;
        }, k % 2 ? 0.2 : -0.2);
      });
    } else {
      const steps = st.harmonySteps ?? Array.from({ length: 16 }, (_, i) => i);
      steps.forEach((s, k) => {
        const notes = st.harmony === 'stab' ? ch.notes.map((m) => m + 12) : [ch.notes[k % ch.notes.length] + (st.harmony === 'cowbell' ? 24 : 12)];
        for (const m of notes) {
          const f = midi(m);
          let ph = 0;
          let ph2 = 0;
          const len = st.harmony === 'bell' ? 0.9 : st.harmony === 'stab' ? 0.25 : 0.3;
          add(hL, hR, t0 + s * step, len, (t) => {
            ph += (TAU * f) / SR;
            ph2 += (TAU * f * (st.harmony === 'bell' ? 2.76 : st.harmony === 'cowbell' ? 1.48 : 2)) / SR;
            let v: number;
            if (st.harmony === 'bell') v = (Math.sin(ph) + 0.5 * Math.sin(ph2)) * Math.exp(-t * 4);
            else if (st.harmony === 'cowbell') v = Math.tanh((Math.sign(Math.sin(ph)) + Math.sign(Math.sin(ph2))) * 0.6) * Math.exp(-t * 14);
            else if (st.harmony === 'stab') v = soft(ph) * Math.exp(-t * 10);
            else v = Math.tanh(Math.sin(ph) * 2) * Math.exp(-t * 12);
            return v * 0.12 * H;
          }, (k % 2 ? 0.3 : -0.3));
        }
      });
      // Colchón suave debajo (para que las secciones «suaves» no queden vacías)
      ch.notes.forEach((m) => {
        const f = midi(m - 12);
        let ph = 0;
        add(hL, hR, t0, bar, (t) => {
          ph += (TAU * f) / SR;
          return Math.sin(ph) * Math.min(1, t / 0.3) * Math.min(1, (bar - t) / 0.3) * 0.035 * H;
        });
      });
    }
  }

  if (st.crackle) {
    for (let i = 0; i < n; i++) {
      if (r() < 0.0003) {
        const v = (r() * 2 - 1) * 0.04;
        hL[i] += v;
        hR[i] += v * 0.8;
      }
    }
  }

  // Secciones: ganancia de batería y de armonía por instante, suavizadas (~40 ms)
  const energyAt = (t: number): MusicEnergy => sections.find((s) => t >= s.desde && t < s.hasta)?.energia ?? 'completa';
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let gd = 0;
  let gh = 0;
  const k = 1 - Math.exp(-1 / (0.04 * SR));
  for (let i = 0; i < n; i++) {
    const e = sections.length ? energyAt(i / SR) : 'completa';
    const td = e === 'completa' ? 1 : 0;
    const th = e === 'silencio' ? 0 : 1;
    gd += k * (td - gd);
    gh += k * (th - gh);
    L[i] = dL[i] * gd + hL[i] * gh;
    R[i] = dR[i] * gd + hR[i] * gh;
  }
  // Fundido de salida de 1,2 s
  const fo = Math.round((fadeOut ? 1.2 : 0.02) * SR);
  for (let i = Math.max(0, n - fo); i < n; i++) {
    const g = (n - i) / fo;
    L[i] *= g;
    R[i] *= g;
  }
  normalizePeak([L, R]);
  return { left: L, right: R, bpm: st.bpm };
}
