import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import spawn from 'cross-spawn';
import { z } from 'zod';
import { ensureDataDir } from '@/lib/data/data-dir';
import { getSettings } from '@/lib/data/settings';
import { ffmpeg, probeVideo } from './media';
import { normalizeProfile } from './profile-store';
import { snapToFrames } from './render';
import { keptIntervals, subtitleWords, totalDuration } from './timeline';
import { directedProfile, directionInFinal } from './direction';
import { mainToDraft } from './outputs';
import { detectBeats } from './beats';
import { measureLoudness } from './audio';
import { sharedDoc } from './shared-doc';
import type { EditProject } from './types';

/**
 * Aprendizaje (Fase 7): métricas reales de cada video publicado (con la evidencia de qué había en
 * pantalla cuando la gente se fue), fichas de videos de referencia virales y la mejor hora de
 * publicación. Todo lo del equipo se comparte en R2 (como el manual); los videos de referencia se
 * quedan solo en este PC (se usan para medir, nunca dentro de una edición).
 */

// ── Métricas ─────────────────────────────────────────────────────────────────

export const METRIC_NETWORKS = ['tiktok', 'instagram', 'shorts', 'otra'] as const;

export const MetricInputSchema = z.object({
  red: z.enum(METRIC_NETWORKS),
  /** Fecha y hora de publicación (ISO, hora local de la persona), si se sabe. */
  publicado: z.string().max(40).optional(),
  vistas: z.number().int().min(0).optional(),
  alcance: z.number().int().min(0).optional(),
  meGusta: z.number().int().min(0).optional(),
  comentarios: z.number().int().min(0).optional(),
  compartidos: z.number().int().min(0).optional(),
  guardados: z.number().int().min(0).optional(),
  duracionMediaSeg: z.number().min(0).optional(),
  /** Curva de retención: % de gente que sigue en cada segundo del video PUBLICADO. */
  retencion: z.array(z.object({ t: z.number().min(0), pct: z.number().min(0).max(100) })).max(400).optional(),
  /** Qué se publicó: el borrador (versión) o una variante. */
  variante: z.string().max(40).optional(),
  fuente: z.enum(['captura', 'csv', 'manual']).default('captura'),
  notas: z.string().max(600).optional(),
});
export type MetricInput = z.infer<typeof MetricInputSchema>;
export type EditMetric = MetricInput & { id: string; version?: number; registrado: string; quien: string };

interface MetricsBook {
  version: number;
  videos: Array<{ id: string; edicion: string; titulo: string; red: string; publicado?: string; vistas?: number; alcance?: number; duracionMediaSeg?: number; retencion3s?: number; duracion?: number; quien: string }>;
}
export const metricsDoc = sharedDoc<MetricsBook>('_lulo/metricas.json', 'metricas.json', () => ({ version: 0, videos: [] }));

async function who(): Promise<string> {
  const s = (await getSettings().catch(() => null)) as { personName?: string } | null;
  return s?.personName?.trim() || 'Equipo';
}

export async function newMetric(p: EditProject, m: MetricInput): Promise<EditMetric> {
  return { ...m, id: `m${randomUUID().slice(0, 8)}`, version: p.borrador?.version, registrado: new Date().toISOString(), quien: await who() };
}

const at = (curve: Array<{ t: number; pct: number }>, t: number) => {
  const c = [...curve].sort((a, b) => a.t - b.t);
  if (!c.length) return undefined;
  if (t <= c[0].t) return c[0].pct;
  for (let i = 0; i < c.length - 1; i++) if (t <= c[i + 1].t) return c[i].pct + ((c[i + 1].pct - c[i].pct) * (t - c[i].t)) / Math.max(1e-6, c[i + 1].t - c[i].t);
  return c[c.length - 1].pct;
};

