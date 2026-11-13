import path from 'path';
import { ffmpeg } from './media';
import { SR, TAU, lpCoef, rng } from './synth';
import { decodeMono } from './sfx';
import type { SubWord } from './timeline';

/**
 * Sonido de la voz y de fondo (Fase 2 · sonido):
 *  - Efectos de voz por tramo (eco, teléfono, megáfono, radio, pensamiento, grave, agudo, sala).
 *  - Mejora de la voz: presencia y de-esser (sibilantes) sobre la limpieza que ya hace el render.
 *  - Respiraciones y chasquidos: se atenúan los huecos entre palabras (sin cortar nada).
 *  - Ambientes de fondo por tramos (lluvia, viento, oficina, ciudad, naturaleza, tensión, sala),
 *    sintetizados por la app o un archivo (biblioteca compartida o carpeta de la edición).
 * Todo con FFmpeg y síntesis propia; tiempos del video (línea principal).
 */

export const VOICE_FX = ['eco', 'telefono', 'megafono', 'radio', 'pensamiento', 'grave', 'agudo', 'sala'] as const;
export type VoiceFx = (typeof VOICE_FX)[number];

export const VOICE_FX_INFO: Record<VoiceFx, { filtro: string; uso: string }> = {
  eco: { filtro: 'aecho=0.8:0.7:140|280:0.35|0.18', uso: 'Frase que «resuena»: remate, lema, pregunta al aire.' },
  telefono: { filtro: 'highpass=f=450,highpass=f=450,lowpass=f=3200,lowpass=f=3200,acompressor=threshold=0.1:ratio=6:attack=5:release=60,volume=2.2', uso: 'Cita de otra persona, llamada, «me dijo…», mensaje de un cliente.' },
  megafono: { filtro: 'highpass=f=700,highpass=f=700,lowpass=f=4200,acrusher=bits=8:mode=log:aa=1:mix=0.35,volume=1.8', uso: 'Anuncio, grito, alerta, oferta.' },
  radio: { filtro: 'highpass=f=300,lowpass=f=5200,acompressor=threshold=0.15:ratio=4,volume=1.6', uso: 'Narración de época, «noticia», flashback.' },
  pensamiento: { filtro: 'aecho=0.8:0.6:45|80|120:0.35|0.25|0.15,lowpass=f=6500,volume=0.95', uso: 'Voz interior, duda, «pensé…».' },
  grave: { filtro: 'asetrate=48000*0.84,aresample=48000,atempo=1.1905', uso: 'Voz dramática o de villano para un remate (mismo ritmo, tono más bajo).' },
  agudo: { filtro: 'asetrate=48000*1.18,aresample=48000,atempo=0.8475', uso: 'Humor: voz «ardilla» de una frase.' },
  sala: { filtro: 'aecho=0.8:0.85:30|55|90:0.3|0.22|0.15', uso: 'Como en una sala grande o escenario.' },
};

export interface VoicePlan {
  /** Presencia (+2,5 dB a 3,5 kHz) y de-esser. */
  mejorar: boolean;
  /** Atenúa respiraciones y chasquidos entre palabras (los huecos, no las palabras). */
  respiraciones: boolean;
  efectos: Array<{ desde: number; hasta: number; efecto: VoiceFx }>;
}

const f3 = (n: number) => n.toFixed(3);
const STEREO = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/** Huecos entre palabras (≥ 0,14 s) donde suelen estar las respiraciones y los chasquidos de boca. */
export function breathGaps(words: SubWord[], D: number): Array<[number, number]> {
  const ws = [...words].sort((a, b) => a.s - b.s);
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < ws.length; i++) {
    const a = ws[i - 1].e + 0.05;
    const b = ws[i].s - 0.04;
    if (b - a >= 0.14) gaps.push([a, b]);
  }
  if (ws.length && ws[0].s - 0.04 > 0.2) gaps.unshift([0, ws[0].s - 0.04]);
  if (ws.length && D - ws[ws.length - 1].e > 0.25) gaps.push([ws[ws.length - 1].e + 0.05, D]);
  return gaps;
}

