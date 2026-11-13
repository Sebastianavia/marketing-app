import type { EditPhrase, EditWord } from './types';

/**
 * Corte por palabra (Fase 9): arranques repetidos y tomas repetidas, quedándose con la ÚLTIMA.
 *  - Dentro de una frase: «con el primer, con el primer prompt» → se quitan las palabras del primer
 *    intento («con el primer,»). Secuencias de 2+ palabras repetidas seguidas; de 1 sola palabra solo
 *    si es corta o va con coma («y, y», «el el»), porque «muy muy» puede ser a propósito.
 *  - Entre frases: si una frase es el comienzo de la siguiente (≤ 4 s después), la primera fue un
 *    arranque falso y se corta entera.
 * Devuelve qué cambió (para el registro y para Claude).
 */

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface RestartChange {
  frase: string;
  quitado: string;
  tipo: 'palabras' | 'frase';
  en: string;
}

/** Busca la repetición seguida más larga (A A) en las palabras; devuelve [inicio, largo] o null. */
function findRepeat(ws: EditWord[]): [number, number] | null {
  const t = ws.map((w) => norm(w.t));
  for (let k = Math.min(6, Math.floor(t.length / 2)); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= t.length; i++) {
      let same = true;
      for (let j = 0; j < k; j++) if (!t[i + j] || t[i + j] !== t[i + k + j]) same = false;
      if (!same) continue;
      if (k === 1) {
        const w = ws[i].t;
        if (t[i].length > 3 && !/[,…-]$/.test(w)) continue;
      }
      return [i, k];
    }
  }
  return null;
}

export function detectRestarts(phrases: EditPhrase[]): RestartChange[] {
  const changes: RestartChange[] = [];
  // 1. Dentro de cada frase (repite hasta que no quede ninguna)
  for (const f of phrases) {
    if (f.cortar || f.voz === 'fondo') continue;
    for (let guard = 0; guard < 6; guard++) {
      const ws = f.palabras.filter((w) => !w.cortar);
      const r = findRepeat(ws);
      if (!r) break;
      const [i, k] = r;
      const gone = ws.slice(i, i + k);
      for (const w of gone) w.cortar = true;
      changes.push({ frase: f.id, quitado: gone.map((w) => w.t).join(' '), tipo: 'palabras', en: fmt(gone[0].s) });
    }
  }
  // 2. Frase que es el comienzo de la siguiente: arranque falso
  const live = phrases.filter((f) => !f.cortar && f.voz !== 'fondo' && f.palabras.length);
  for (let i = 0; i < live.length - 1; i++) {
    const a = live[i];
    const b = live[i + 1];
    if (b.s - a.e > 4) continue;
    const ta = a.palabras.filter((w) => !w.cortar).map((w) => norm(w.t)).filter(Boolean);
    const tb = b.palabras.filter((w) => !w.cortar).map((w) => norm(w.t)).filter(Boolean);
    if (ta.length < 2 || tb.length <= ta.length) continue;
    if (ta.every((x, j) => x === tb[j])) {
      a.cortar = true;
      a.motivo = `Arranque repetido: lo vuelves a decir en ${fmt(b.s)} (queda la última toma)`;
      changes.push({ frase: a.id, quitado: a.palabras.map((w) => w.t).join(' '), tipo: 'frase', en: fmt(a.s) });
    }
  }
  return changes;
}

/**
 * Quita (o restaura) en una frase la secuencia de palabras que coincide con `texto`
 * (sin importar mayúsculas, tildes ni signos). `ocurrencia` elige cuál si aparece varias veces.
 */
export function cutWordsByText(f: EditPhrase, texto: string, cortar: boolean, ocurrencia = 1): { ok: boolean; quitado?: string; disponibles?: string } {
  const target = texto.split(/\s+/).map(norm).filter(Boolean);
  const t = f.palabras.map((w) => norm(w.t));
  let seen = 0;
  for (let i = 0; i + target.length <= t.length; i++) {
    if (target.every((x, j) => t[i + j] === x)) {
      seen++;
      if (seen < ocurrencia) continue;
      const ws = f.palabras.slice(i, i + target.length);
      for (const w of ws) w.cortar = cortar || undefined;
      return { ok: true, quitado: ws.map((w) => w.t).join(' ') };
    }
  }
  return { ok: false, disponibles: f.palabras.map((w) => `${w.t}${w.cortar ? ' (quitada)' : ''}`).join(' ') };
}
