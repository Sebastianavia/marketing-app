import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { z } from 'zod';
import { orchestrateObject } from '@/lib/ai/orchestrator';
import { resolveFfmpegPath } from '@/lib/video/ffmpeg';
import { errorMessage } from '@/lib/errors';
import { computeEnvelope } from './cuts';
import {
  AUDIO_KINDS,
  LibraryError,
  ensureLocal,
  kindFromFolders,
  loadLibrary,
  mergeTags,
  updateLibrary,
  type AudioKind,
  type LibraryItem,
} from './audio-library';

/**
 * Organizar la biblioteca de audio.
 *
 *  1. `tidyLibrary` (gratis, al instante): etiquetas sin repetir la misma con o sin tilde ni las
 *     genéricas, y tipo según la carpeta del bucket. Arregla lo importado con versiones anteriores.
 *  2. `startOrganize`: Claude (o el modo IA elegido) propone nombre, tipo, etiquetas y una nota de
 *     uso para cada audio. No oye: decide por el nombre original, la carpeta, la duración, el BPM y
 *     medidas del sonido (volumen, dónde está el golpe, si es grave o agudo). Las propuestas NO se
 *     guardan: la persona las revisa en una tabla y aplica las que quiera (`applyOrganization`).
 */

// ── 1. Ordenar etiquetas ─────────────────────────────────────────────────────

export async function tidyLibrary(): Promise<{ revisados: number; cambiados: number }> {
  const { result } = await updateLibrary((l) => {
    let cambiados = 0;
    for (const it of l.items) {
      const tags = mergeTags(it.etiquetas);
      const where = it.clave ?? '';
      const kind = where ? kindFromFolders(where) : null;
      const changed = tags.join('|') !== it.etiquetas.join('|') || (kind && kind !== it.tipo);
      if (!changed) continue;
      it.etiquetas = tags;
      if (kind) it.tipo = kind;
      cambiados++;
    }
    return { revisados: l.items.length, cambiados };
  });
  return result;
}

// ── 2. Propuestas de Claude ──────────────────────────────────────────────────

/** Nombre poco útil: códigos, números o genéricos («AUD_0012», «track 3», «untitled»). */
export function poorName(nombre: string): boolean {
  const n = nombre.trim().toLowerCase();
  if (n.length < 4) return true;
  if (/^(aud|audio|track|pista|sfx|fx|sound|sonido|rec|grabacion|untitled|sin titulo|nuevo|new|clip|sample|file|archivo)?[\s_.-]*\d+[a-z]?$/.test(n)) return true;
  return (n.match(/\d/g)?.length ?? 0) > n.length * 0.5;
}

/** Necesita ayuda: nombre pobre, sin etiquetas propias (aparte del pack) o, con `notas`, sin nota. */
export function needsHelp(it: LibraryItem, conNotas: boolean): boolean {
  const own = it.etiquetas.filter((e) => !it.pack || e !== it.pack.toLowerCase());
  return poorName(it.nombre) || own.length === 0 || (conNotas && !it.nota);
}

interface Proposal {
  id: string;
  antes: { nombre: string; tipo: AudioKind; etiquetas: string[]; nota?: string };
  despues: { nombre: string; tipo: AudioKind; etiquetas: string[]; nota: string };
  medidas: string;
}

export interface OrganizeJob {
  id: string;
  estado: 'midiendo' | 'pensando' | 'listo' | 'error' | 'cancelado';
  total: number;
  hechos: number;
  propuestas: Proposal[];
  error?: string;
  inicio: string;
}

const g = globalThis as unknown as { __luloAudioOrganize?: Map<string, OrganizeJob & { cancel?: boolean }> };
const jobs = (g.__luloAudioOrganize ??= new Map());
const BATCH = 20;
const MAX_ITEMS = 400;

/** Volumen medio (dB) del audio filtrado: para saber si es grave o agudo. */
async function bandVolume(file: string, filter: string): Promise<number | null> {
  const bin = resolveFfmpegPath();
  const out: string = await new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-nostats', '-i', file, '-t', '30', '-af', `${filter},volumedetect`, '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(err));
  });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(out);
  return m ? Number(m[1]) : null;
}