/**
 * Procesa la voz según el plan. Devuelve un WAV nuevo (o el mismo si no hay nada que hacer).
 * `voz` y el resultado tienen la misma duración.
 */
export async function processVoice(o: { carpeta: string; voz: string; D: number; plan: VoicePlan; words: SubWord[] }): Promise<{ file: string; notas: string[] }> {
  const { carpeta, voz, D, plan, words } = o;
  const efectos = plan.efectos.filter((e) => e.hasta > e.desde + 0.05 && e.desde < D);
  if (!plan.mejorar && !plan.respiraciones && !efectos.length) return { file: voz, notas: [] };
  const notas: string[] = [];
  const g: string[] = [];
  let base = `[0:a]${STEREO}`;
  if (plan.mejorar) {
    base += ',equalizer=f=180:t=q:w=1.2:g=-1.5,equalizer=f=3500:t=q:w=1:g=2.5,deesser=i=0.45:m=0.5:f=0.5';
    notas.push('Voz mejorada (presencia y de-esser).');
  }
  if (plan.respiraciones) {
    const gaps = breathGaps(words, D);
    if (gaps.length) {
      // −12 dB en cada hueco con rampas de 30 ms (nunca silencio total: se notaría el corte de sala)
      const expr = gaps.map(([a, b]) => `-0.75*clip(min((t-${f3(a)})/0.03,(${f3(b)}-t)/0.03),0,1)`).join('');
      base += `,asetnsamples=n=480,volume='1${expr}':eval=frame`;
      notas.push(`Respiraciones y chasquidos atenuados en ${gaps.length} huecos.`);
    }
  }
  if (!efectos.length) {
    g.push(`${base}[out]`);
  } else {
    // La voz seca suena fuera de los tramos; cada efecto suena solo en el suyo (rampas de 40 ms)
    const n = efectos.length;
    g.push(`${base},asplit=${n + 1}[dry]${efectos.map((_, i) => `[w${i}]`).join('')}`);
    const gate = (a: number, b: number) => `clip(min((t-${f3(a)})/0.04,(${f3(b)}-t)/0.04),0,1)`;
    g.push(`[dry]asetnsamples=n=480,volume='1${efectos.map((e) => `-${gate(e.desde, e.hasta)}`).join('')}':eval=frame[d]`);
    efectos.forEach((e, i) => {
      // Las colas del eco siguen un poco tras el tramo (0,6 s) para que no se corten en seco
      const tail = ['eco', 'pensamiento', 'sala'].includes(e.efecto) ? 0.6 : 0;
      const gt = tail ? `clip(min((t-${f3(e.desde)})/0.04,(${f3(e.hasta + tail)}-t)/${tail}),0,1)` : gate(e.desde, e.hasta);
      // Al efecto solo le llega la voz de su tramo (si no, el eco repetiría lo anterior)
      g.push(`[w${i}]asetnsamples=n=480,volume='${gate(e.desde, e.hasta)}':eval=frame,${VOICE_FX_INFO[e.efecto].filtro},${STEREO},volume='${gt}':eval=frame,apad,atrim=0:${f3(D)}[e${i}]`);
    });
    g.push(`[d]${efectos.map((_, i) => `[e${i}]`).join('')}amix=inputs=${n + 1}:duration=first:dropout_transition=0,volume=${n + 1}[out]`);
    notas.push(`Efectos de voz: ${efectos.map((e) => `${e.efecto} ${e.desde.toFixed(1)}–${e.hasta.toFixed(1)} s`).join(', ')}.`);
  }
  const out = path.join(/*turbopackIgnore: true*/ carpeta, 'voz-procesada.wav');
  await ffmpeg({
    cwd: carpeta,
    args: ['-y', '-hide_banner', '-i', voz, '-filter_complex', g.join(';'), '-map', '[out]', '-t', f3(D), '-c:a', 'pcm_s16le', '-ar', '48000', out],
    timeoutMs: 10 * 60 * 1000,
  });
  return { file: out, notas };
}

