import type { RhythmSettings } from '@/config/editor-looks';
import type { EditPhrase, EditWord } from './types';

/**
 * Línea de tiempo de la edición (lógica pura, sin archivos: la usan el servidor y la pantalla).
 *  - agrupa palabras en frases,
 *  - calcula los tramos del original que se conservan (quitando frases cortadas y pausas largas),
 *  - traslada cada palabra a su tiempo en el video final (para los subtítulos).
 */

const SENTENCE_END = /[.?!…]["»”)]?$/;

/** Agrupa palabras en frases: corta en pausas largas, final de oración o frases muy largas. */
export function buildPhrases(words: EditWord[]): EditPhrase[] {
  const clean = words
    .filter((w) => w.t.trim() && Number.isFinite(w.s) && Number.isFinite(w.e))
    .map((w) => ({ t: w.t.trim(), s: Math.max(0, w.s), e: Math.max(w.s, w.e) }))
    .sort((a, b) => a.s - b.s);

  const phrases: EditPhrase[] = [];
  let current: EditWord[] = [];
  const flush = () => {
    if (!current.length) return;
    phrases.push({
      id: `f${phrases.length + 1}`,
      s: current[0].s,
      e: current[current.length - 1].e,
      palabras: current,
      cortar: false,
    });
    current = [];
  };

  for (const w of clean) {
    const last = current[current.length - 1];
    if (last) {
      const gap = w.s - last.e;
      const span = w.e - current[0].s;
      const endsSentence = SENTENCE_END.test(last.t) && current.length >= 3;
      if (gap >= 0.7 || endsSentence || current.length >= 14 || span > 8) flush();
    }
    current.push(w);
  }
  flush();
  return phrases;
}

/** Texto visible de una frase (el corregido si existe). */
export function phraseText(p: EditPhrase): string {
  return p.textoEditado?.trim() || p.palabras.map((w) => w.t).join(' ');
}

export interface KeptInterval {
  /** Inicio y fin en el video original (segundos). */
  s: number;
  e: number;
  /** Inicio en el video final. */
  out: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Tramos del original que entran al video, en orden.
 * Dentro de cada frase conservada, las pausas mayores que `pausaMaxSeg` se recortan.
 * Los márgenes nunca llegan a la mitad del hueco con la palabra vecina, así no se cuela
 * el inicio de una frase cortada.
 */
export function keptIntervals(
  phrases: EditPhrase[],
  ritmo: Pick<RhythmSettings, 'pausaMaxSeg' | 'margenSeg'>,
  duracion: number
): KeptInterval[] {
  const all = phrases.flatMap((p) => p.palabras).sort((a, b) => a.s - b.s);
  const index = new Map<EditWord, number>();
  all.forEach((w, i) => index.set(w, i));

  const startOf = (w: EditWord) => {
    const i = index.get(w) ?? 0;
    const prev = i > 0 ? all[i - 1] : null;
    const floor = prev ? (prev.e + w.s) / 2 : 0;
    return Math.max(0, floor, w.s - ritmo.margenSeg);
  };
  const endOf = (w: EditWord) => {
    const i = index.get(w) ?? 0;
    const next = i < all.length - 1 ? all[i + 1] : null;
    const ceil = next ? (w.e + next.s) / 2 : duracion;
    return Math.min(duracion, ceil, w.e + ritmo.margenSeg);
  };

  const raw: Array<{ s: number; e: number }> = [];
  for (const p of phrases) {
    if (p.cortar || !p.palabras.length) continue;
    const ws = [...p.palabras].sort((a, b) => a.s - b.s);
    let start = startOf(ws[0]);
    for (let i = 0; i < ws.length - 1; i++) {
      const gap = ws[i + 1].s - ws[i].e;
      if (gap > ritmo.pausaMaxSeg) {
        raw.push({ s: start, e: endOf(ws[i]) });
        start = startOf(ws[i + 1]);
      }
    }
    raw.push({ s: start, e: endOf(ws[ws.length - 1]) });
  }

  raw.sort((a, b) => a.s - b.s);
  const merged: Array<{ s: number; e: number }> = [];
  for (const iv of raw) {
    if (iv.e - iv.s < 0.05) continue;
    const last = merged[merged.length - 1];
    if (last && iv.s - last.e < 0.04) last.e = Math.max(last.e, iv.e);
    else merged.push({ ...iv });
  }

  let out = 0;
  return merged.map((iv) => {
    const k = { s: r3(iv.s), e: r3(iv.e), out: r3(out) };
    out += k.e - k.s;
    return k;
  });
}

export function totalDuration(intervals: KeptInterval[]): number {
  return r3(intervals.reduce((acc, iv) => acc + (iv.e - iv.s), 0));
}

/** Tiempo en el video final de un instante del original (o null si ese instante se cortó). */
export function mapTime(t: number, intervals: KeptInterval[]): number | null {
  for (const iv of intervals) {
    if (t >= iv.s - 1e-6 && t <= iv.e + 1e-6) return iv.out + (Math.min(Math.max(t, iv.s), iv.e) - iv.s);
  }
  return null;
}

/** Palabra de subtítulo con tiempos del video FINAL. */
export interface SubWord {
  t: string;
  s: number;
  e: number;
  /** Índice de la frase conservada (para no mezclar frases en una misma línea). */
  frase: number;
}

/** Busca el tiempo final más cercano dentro del tramo (por si el margen recortó un borde). */
export function mapClamped(t: number, intervals: KeptInterval[]): number | null {
  const direct = mapTime(t, intervals);
  if (direct !== null) return direct;
  let best: { d: number; v: number } | null = null;
  for (const iv of intervals) {
    const clamped = Math.min(Math.max(t, iv.s), iv.e);
    const d = Math.abs(clamped - t);
    if (d < 0.25 && (!best || d < best.d)) best = { d, v: iv.out + (clamped - iv.s) };
  }
  return best ? best.v : null;
}

/**
 * Palabras de los subtítulos ya trasladadas al video final.
 * Si se corrigió el texto con el mismo número de palabras, cada una conserva su tiempo;
 * si no, el tiempo de la frase se reparte según el largo de cada palabra.
 */
export function subtitleWords(phrases: EditPhrase[], intervals: KeptInterval[]): SubWord[] {
  const result: SubWord[] = [];
  let fraseIdx = 0;
  for (const p of phrases) {
    if (p.cortar || !p.palabras.length) continue;
    const mapped = p.palabras
      .map((w) => ({ w, s: mapClamped(w.s, intervals), e: mapClamped(w.e, intervals) }))
      .filter((m): m is { w: EditWord; s: number; e: number } => m.s !== null && m.e !== null);
    if (!mapped.length) continue;

    const edited = p.textoEditado?.trim();
    const tokens = edited ? edited.split(/\s+/).filter(Boolean) : null;

    if (!tokens || tokens.length === mapped.length) {
      mapped.forEach((m, i) =>
        result.push({ t: tokens ? tokens[i] : m.w.t, s: r3(m.s), e: r3(Math.max(m.e, m.s + 0.05)), frase: fraseIdx })
      );
    } else if (tokens.length) {
      const start = mapped[0].s;
      const end = Math.max(mapped[mapped.length - 1].e, start + 0.2 * tokens.length);
      const weights = tokens.map((t) => Math.max(2, t.length));
      const total = weights.reduce((a, b) => a + b, 0);
      let acc = start;
      tokens.forEach((t, i) => {
        const len = ((end - start) * weights[i]) / total;
        result.push({ t, s: r3(acc), e: r3(acc + len), frase: fraseIdx });
        acc += len;
      });
    }
    fraseIdx++;
  }
  return result;
}

/** Agrupa las palabras en líneas de subtítulo de hasta `max` palabras. */
export function chunkWords(words: SubWord[], max: number): SubWord[][] {
  const chunks: SubWord[][] = [];
  let cur: SubWord[] = [];
  for (const w of words) {
    const last = cur[cur.length - 1];
    const breakHere =
      !!last &&
      (cur.length >= max || last.frase !== w.frase || w.s - last.e > 0.45 || (SENTENCE_END.test(last.t) && cur.length >= 1));
    if (breakHere) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** "1:05" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
