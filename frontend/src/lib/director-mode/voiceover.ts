import { getBrollModel, pickBrollDuration } from '@/config/broll-models';
import { HEYGEN_MAX_SEG, HEYGEN_MIN_SEG } from './durations';
import type { DirectorScene, DirectorSceneType, DirectorSettings, VoiceoverPhrase } from './types';

/**
 * "Video desde mi audio" (v2, paso 2): lógica pura, sin archivos ni IA.
 * - limpiar las frases que devuelve la transcripción (Gemini aproximado o ElevenLabs por palabra);
 * - mover cada corte al silencio real más cercano (FFmpeg silencedetect);
 * - armar las escenas a partir de rangos de frases: el audio manda inicio, fin y diálogo.
 */

export const SNAP_WINDOW_SEG = 0.6;
/** Frases de unos 6 s como máximo (los modelos de video llegan a 8–15 s por clip). */
export const MAX_PHRASE_SEG = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Silence {
  start: number;
  end: number;
}

/** Lee la salida de `silencedetect` de FFmpeg. */
export function parseSilences(stderr: string): Silence[] {
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return out;
}

/**
 * Ordena, recorta al largo del audio y quita solapes. Si los tiempos no sirven (todo en 0, al revés…),
 * los reparte según el largo del texto.
 */
export function cleanPhrases(raw: Array<{ texto: string; inicio?: number; fin?: number }>, total: number): VoiceoverPhrase[] {
  const items = raw
    .map((f) => ({ texto: f.texto.replace(/\s+/g, ' ').trim(), inicio: Number(f.inicio), fin: Number(f.fin) }))
    .filter((f) => f.texto);
  if (!items.length) return [];
  const usable = items.every((f) => Number.isFinite(f.inicio) && Number.isFinite(f.fin) && f.fin > f.inicio) && items.some((f) => f.inicio > 0);
  if (!usable) {
    const chars = items.reduce((a, f) => a + f.texto.length, 0) || 1;
    let t = 0;
    return items.map((f) => {
      const len = (f.texto.length / chars) * total;
      const p = { texto: f.texto, inicio: r2(t), fin: r2(t + len) };
      t += len;
      return p;
    });
  }
  items.sort((a, b) => a.inicio - b.inicio);
  return items.map((f, i) => {
    const inicio = Math.min(Math.max(0, f.inicio), total);
    const next = items[i + 1]?.inicio ?? total;
    const fin = Math.min(Math.max(f.fin, inicio + 0.2), Math.max(next, inicio + 0.2), total);
    return { texto: f.texto, inicio: r2(inicio), fin: r2(Math.max(fin, inicio)) };
  });
}

/**
 * Lleva cada corte entre frases al silencio real más cercano (a menos de SNAP_WINDOW_SEG):
 * la frase anterior termina donde empieza el silencio y la siguiente empieza donde acaba.
 */
export function snapToSilences(frases: VoiceoverPhrase[], silences: Silence[]): { frases: VoiceoverPhrase[]; movidos: number } {
  const out = frases.map((f) => ({ ...f }));
  let movidos = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const cut = (out[i].fin + out[i + 1].inicio) / 2;
    let best: Silence | null = null;
    let bestDist = Infinity;
    for (const s of silences) {
      const dist = Math.abs((s.start + s.end) / 2 - cut);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    if (!best || bestDist > SNAP_WINDOW_SEG) continue;
    // Sin pisar el comienzo de la frase actual ni el final de la siguiente
    if (best.start <= out[i].inicio || best.end >= out[i + 1].fin) continue;
    out[i].fin = r2(best.start);
    out[i + 1].inicio = r2(best.end);
    movidos++;
  }
  return { frases: out, movidos };
}

/** Palabras con tiempos (ElevenLabs) → frases cortas: corta en punto, en pausas largas o al pasar ~6 s. */
export function wordsToPhrases(words: Array<{ text: string; start: number; end: number; type?: string }>): VoiceoverPhrase[] {
  const ws = words.filter((w) => (w.type ?? 'word') === 'word' && w.text.trim());
  const out: VoiceoverPhrase[] = [];
  let cur: typeof ws = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ texto: cur.map((w) => w.text.trim()).join(' ').replace(/\s+([,.;:!?…])/g, '$1'), inicio: r2(cur[0].start), fin: r2(cur[cur.length - 1].end) });
    cur = [];
  };
  ws.forEach((w, i) => {
    cur.push(w);
    const next = ws[i + 1];
    const len = w.end - cur[0].start;
    const gap = next ? next.start - w.end : 0;
    const endsSentence = /[.!?…]["»”']?$/.test(w.text.trim());
    const comma = /[,;:]$/.test(w.text.trim());
    if (!next || endsSentence || gap > 0.45 || len >= MAX_PHRASE_SEG || (comma && len > 3)) flush();
  });
  flush();
  return out;
}