// ── Ambientes ────────────────────────────────────────────────────────────────

export const AMBIENT_TYPES = ['lluvia', 'viento', 'oficina', 'ciudad', 'naturaleza', 'tension', 'sala'] as const;
export type AmbientType = (typeof AMBIENT_TYPES)[number];

export const AMBIENT_INFO: Record<AmbientType, string> = {
  lluvia: 'Lluvia constante con gotas: calma, nostalgia, «día de trabajo en casa».',
  viento: 'Viento que sube y baja: soledad, exterior, antes de un giro.',
  oficina: 'Rumor de sala con teclado lejano: trabajo, productividad, negocio.',
  ciudad: 'Tráfico lejano y rumor urbano: calle, emprendimiento, ritmo de vida.',
  naturaleza: 'Brisa y pájaros: bienestar, mañana, producto natural.',
  tension: 'Zumbido grave que late: misterio, revelación, «nadie te cuenta esto».',
  sala: 'Tono de sala casi inaudible: da cuerpo a un silencio sin que suene vacío.',
};

/** Ambiente sintetizado (estéreo, determinista), con RMS ≈ 1 antes de escalar. */
export function ambientSamples(tipo: AmbientType, seconds: number, seed = 7): { left: Float32Array; right: Float32Array } {
  const n = Math.max(1, Math.round(seconds * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(seed);
  const white = () => r() * 2 - 1;
  // Ruido rosa (Paul Kellet, versión corta) y marrón por canal
  const pink = () => {
    let b0 = 0, b1 = 0, b2 = 0;
    return () => {
      const w = white();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      return (b0 + b1 + b2 + w * 0.1848) * 0.2;
    };
  };
  const brown = () => {
    let y = 0;
    return () => (y = Math.max(-1, Math.min(1, y * 0.996 + white() * 0.04)));
  };
  const pL = pink();
  const pR = pink();
  const bL = brown();
  const bR = brown();
  let lpL = 0, lpR = 0, lp2L = 0, lp2R = 0;
  const add = (start: number, len: number, fn: (t: number) => number, pan: number) => {
    const i0 = Math.round(start * SR);
    const m = Math.round(len * SR);
    for (let j = 0; j < m && i0 + j < n; j++) {
      const v = fn(j / SR);
      L[i0 + j] += v * (1 - Math.max(0, pan));
      R[i0 + j] += v * (1 + Math.min(0, pan));
    }
  };
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (tipo === 'lluvia') {
      const a = lpCoef(5000);
      lpL += a * (white() - lpL);
      lpR += a * (white() - lpR);
      L[i] = lpL * 0.6 + pL() * 0.25;
      R[i] = lpR * 0.6 + pR() * 0.25;
    } else if (tipo === 'viento') {
      const sweep = 0.5 + 0.5 * Math.sin(TAU * 0.09 * t) * Math.sin(TAU * 0.023 * t + 1);
      const a = lpCoef(250 + 900 * sweep);
      lpL += a * (pL() - lpL);
      lpR += a * (pR() - lpR);
      L[i] = lpL * (0.6 + 0.8 * sweep);
      R[i] = lpR * (0.6 + 0.8 * (1 - sweep * 0.5));
    } else if (tipo === 'oficina' || tipo === 'sala') {
      const a = lpCoef(tipo === 'sala' ? 1200 : 2200);
      lpL += a * (pL() - lpL);
      lpR += a * (pR() - lpR);
      L[i] = lpL + bL() * 0.15;
      R[i] = lpR + bR() * 0.15;
    } else if (tipo === 'ciudad') {
      const a = lpCoef(600);
      lpL += a * (bL() - lpL);
      lpR += a * (bR() - lpR);
      const b = lpCoef(3000);
      lp2L += b * (pL() - lp2L);
      lp2R += b * (pR() - lp2R);
      L[i] = lpL * 1.2 + lp2L * 0.25;
      R[i] = lpR * 1.2 + lp2R * 0.25;
    } else if (tipo === 'naturaleza') {
      const sweep = 0.5 + 0.5 * Math.sin(TAU * 0.07 * t);
      const a = lpCoef(500 + 600 * sweep);
      lpL += a * (pL() - lpL);
      lpR += a * (pR() - lpR);
      L[i] = lpL * 0.7;
      R[i] = lpR * 0.7;
    } else {
      // tensión: dos senos graves que baten + un poco de ruido grave
      const v = Math.sin(TAU * 55 * t) * 0.5 + Math.sin(TAU * 55.7 * t) * 0.5 + Math.sin(TAU * 82.5 * t) * 0.15 * (0.5 + 0.5 * Math.sin(TAU * 0.25 * t));
      const a = lpCoef(300);
      lpL += a * (bL() - lpL);
      L[i] = v * 0.8 + lpL * 0.4;
      R[i] = v * 0.8 + lpL * 0.4;
    }
  }
  // Eventos: gotas, teclas, coches, pájaros
  if (tipo === 'lluvia') {
    for (let t = 0; t < seconds; t += 0.01 + r() * 0.05) {
      const f = 2500 + r() * 4000;
      const amp = 0.1 + r() * 0.35;
      add(t, 0.02, (x) => Math.sin(TAU * f * x) * Math.exp(-x * 300) * amp, r() * 2 - 1);
    }
  } else if (tipo === 'oficina') {
    for (let t = 0.3; t < seconds; ) {
      const burst = 3 + Math.floor(r() * 12);
      const pan = r() * 1.2 - 0.6;
      for (let k = 0; k < burst && t < seconds; k++, t += 0.08 + r() * 0.12) {
        const f = 1800 + r() * 1500;
        add(t, 0.03, (x) => (Math.sin(TAU * f * x) + white() * 0.6) * Math.exp(-x * 220) * 0.18, pan);
      }
      t += 1 + r() * 3;
    }
  } else if (tipo === 'ciudad') {
    for (let t = r() * 3; t < seconds; t += 3 + r() * 6) {
      const len = 2.5 + r() * 2;
      const dir = r() < 0.5 ? -1 : 1;
      let y = 0;
      add(t, len, (x) => {
        y += lpCoef(400) * (white() - y);
        const env = Math.sin((Math.PI * x) / len) ** 2;
        return y * env * 2.2;
      }, dir * 0.6);
    }
  } else if (tipo === 'naturaleza') {
    for (let t = 0.5 + r(); t < seconds; t += 0.8 + r() * 2.5) {
      const f0 = 2800 + r() * 2200;
      const notes = 2 + Math.floor(r() * 4);
      const pan = r() * 1.6 - 0.8;
      for (let k = 0; k < notes; k++) {
        const start = t + k * (0.09 + r() * 0.05);
        add(start, 0.08, (x) => Math.sin(TAU * (f0 + 1200 * Math.sin(TAU * 18 * x)) * x) * Math.sin((Math.PI * x) / 0.08) * 0.22, pan);
      }
    }
  }
  // Normaliza a RMS 1 (para escalar luego con precisión respecto a la voz)
  let sum = 0;
  for (let i = 0; i < n; i++) sum += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(sum / (2 * n)) || 1;
  for (let i = 0; i < n; i++) {
    L[i] /= rms;
    R[i] /= rms;
  }
  return { left: L, right: R };
}

export interface AmbientPlacement {
  desde: number;
  hasta: number;
  tipo: AmbientType | 'archivo';
  abs?: string;
  /** dB por debajo de la voz. */
  bajoVozDb: number;
}

/**
 * Una pista estéreo con todos los ambientes, cada uno a su nivel (RMS = voz − bajoVozDb) y con
 * fundidos de 0,5 s. `vozLufs` es el volumen medido de la voz.
 */
export async function buildAmbientTrack(D: number, items: AmbientPlacement[], vozLufs: number, seed = 7): Promise<{ left: Float32Array; right: Float32Array; usados: number }> {
  const n = Math.max(1, Math.round(D * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let usados = 0;
  for (const [k, a] of items.entries()) {
    const len = Math.min(D, a.hasta) - Math.max(0, a.desde);
    if (len <= 0.2) continue;
    let src: { left: Float32Array; right: Float32Array };
    if (a.tipo === 'archivo') {
      if (!a.abs) continue;
      const mono = await decodeMono(a.abs, Math.min(600, len + 1)).catch(() => new Float32Array(0));
      if (!mono.length) continue;
      let sum = 0;
      for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
      const rms = Math.sqrt(sum / mono.length) || 1;
      const m = Math.round(len * SR);
      const out = new Float32Array(m);
      for (let i = 0; i < m; i++) out[i] = mono[i % mono.length] / rms;
      src = { left: out, right: out };
    } else src = ambientSamples(a.tipo, len, seed + k * 13);
    const gain = Math.pow(10, (vozLufs - a.bajoVozDb) / 20);
    const i0 = Math.round(Math.max(0, a.desde) * SR);
    const m = src.left.length;
    const fade = Math.min(Math.round(0.5 * SR), Math.floor(m / 3));
    for (let j = 0; j < m && i0 + j < n; j++) {
      const env = Math.min(1, j / fade, (m - 1 - j) / fade);
      L[i0 + j] += src.left[j] * gain * env;
      R[i0 + j] += src.right[j] * gain * env;
    }
    usados++;
  }
  return { left: L, right: R, usados };
}

/**
 * Corrige palabras mal dichas: silencia la voz original en cada tramo (con rampas de 20 ms) y pone
 * encima el audio generado con la voz clonada, ajustado al hueco (atempo 0,75–1,35×).
 */
export async function applyCorrections(carpeta: string, voz: string, D: number, list: Array<{ desde: number; hasta: number; abs: string }>): Promise<string> {
  const { probeMedia } = await import('@/lib/video/ffmpeg');
  const { measureLoudness } = await import('./audio');
  const vozLufs = (await measureLoudness(voz).catch(() => ({ lufs: -20 }))).lufs;
  const g: string[] = [];
  const args: string[] = ['-y', '-hide_banner', '-i', voz];
  const gate = (a: number, b: number) => `clip(min((t-${f3(a)})/0.02,(${f3(b)}-t)/0.02),0,1)`;
  g.push(`[0:a]${STEREO},asetnsamples=n=480,volume='1${list.map((c) => `-${gate(c.desde, c.hasta)}`).join('')}':eval=frame[dry]`);
  const mix = ['[dry]'];
  for (const [i, c] of list.entries()) {
    const len = Math.max(0.1, c.hasta - c.desde);
    const dur = (await probeMedia(c.abs).catch(() => ({ duration: null }))).duration ?? len;
    const tempo = Math.max(0.75, Math.min(1.35, dur / len));
    // Mismo volumen que la voz original
    const gain = Math.max(-20, Math.min(20, vozLufs - (await measureLoudness(c.abs).catch(() => ({ lufs: vozLufs }))).lufs));
    args.push('-i', c.abs);
    const ms = Math.round(c.desde * 1000);
    g.push(`[${i + 1}:a]${STEREO},atempo=${tempo.toFixed(4)},volume=${gain.toFixed(2)}dB,afade=t=in:d=0.02,adelay=${ms}|${ms},apad,atrim=0:${f3(D)}[c${i}]`);
    mix.push(`[c${i}]`);
  }
  g.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0,volume=${mix.length}[out]`);
  const out = path.join(/*turbopackIgnore: true*/ carpeta, 'voz-corregida.wav');
  await ffmpeg({ cwd: carpeta, args: [...args, '-filter_complex', g.join(';'), '-map', '[out]', '-t', f3(D), '-c:a', 'pcm_s16le', '-ar', '48000', out], timeoutMs: 5 * 60_000 });
  return out;
}
