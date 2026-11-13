import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { z } from 'zod';
import { renderEdit, snapToFrames } from './render';
import { keptIntervals, subtitleWords, totalDuration } from './timeline';
import { directedProfile, finalToOriginal } from './direction';
import { LOUDNESS_BY_NETWORK } from './audio';
import type { EditProject } from './types';

/**
 * Versiones y publicación (Fase 5 del editor viral):
 *  - variantes del borrador (otro gancho, otro avance, versión corta…) que se renderizan aparte
 *    sin tocar el borrador principal: `variante-<nombre>-v<N>.mp4`;
 *  - exportación por red (TikTok, Reels, Shorts): su zona segura y su volumen, más un .srt;
 *  - texto del post (descripción, hashtags, primer comentario) que escribe Claude.
 * Los renders usan una COPIA del proyecto en memoria: el borrador y el plan guardados no cambian.
 */

export const NETWORKS = ['tiktok', 'instagram', 'shorts'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABEL: Record<Network, string> = { tiktok: 'TikTok', instagram: 'Reels', shorts: 'Shorts' };
/** Duración máxima que admite cada red para videos subidos (noviembre de 2026). */
export const NETWORK_MAX_SEC: Record<Network, number> = { tiktok: 600, instagram: 180, shorts: 180 };

export interface EditVariant {
  id: string;
  nombre: string;
  descripcion?: string;
  archivo: string;
  portada?: string;
  duracion: number;
  creado: string;
  /** Versión del borrador del que salió. */
  deVersion: number;
}
export interface EditExport {
  red: Network;
  archivo: string;
  srt: string;
  duracion: number;
  creado: string;
  deVersion: number;
  avisos: string[];
}
export interface PostText {
  descripcion: string;
  hashtags: string[];
  comentario?: string;
  /** Ajuste opcional por red (si una red pide otro tono o largo). */
  porRed?: Partial<Record<Network, string>>;
  actualizado: string;
}

export const VariantInputSchema = z.object({
  /** Nombre corto: «A», «B», «corta», «sin-avance»… */
  nombre: z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N} _-]+$/u, 'Solo letras, números, espacios, - y _'),
  descripcion: z.string().max(200).optional(),
  /** Otro texto de gancho (pantalla de inicio). */
  gancho: z.string().max(120).optional(),
  /** Otro avance al inicio, en segundos de la línea principal ACTUAL; null = sin avance. */
  arranque: z.object({ desde: z.number().min(0), hasta: z.number().min(0), transicion: z.enum(['corte', 'flash']).default('flash') }).nullable().optional(),
  /** Versión corta/larga: frases (id de ver_edicion) que se quedan; las demás se cortan. */
  conservarFrases: z.array(z.string()).max(400).optional(),
  /** O al revés: frases que se quitan además de las ya cortadas. */
  quitarFrases: z.array(z.string()).max(400).optional(),
  /** Primer plano: zoom fijo de la cámara en los primeros segundos (otro arranque visual). */
  zoomInicio: z.number().min(1).max(1.8).optional(),
});
export type VariantInput = z.infer<typeof VariantInputSchema>;

export const PostInputSchema = z.object({
  descripcion: z.string().trim().min(10).max(2200),
  hashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]+$/u).max(40)).max(30),
  comentario: z.string().trim().max(500).optional(),
  porRed: z.object({ tiktok: z.string().max(2200).optional(), instagram: z.string().max(2200).optional(), shorts: z.string().max(2200).optional() }).optional(),
});

export class OutputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const g = globalThis as unknown as { __luloOutputBusy?: Set<string> };
const busy = (g.__luloOutputBusy ??= new Set<string>());
export const outputBusy = (id: string) => busy.has(id);

async function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(id)) throw new OutputError('Ya se está renderizando una variante o exportación de esta edición: espera a que termine.', 409);
  busy.add(id);
  try {
    return await fn();
  } finally {
    busy.delete(id);
  }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const safeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'v';