/** Duración máxima de un clip del tipo de escena (B-roll: la mayor que admite el modelo; HeyGen: libre). */
export function maxClipSeg(tipo: DirectorSceneType, ajustes: Pick<DirectorSettings, 'modeloBroll'>): number {
  if (tipo === 'avatar') return HEYGEN_MAX_SEG;
  const d = getBrollModel(ajustes.modeloBroll).durations;
  return d[d.length - 1];
}

/** Clip a generar: la menor duración admitida que cubre la escena (se recorta al montar). */
export function clipFor(tipo: DirectorSceneType, ajustes: Pick<DirectorSettings, 'modeloBroll'>, seconds: number): number {
  if (tipo === 'avatar') return Math.min(HEYGEN_MAX_SEG, Math.max(HEYGEN_MIN_SEG, Math.ceil(seconds * 2) / 2));
  return pickBrollDuration(getBrollModel(ajustes.modeloBroll), Math.ceil(seconds - 1e-9));
}

/** Corte entre la frase i (1 = la primera) y la siguiente: a mitad de la pausa. */
function cutAfter(frases: VoiceoverPhrase[], i: number): number {
  return r2((frases[i - 1].fin + frases[i].inicio) / 2);
}

export interface AlignedRaw {
  desde: number;
  hasta: number;
  tipo: DirectorSceneType;
  queSeVe: string;
}

/**
 * Rangos de frases (de la IA) → escenas. El código garantiza que cubren todas las frases, en orden y sin huecos,
 * y parte en dos las tomas de apoyo más largas que el modelo (por frases enteras).
 */
export function buildAlignedScenes(
  frases: VoiceoverPhrase[],
  raw: AlignedRaw[],
  total: number,
  ajustes: Pick<DirectorSettings, 'modeloBroll'>,
  allowedType: (t: DirectorSceneType) => DirectorSceneType
): DirectorScene[] {
  const n = frases.length;
  if (!n) return [];
  // Comienzos válidos (la primera escena siempre empieza en la frase 1)
  const byStart = new Map<number, AlignedRaw>();
  for (const r of raw) {
    const s = Math.round(r.desde);
    if (s >= 1 && s <= n && !byStart.has(s)) byStart.set(s, r);
  }
  if (!byStart.has(1)) byStart.set(1, raw[0] ?? { desde: 1, hasta: n, tipo: 'broll', queSeVe: '' });
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  let ranges = starts.map((s, k) => {
    const r = byStart.get(s)!;
    return { desde: s, hasta: (starts[k + 1] ?? n + 1) - 1, tipo: allowedType(r.tipo), queSeVe: r.queSeVe.trim() };
  });

  const span = (a: number, b: number) => (b >= n ? total : cutAfter(frases, b)) - (a <= 1 ? 0 : cutAfter(frases, a - 1));

  // Tomas de apoyo demasiado largas para el modelo: se parten por frases
  const max = maxClipSeg('broll', ajustes);
  const split: typeof ranges = [];
  for (const r of ranges) {
    let a = r.desde;
    if (r.tipo !== 'broll') {
      split.push(r);
      continue;
    }
    while (a <= r.hasta) {
      let b = a;
      while (b < r.hasta && span(a, b + 1) <= max) b++;
      split.push({ ...r, desde: a, hasta: b, queSeVe: a === r.desde ? r.queSeVe : `${r.queSeVe} (continúa)`.trim() });
      a = b + 1;
    }
  }
  ranges = split;

  return ranges.map((r, i) => {
    const inicio = r.desde <= 1 ? 0 : cutAfter(frases, r.desde - 1);
    const fin = r.hasta >= n ? r2(total) : cutAfter(frases, r.hasta);
    const dur = r2(fin - inicio);
    return {
      id: `e${i + 1}`,
      orden: i + 1,
      tipo: r.tipo,
      duracionSeg: dur,
      inicio,
      fin,
      queSeVe: r.queSeVe,
      dialogo: frases.slice(r.desde - 1, r.hasta).map((f) => f.texto).join(' '),
      version: 1,
      prompt: null,
      audio: { desde: r.desde, hasta: r.hasta },
      clipSeg: clipFor(r.tipo, ajustes, dur),
    };
  });
}

/** Con otro modelo de video solo cambia el clip de cada escena; los tiempos los manda el audio. */
export function refitAlignedClips(escenas: DirectorScene[], ajustes: Pick<DirectorSettings, 'modeloBroll'>) {
  for (const s of escenas) if (s.audio) s.clipSeg = clipFor(s.tipo, ajustes, s.duracionSeg);
}

/** El guion está alineado a la locución. */
export function isAligned(escenas: DirectorScene[] | undefined): boolean {
  return Boolean(escenas?.length && escenas.every((s) => s.audio));
}
