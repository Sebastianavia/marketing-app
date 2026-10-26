/**
 * Con los tiempos por carácter de ElevenLabs calcula en qué segundo empieza cada escena.
 * El corte se pone a mitad de la pausa entre la última letra de una escena y la primera de la siguiente.
 */
export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export function computeSceneStarts(
  pieces: string[],
  alignment: Alignment | null,
  fallbackTotal: number
): { starts: number[]; total: number } {
  const joined = pieces.join(' ');
  const offsets: number[] = [];
  let acc = 0;
  for (const p of pieces) {
    offsets.push(acc);
    acc += p.length + 1;
  }

  if (!alignment || alignment.starts.length === 0) {
    const total = fallbackTotal;
    return { starts: offsets.map((o) => (o / Math.max(1, joined.length)) * total), total };
  }

  const n = alignment.starts.length;
  const total = (alignment.ends[n - 1] ?? alignment.starts[n - 1]) + 0.3;
  const exact = alignment.characters.join('') === joined;
  const scale = exact ? 1 : n / Math.max(1, joined.length);

  const starts = offsets.map((o, i) => {
    if (i === 0) return 0;
    const idx = Math.min(n - 1, Math.max(1, Math.round(o * scale)));
    const prevEnd = alignment.ends[Math.max(0, idx - 2)] ?? alignment.starts[idx];
    const nextStart = alignment.starts[idx];
    return Math.max(0, (prevEnd + nextStart) / 2);
  });
  // Siempre crecientes
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) starts[i] = starts[i - 1] + 0.5;
  }
  return { starts, total: Math.max(total, starts[starts.length - 1] + 1) };
}

/** Fundido que cabe: 0.5 s salvo que alguna escena sea muy corta. */
export function safeCrossfade(starts: number[], total: number, wanted = 0.5): number {
  if (starts.length < 2) return 0;
  const lens = starts.map((s, i) => (i < starts.length - 1 ? starts[i + 1] - s : total - s));
  return Math.max(0.1, Math.min(wanted, Math.min(...lens) * 0.4));
}