/** Renderiza una copia del proyecto y deja el resultado con el nombre pedido (sin tocar el borrador). */
async function renderCopy(p: EditProject, q: EditProject, outBase: string, onProgress?: (pct: number) => void) {
  // Versión alta y propia: renderEdit escribe borrador-v<N>.mp4 y portada-v<N>.jpg
  const tmpVersion = 900000 + Math.floor(Math.random() * 99999);
  const r = await renderEdit(q, tmpVersion, (pct) => onProgress?.(pct), { conservarBases: true });
  const out = `${outBase}.mp4`;
  const cover = `${outBase}.jpg`;
  await fs.rename(path.join(/*turbopackIgnore: true*/ p.carpeta, r.archivo), path.join(/*turbopackIgnore: true*/ p.carpeta, out));
  const tmpCover = path.join(/*turbopackIgnore: true*/ p.carpeta, `portada-v${tmpVersion}.jpg`);
  let portada: string | undefined;
  if (fsSync.existsSync(tmpCover)) {
    await fs.rename(tmpCover, path.join(/*turbopackIgnore: true*/ p.carpeta, cover));
    portada = cover;
  }
  return { archivo: out, portada, duracion: r.duracion };
}

/** Aplica la variante sobre una copia del proyecto. */
export function applyVariant(p: EditProject, v: VariantInput): EditProject {
  const q = clone(p);
  const perfil = q.direccion ? directedProfile(q.perfil, q.direccion) : q.perfil;
  const intervals = snapToFrames(keptIntervals(q.frases, perfil.ritmo, q.original.duracion));
  const ids = new Set(q.frases.map((f) => f.id));
  for (const id of [...(v.conservarFrases ?? []), ...(v.quitarFrases ?? [])]) if (!ids.has(id)) throw new OutputError(`La frase «${id}» no existe (mira ver_edicion).`);
  if (v.conservarFrases) {
    const keep = new Set(v.conservarFrases);
    for (const f of q.frases) f.cortar = !keep.has(f.id);
  }
  if (v.quitarFrases) for (const f of q.frases) if (v.quitarFrases.includes(f.id)) f.cortar = true;
  if (!q.frases.some((f) => !f.cortar && f.palabras.length)) throw new OutputError('Con esos cortes no queda ninguna frase.');
  if (v.gancho !== undefined) {
    q.gancho = v.gancho;
    // Un gancho nuevo tiene que verse aunque el perfil lo tuviera apagado
    if (v.gancho.trim()) {
      q.perfil = { ...q.perfil, gancho: { ...q.perfil.gancho, activo: true } };
      if (q.direccion?.gancho) q.direccion.gancho = { ...q.direccion.gancho, activo: true };
    }
  }
  if (q.direccion && v.arranque !== undefined) {
    if (v.arranque === null) q.direccion.arranque = undefined;
    else {
      if (v.arranque.hasta - v.arranque.desde > 4.5 || v.arranque.hasta <= v.arranque.desde) throw new OutputError('arranque: entre 0,3 y 4,5 s.');
      // Tiempos de la línea principal ACTUAL → original (así sobreviven a los cortes de la variante)
      q.direccion.arranque = { desde: finalToOriginal(v.arranque.desde, intervals), hasta: finalToOriginal(v.arranque.hasta, intervals), transicion: v.arranque.transicion };
    }
  }
  if (v.zoomInicio && q.direccion) {
    // Un plano cerrado fijo los primeros 2 s (el resto de la cámara se respeta)
    const end = finalToOriginal(2, intervals);
    const cams = (q.direccion.camara ?? []).filter((c) => c.desde >= end);
    q.direccion.camara = [{ desde: 0, hasta: end, tipo: 'plano', zoom: v.zoomInicio }, ...cams];
  }
  return q;
}