/** Medidas del sonido en una línea (lo que Claude usa en vez de oírlo). */
async function describeSound(it: LibraryItem): Promise<string> {
  const parts = [`${it.duracion.toFixed(1)} s`];
  if (it.bpm) parts.push(`${it.bpm} BPM`);
  try {
    const file = await ensureLocal(it);
    const env = await computeEnvelope(file);
    const db = env.db;
    let peak = 0;
    for (let i = 1; i < db.length; i++) if (db[i] > db[peak]) peak = i;
    const peakT = peak * 0.005;
    const avg = db.reduce((s, v) => s + v, 0) / Math.max(1, db.length);
    const end = db.slice(Math.max(0, db.length - 40));
    const endAvg = end.reduce((s, v) => s + v, 0) / Math.max(1, end.length);
    parts.push(`volumen medio ${avg.toFixed(0)} dB, pico ${db[peak].toFixed(0)} dB`);
    parts.push(peakT < 0.15 ? `golpe al inicio (${peakT.toFixed(2)} s: ataque seco)` : peakT > it.duracion * 0.6 ? `sube hasta el final (pico a ${peakT.toFixed(1)} s: crescendo/riser)` : `pico a ${peakT.toFixed(1)} s`);
    if (endAvg < env.floor + 6) parts.push('termina en silencio');
    const [low, high] = await Promise.all([bandVolume(file, 'lowpass=f=250'), bandVolume(file, 'highpass=f=3000')]);
    if (low != null && high != null) parts.push(low - high > 8 ? 'sonido grave' : high - low > 0 ? 'sonido agudo/brillante' : 'equilibrado');
  } catch (err) {
    parts.push(`(sin medidas: ${errorMessage(err)})`);
  }
  return parts.join(' · ');
}

const ProposalSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      nombre: z.string().min(2).max(80),
      tipo: z.enum(AUDIO_KINDS),
      etiquetas: z.array(z.string().min(1).max(30)).max(8),
      nota: z.string().max(160),
    })
  ),
});

export function getOrganizeJob(id: string): OrganizeJob | null {
  const j = jobs.get(id);
  if (!j) return null;
  const { cancel: _c, ...rest } = j;
  void _c;
  return rest;
}

export function cancelOrganize(id: string): boolean {
  const j = jobs.get(id);
  if (!j || !['midiendo', 'pensando'].includes(j.estado)) return false;
  j.cancel = true;
  return true;
}

/** Empieza a preparar propuestas. `todos`: también los que ya están bien (para añadirles nota). */
export async function startOrganize(opts: { todos?: boolean; ids?: string[] }): Promise<OrganizeJob> {
  const { biblioteca } = await loadLibrary();
  const active = biblioteca.items.filter((it) => it.estado === 'activa');
  const pick = opts.ids?.length ? active.filter((it) => opts.ids!.includes(it.id)) : active.filter((it) => needsHelp(it, !!opts.todos));
  if (!pick.length) throw new LibraryError('No hay audios que necesiten organizarse. Marca «Todos» para añadirles una nota de uso.', 409);
  const items = pick.slice(0, MAX_ITEMS);
  const job: OrganizeJob & { cancel?: boolean } = { id: randomUUID().slice(0, 8), estado: 'midiendo', total: items.length, hechos: 0, propuestas: [], inicio: new Date().toISOString() };
  jobs.set(job.id, job);
  // Vocabulario actual (para que reutilice las etiquetas que ya existen)
  const count = new Map<string, number>();
  for (const it of active) for (const e of it.etiquetas) count.set(e, (count.get(e) ?? 0) + 1);
  const vocab = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([e]) => e);
  void runOrganize(job, items, vocab).catch((err) => {
    job.estado = 'error';
    job.error = errorMessage(err);
  });
  return getOrganizeJob(job.id)!;
}