/** Guarda el resumen en el registro compartido del equipo (para la mejor hora y comparar). */
export async function shareMetric(p: EditProject, m: EditMetric) {
  await metricsDoc.update((d) => {
    d.videos = d.videos.filter((v) => v.id !== m.id);
    d.videos.push({
      id: m.id,
      edicion: p.id,
      titulo: p.titulo,
      red: m.red,
      publicado: m.publicado,
      vistas: m.vistas,
      alcance: m.alcance,
      duracionMediaSeg: m.duracionMediaSeg,
      retencion3s: m.retencion?.length ? at(m.retencion, 3) : undefined,
      duracion: p.borrador?.duracion,
      quien: m.quien,
    });
  });
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Cruza la curva de retención con el plan: en las caídas más fuertes, qué había en pantalla y qué
 * se decía. Devuelve evidencias listas para convertir en lecciones del manual.
 */
export function analyzeRetention(p: EditProject, m: MetricInput) {
  const curve = [...(m.retencion ?? [])].sort((a, b) => a.t - b.t);
  if (curve.length < 3) return { resumen: 'Sin curva de retención: solo se guardan los números.', caidas: [] as unknown[] };
  const perfil = p.direccion ? directedProfile(normalizeProfile(p.perfil), p.direccion) : normalizeProfile(p.perfil);
  const intervals = snapToFrames(keptIntervals(p.frases, perfil.ritmo, p.original.duracion));
  const total = totalDuration(intervals);
  const plan = p.direccion ? directionInFinal(p.direccion, intervals, total) : null;
  const words = subtitleWords(p.frases, intervals);
  // Borrador → línea principal (al revés de mainToDraft, buscando el tiempo principal más cercano)
  const toMain = (td: number) => {
    let lo = 0;
    let hi = total;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (mainToDraft(mid, p.direccion, intervals) < td) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // Caídas: pendiente por segundo en ventanas de 1 s (sin contar el primer segundo, que siempre cae)
  const drops: Array<{ t: number; de: number; a: number; caida: number }> = [];
  const end = curve[curve.length - 1].t;
  for (let t = 1; t < end - 0.5; t += 0.5) {
    const a = at(curve, t)!;
    const b = at(curve, t + 1)!;
    if (a - b >= 2.5) drops.push({ t, de: Math.round(a), a: Math.round(b), caida: Math.round((a - b) * 10) / 10 });
  }
  drops.sort((x, y) => y.caida - x.caida);
  const chosen: typeof drops = [];
  for (const d of drops) if (chosen.length < 4 && chosen.every((c) => Math.abs(c.t - d.t) >= 2)) chosen.push(d);
  const caidas = chosen
    .sort((x, y) => x.t - y.t)
    .map((d) => {
      const tm = toMain(d.t);
      const near = (x: number) => Math.abs(x - tm) <= 1.2;
      const cam = plan?.camara?.find((c) => c.desde <= tm && c.hasta >= tm);
      const enPantalla: string[] = [];
      if (cam) enPantalla.push(`cámara «${cam.tipo}» zoom ${cam.zoom} desde ${cam.desde.toFixed(1)} s (${(tm - cam.desde).toFixed(1)} s sin cambiar de plano)`);
      for (const e of plan?.elementos ?? []) if (e.desde <= tm + 0.5 && e.hasta >= tm - 0.5) enPantalla.push(`elemento ${e.modo} «${e.archivo}»`);
      const lastChange = Math.max(0, ...(plan?.camara ?? []).map((c) => c.desde).filter((x) => x <= tm), ...(plan?.elementos ?? []).map((e) => e.desde).filter((x) => x <= tm), ...(plan?.transiciones ?? []).map((x) => x.t).filter((x) => x <= tm));
      const dicho = words.filter((w) => w.s >= tm - 1.5 && w.s <= tm + 1).map((w) => w.t).join(' ');
      const sfx = (plan?.sonidos ?? []).filter((s) => near(s.t)).map((s) => s.tipo);
      return {
        enVideoPublicado: fmt(d.t),
        ...(d.t < 3 ? { nota: 'Caída del gancho (primeros 3 s): mira el primer plano, el texto y la primera frase.' } : {}),
        retencion: `${d.de} % → ${d.a} % (−${d.caida} puntos en 1 s)`,
        lineaPrincipal: Math.round(tm * 10) / 10,
        segundosSinCambioVisual: Math.round((tm - lastChange) * 10) / 10,
        enPantalla,
        sonidos: sfx,
        decia: dicho ? `«${dicho}»` : '',
      };
    });
  const r3 = at(curve, 3);
  const half = at(curve, end / 2);
  return {
    resumen: `Retención a los 3 s: ${r3 !== undefined ? Math.round(r3) : '?'} %; a la mitad: ${half !== undefined ? Math.round(half) : '?'} %; al final: ${Math.round(curve[curve.length - 1].pct)} %.`,
    caidas,
    comoAprender:
      'Convierte lo que se repita en lecciones GENERALES con aprender_del_feedback (nota = la evidencia: video, segundo, caída y qué había). Una caída aislada es una pista, no una regla: confírmala con otros videos (ver_manual / confirma).',
  };
}

// ── Mejor hora (idea 45) ─────────────────────────────────────────────────────

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export async function bestTime() {
  const { data, compartido } = await metricsDoc.load();
  const rows = data.videos.filter((v) => v.publicado && (v.vistas ?? v.alcance) !== undefined);
  const general = {
    nota: 'Orientación general mientras no haya datos propios suficientes (no son datos del equipo):',
    tiktok: 'entre semana 12–14 h y 19–22 h; fines de semana, mañana a media mañana.',
    instagram: 'martes a jueves 11–13 h y 18–21 h.',
    shorts: 'tarde-noche (17–21 h) y fines de semana.',
  };
  if (rows.length < 8) return { datos: rows.length, compartido, suficiente: false, general, siguiente: 'Registra métricas de más videos (registrar_metricas) con su fecha y hora de publicación.' };
  const byBucket = new Map<string, number[]>();
  const all = rows.map((v) => v.vistas ?? v.alcance ?? 0).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] || 1;
  for (const v of rows) {
    const d = new Date(v.publicado!);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${v.red}|${DAYS[d.getDay()]}|${Math.floor(d.getHours() / 3) * 3}`;
    const arr = byBucket.get(key) ?? [];
    arr.push((v.vistas ?? v.alcance ?? 0) / median);
    byBucket.set(key, arr);
  }
  const ranking = [...byBucket.entries()]
    .filter(([, xs]) => xs.length >= 2)
    .map(([k, xs]) => {
      const [red, dia, h] = k.split('|');
      return { red, dia, franja: `${h}–${Number(h) + 3} h`, videos: xs.length, rendimiento: Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 };
    })
    .sort((a, b) => b.rendimiento - a.rendimiento);
  return { datos: rows.length, compartido, suficiente: ranking.length > 0, mejores: ranking.slice(0, 5), peores: ranking.slice(-3), nota: 'rendimiento = vistas respecto a la mediana del equipo (1 = normal). Franjas con al menos 2 videos.', general };
}

// ── Videos de referencia (idea 47) ───────────────────────────────────────────

export interface ReferenceSheet {
  id: string;
  nombre: string;
  url?: string;
  duracion: number;
  cortesPorMinuto: number;
  planoMedioSeg: number;
  planoMasLargoSeg: number;
  primerCorteSeg: number | null;
  lufs: number;
  bpm?: number;
  /** Lo que Claude vio en la hoja de fotogramas: subtítulos, colores, gráficos, ritmo. */
  estilo?: string;
  ideas?: string[];
  cuandoUsar?: string;
  quien: string;
  fecha: string;
}
interface ReferenceBook {
  version: number;
  fichas: ReferenceSheet[];
}
export const referencesDoc = sharedDoc<ReferenceBook>('_lulo/referencias.json', 'referencias.json', () => ({ version: 0, fichas: [] }));

export async function referencesDir(): Promise<string> {
  const d = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'referencias');
  await fs.mkdir(d, { recursive: true });
  return d;
}

function ytdlp(url: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', ['--no-playlist', '-f', 'bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4', '--max-filesize', '300M', '-o', out, url], { windowsHide: true });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp no está instalado en este PC (${e.message}). Instálalo (brew install yt-dlp / winget install yt-dlp) o adjunta el video.`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fsSync.existsSync(out)) resolve();
      else reject(new Error(`No se pudo descargar el video: ${err.split('\n').filter((l) => /ERROR/.test(l)).slice(-2).join(' ') || `código ${code}`}`));
    });
  });
}