export async function renderVariant(p: EditProject, v: VariantInput, onProgress?: (pct: number) => void): Promise<EditVariant> {
  if (!p.borrador) throw new OutputError('Primero hace falta un borrador.');
  return exclusive(p.id, async () => {
    const q = applyVariant(p, v);
    const base = `variante-${safeName(v.nombre)}-v${p.borrador!.version}`;
    const r = await renderCopy(p, q, base, onProgress);
    return { id: safeName(v.nombre), nombre: v.nombre, descripcion: v.descripcion, archivo: r.archivo, portada: r.portada, duracion: r.duracion, creado: new Date().toISOString(), deVersion: p.borrador!.version };
  });
}

// ── Exportar por red ─────────────────────────────────────────────────────────

/** Pasa un tiempo de la línea principal al borrador final (avance al inicio + pausas que caen antes). */
export function mainToDraft(t: number, d: EditProject['direccion'], intervals: ReturnType<typeof snapToFrames>): number {
  if (!d) return t;
  let off = 0;
  if (d.arranque) {
    // El plan guarda el avance en tiempos del original: su largo en la línea principal
    const total = totalDuration(intervals);
    const toMain = (o: number) => {
      for (const iv of intervals) if (o >= iv.s && o <= iv.e) return iv.out + (o - iv.s);
      return Math.min(total, intervals.find((iv) => iv.s > o)?.out ?? total);
    };
    off += Math.max(0, toMain(d.arranque.hasta) - toMain(d.arranque.desde));
  }
  for (const pz of d.pausas ?? []) {
    let pm = pz.t;
    for (const iv of intervals) if (pz.t >= iv.s && pz.t <= iv.e) pm = iv.out + (pz.t - iv.s);
    if (pm <= t) off += pz.duracion;
  }
  return t + off;
}

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** Subtítulos .srt del borrador (líneas de hasta 7 palabras o 2,5 s, sin mezclar frases). */
export function buildSrt(p: EditProject): string {
  const perfil = p.direccion ? directedProfile(p.perfil, p.direccion) : p.perfil;
  const intervals = snapToFrames(keptIntervals(p.frases, perfil.ritmo, p.original.duracion));
  const words = subtitleWords(p.frases, intervals);
  const lines: Array<{ s: number; e: number; t: string }> = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, t: cur.map((w) => w.t).join(' ') });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (cur[0].frase !== w.frase || cur.length >= 7 || w.e - cur[0].s > 2.5 || /[.!?…]$/.test(cur[cur.length - 1].t))) flush();
    cur.push(w);
  }
  flush();
  return lines.map((l, i) => `${i + 1}\n${srtTime(mainToDraft(l.s, p.direccion, intervals))} --> ${srtTime(mainToDraft(l.e, p.direccion, intervals))}\n${l.t}\n`).join('\n');
}

export async function exportForNetwork(p: EditProject, red: Network, onProgress?: (pct: number) => void): Promise<EditExport> {
  if (!p.borrador) throw new OutputError('Primero hace falta un borrador.');
  return exclusive(p.id, async () => {
    const q = clone(p);
    q.perfil = { ...q.perfil, red };
    // El volumen de la red manda en la exportación
    if (q.direccion) q.direccion.volumenFinal = undefined;
    const base = `export-${red}-v${p.borrador!.version}`;
    const r = await renderCopy(p, q, base, onProgress);
    if (r.portada) await fs.rm(path.join(/*turbopackIgnore: true*/ p.carpeta, r.portada), { force: true }).catch(() => undefined);
    const srt = `${base}.srt`;
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ p.carpeta, srt), buildSrt(p), 'utf-8');
    const avisos: string[] = [];
    if (r.duracion > NETWORK_MAX_SEC[red]) avisos.push(`Dura ${Math.round(r.duracion)} s y ${NETWORK_LABEL[red]} admite como mucho ${NETWORK_MAX_SEC[red]} s: haz una variante corta.`);
    return { red, archivo: r.archivo, srt, duracion: r.duracion, creado: new Date().toISOString(), deVersion: p.borrador!.version, avisos: [...avisos, `Volumen ${LOUDNESS_BY_NETWORK[red]} LUFS y zona segura de ${NETWORK_LABEL[red]}.`] };
  });
}