async function runOrganize(job: OrganizeJob & { cancel?: boolean }, items: LibraryItem[], vocab: string[]) {
  for (let i = 0; i < items.length; i += BATCH) {
    if (job.cancel) {
      job.estado = 'cancelado';
      return;
    }
    const batch = items.slice(i, i + BATCH);
    job.estado = 'midiendo';
    const medidas: Record<string, string> = {};
    for (const it of batch) medidas[it.id] = await describeSound(it);
    job.estado = 'pensando';
    const list = batch
      .map((it) => `- id ${it.id} | nombre «${it.nombre}» | tipo ${it.tipo} | archivo ${it.clave ?? it.nombre} | etiquetas [${it.etiquetas.join(', ')}] | ${medidas[it.id]}`)
      .join('\n');
    const { object } = await orchestrateObject({
      tool: 'video-editor',
      description: `Edición · organizar biblioteca de audio (${batch.length})`,
      system: `Eres el responsable de la biblioteca de sonido de un estudio que edita videos verticales virales (TikTok, Reels, Shorts). Ordenas audios para que un editor los encuentre al instante.
No puedes oír los audios: decide por el nombre original, la ruta del archivo (las carpetas suelen decir la categoría), la duración, el BPM y las medidas del sonido.
Para cada audio devuelve:
- nombre: claro y en español, corto (2–6 palabras), que diga qué suena («Whoosh rápido de aire», «Impacto grave cinematográfico»). Si el original ya es claro o es el título de una canción, consérvalo (sin el número de pista ni la extensión).
- tipo: efecto (sonidos cortos, transiciones, golpes, interfaz…), musica (canciones, beats, instrumentales) o ambiente (fondos continuos: lluvia, oficina, ciudad, sala).
- etiquetas: 2–6, en minúsculas. REUTILIZA las del vocabulario siempre que encajen; para música, ánimo (épico, calma, emocional, energética, misterioso…) y uso (hooks, demostración, story…); para efectos, categoría (transiciones, impactos, interfaz, cámara, cartoon / meme, mágico…).
- nota: una frase (≤ 160 caracteres) de cuándo usarlo en una edición («para revelar una cifra», «bajo la voz en tutoriales tranquilos», «en el corte del gancho»).
Devuelve TODOS los ids que te paso, sin inventar otros.`,
      prompt: `Vocabulario de etiquetas que ya usa la biblioteca: ${vocab.join(', ') || '(vacío)'}

Audios:
${list}`,
      schema: ProposalSchema,
      temperature: 0.3,
    });
    for (const it of batch) {
      const p = object.items.find((x) => x.id === it.id);
      if (!p) continue;
      job.propuestas.push({
        id: it.id,
        antes: { nombre: it.nombre, tipo: it.tipo, etiquetas: it.etiquetas, ...(it.nota ? { nota: it.nota } : {}) },
        despues: { nombre: p.nombre.trim(), tipo: p.tipo, etiquetas: mergeTags(p.etiquetas, it.pack ? [it.pack.toLowerCase()] : []).slice(0, 8), nota: p.nota.trim() },
        medidas: medidas[it.id],
      });
    }
    job.hechos = Math.min(items.length, i + batch.length);
  }
  job.estado = 'listo';
}

export const ApplySchema = z.object({
  cambios: z
    .array(
      z.object({
        id: z.string().max(20),
        nombre: z.string().trim().min(2).max(80),
        tipo: z.enum(AUDIO_KINDS),
        etiquetas: z.array(z.string().trim().min(1).max(30)).max(12),
        nota: z.string().trim().max(300).default(''),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
});

/** Guarda los cambios elegidos por la persona (una sola escritura del catálogo). */
export async function applyOrganization(raw: unknown): Promise<{ aplicados: number }> {
  const { cambios } = ApplySchema.parse(raw);
  const byId = new Map(cambios.map((c) => [c.id, c]));
  const { result } = await updateLibrary((l) => {
    let n = 0;
    for (const it of l.items) {
      const c = byId.get(it.id);
      if (!c) continue;
      it.nombre = c.nombre;
      it.tipo = c.tipo;
      it.etiquetas = mergeTags(c.etiquetas);
      if (c.nota) it.nota = c.nota;
      n++;
    }
    return n;
  });
  return { aplicados: result };
}