/** Descarga (o toma) el video, mide su ritmo y deja una hoja de fotogramas para que Claude la mire. */
export async function measureReference(o: { url?: string; archivo?: string; nombre?: string }) {
  const id = `ref${randomUUID().slice(0, 8)}`;
  const dir = path.join(/*turbopackIgnore: true*/ await referencesDir(), id);
  await fs.mkdir(dir, { recursive: true });
  const video = path.join(/*turbopackIgnore: true*/ dir, 'video.mp4');
  if (o.url) await ytdlp(o.url, video);
  else if (o.archivo) await fs.copyFile(o.archivo, video);
  else throw new Error('Indica url o archivo.');
  const info = await probeVideo(video);
  const dur = info.duracion;
  // Cortes: cambios de escena fuertes
  const out = await ffmpeg({ args: ['-hide_banner', '-i', video, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], timeoutMs: 10 * 60_000 });
  const cuts = [...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.15);
  const marks = [0, ...cuts, dur];
  const shots = marks.slice(1).map((t, i) => t - marks[i]).filter((x) => x > 0.05);
  const loud = await measureLoudness(video).catch(() => ({ lufs: -70, tp: 0 }));
  const beats = info.tieneAudio ? await detectBeats(video, 0, Math.min(90, dur)).catch(() => null) : null;
  // Hoja de 12 fotogramas repartidos
  const sheet = path.join(/*turbopackIgnore: true*/ dir, 'hoja.jpg');
  await ffmpeg({ args: ['-y', '-hide_banner', '-i', video, '-vf', `fps=${(12 / Math.max(1, dur)).toFixed(4)},scale=270:-2,tile=6x2:padding=4`, '-frames:v', '1', '-q:v', '3', sheet], timeoutMs: 5 * 60_000 }).catch(() => undefined);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const ficha: ReferenceSheet = {
    id,
    nombre: o.nombre?.trim() || (o.url ? new URL(o.url).hostname.replace(/^www\./, '') : path.basename(o.archivo ?? 'video')),
    url: o.url,
    duracion: r1(dur),
    cortesPorMinuto: r1((cuts.length / Math.max(1, dur)) * 60),
    planoMedioSeg: r1(shots.reduce((s, x) => s + x, 0) / Math.max(1, shots.length)),
    planoMasLargoSeg: r1(Math.max(...shots, 0)),
    primerCorteSeg: cuts.length ? r1(cuts[0]) : null,
    lufs: r1(loud.lufs),
    bpm: beats && (beats.confianza ?? 0) >= 0.35 ? Math.round(beats.bpm) : undefined,
    quien: await who(),
    fecha: new Date().toISOString(),
  };
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, 'ficha.json'), JSON.stringify(ficha, null, 2));
  return { ficha, hoja: fsSync.existsSync(sheet) ? sheet : null, video };
}

export async function saveReference(id: string, extra: { nombre?: string; estilo: string; ideas: string[]; cuandoUsar?: string }) {
  const file = path.join(/*turbopackIgnore: true*/ await referencesDir(), id, 'ficha.json');
  if (!fsSync.existsSync(file)) throw new Error(`No hay ninguna referencia medida con id «${id}» (usa analizar_referencia antes).`);
  const base = JSON.parse(await fs.readFile(file, 'utf8')) as ReferenceSheet;
  const ficha: ReferenceSheet = { ...base, ...(extra.nombre ? { nombre: extra.nombre } : {}), estilo: extra.estilo, ideas: extra.ideas, cuandoUsar: extra.cuandoUsar };
  await fs.writeFile(file, JSON.stringify(ficha, null, 2));
  const { data } = await referencesDoc.update((d) => {
    d.fichas = [...d.fichas.filter((f) => f.id !== id), ficha];
  });
  return { ficha, total: data.fichas.length };
}
