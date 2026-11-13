import fs from 'fs/promises';
import path from 'path';
import { sttCost } from '@/config/cost-rates';
import { transcribeWithElevenLabs } from '@/lib/generation/transcribe';
import { envStatus } from './python-env';
import { transcribeLocal } from './advanced';
import { ffmpeg, probeVideo } from './media';
import { keptIntervals, subtitleWords } from './timeline';
import { snapToFrames } from './render';
import { directedProfile } from './direction';
import { normalizeProfile } from './profile-store';
import type { EditProject } from './types';

/**
 * Comprobación del audio FINAL (Fase 9, la pide p. ej. el estándar ETM): se transcribe el borrador
 * y se compara con el guion que debería sonar (las palabras conservadas). Encuentra palabras que
 * faltan (corte que se comió algo), que sobran (voz ajena, restos de una toma) y repeticiones.
 * Whisper local (gratis) si está instalado; si no, ElevenLabs Scribe (de pago, céntimos).
 */

const norm = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export function verifyCost(seconds: number) {
  return Number(sttCost(seconds).toFixed(4));
}

export async function canVerifyFree(): Promise<boolean> {
  return (await envStatus().catch(() => null))?.whisperListo ?? false;
}

/** Alineación por subsecuencia común más larga entre lo esperado y lo oído. */
function align(a: string[], b: string[]) {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Array<{ op: '=' | '-' | '+'; i?: number; j?: number }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ op: '=', i: i++, j: j++ });
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ op: '-', i: i++ });
    else ops.push({ op: '+', j: j++ });
  }
  while (i < n) ops.push({ op: '-', i: i++ });
  while (j < m) ops.push({ op: '+', j: j++ });
  return { ops, iguales: dp[0][0] };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export async function verifyFinalAudio(p: EditProject, usarElevenLabs: boolean) {
  if (!p.borrador) throw new Error('Primero hace falta un borrador.');
  const draft = path.join(/*turbopackIgnore: true*/ p.carpeta, p.borrador.archivo);
  const info = await probeVideo(draft);
  let heard: Array<{ t: string; s: number }>;
  let metodo: string;
  if (!usarElevenLabs) {
    const r = await transcribeLocal({ video: draft, workWav: path.join(/*turbopackIgnore: true*/ p.carpeta, 'verificar16k.wav'), outJson: path.join(/*turbopackIgnore: true*/ p.carpeta, 'verificar.json') });
    heard = r.palabras.map((w) => ({ t: w.t, s: w.s }));
    metodo = `Whisper local (${r.modelo})`;
  } else {
    const mp3 = path.join(/*turbopackIgnore: true*/ p.carpeta, 'verificar.mp3');
    await ffmpeg({ args: ['-y', '-hide_banner', '-i', draft, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3] });
    try {
      const r = await transcribeWithElevenLabs(mp3, { seconds: info.duracion, tool: 'video-editor', label: `Verificar audio final · ${p.titulo}` });
      heard = r.words.filter((w) => (w.type ?? 'word') === 'word' && w.text.trim()).map((w) => ({ t: w.text.trim(), s: Number(w.start) }));
      metodo = 'ElevenLabs Scribe';
    } finally {
      await fs.rm(mp3, { force: true }).catch(() => undefined);
    }
  }
  const perfil = p.direccion ? directedProfile(normalizeProfile(p.perfil), p.direccion) : normalizeProfile(p.perfil);
  const expected = subtitleWords(p.frases, snapToFrames(keptIntervals(p.frases, perfil.ritmo, p.original.duracion)));
  return { metodo, ...compareWords(expected, heard) };
}

/** Compara lo que debería sonar con lo que se oye (puro: se prueba sin transcribir). */
export function compareWords(expected: Array<{ t: string }>, heard: Array<{ t: string; s: number }>) {
  const A = expected.map((w) => norm(w.t)).filter(Boolean);
  const B = heard.map((w) => norm(w.t));
  const { ops, iguales } = align(A, B);
  // Agrupa diferencias seguidas
  const faltan: string[] = [];
  const sobran: string[] = [];
  let run: { op: '-' | '+'; words: string[]; at: number } | null = null;
  const flush = () => {
    if (!run) return;
    (run.op === '-' ? faltan : sobran).push(`${fmt(run.at)} «${run.words.join(' ')}»`);
    run = null;
  };
  let lastHeardT = 0;
  for (const o of ops) {
    if (o.op === '=') {
      lastHeardT = heard[o.j!].s;
      flush();
      continue;
    }
    const word = o.op === '-' ? expected[o.i!].t : heard[o.j!].t;
    const at = o.op === '+' ? heard[o.j!].s : lastHeardT;
    if (run && run.op === o.op) run.words.push(word);
    else {
      flush();
      run = { op: o.op, words: [word], at };
    }
  }
  flush();
  // Palabras repetidas seguidas en lo que se oye (y no en el guion)
  const repetidas: string[] = [];
  for (let k = 1; k < B.length; k++) if (B[k] && B[k] === B[k - 1] && B[k].length > 2) repetidas.push(`${fmt(heard[k].s)} «${heard[k].t}»`);
  const parecido = A.length ? Math.round((iguales / Math.max(A.length, B.length)) * 100) : 0;
  return {
    palabrasEsperadas: A.length,
    palabrasOidas: B.length,
    coincidencia: `${parecido} %`,
    faltan: faltan.slice(0, 30),
    sobran: sobran.slice(0, 30),
    repetidas: repetidas.slice(0, 20),
    nota: 'Los tiempos son del BORRADOR. Una diferencia suelta puede ser un error de la transcripción (nombres propios, palabras en inglés): escúchala antes de cortar. Con avance al inicio (arranque) las palabras del avance salen como «sobran».',
  };
}
