import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { ensureDataDir, readJson, writeJsonAtomic } from '@/lib/data/data-dir';
import { getSettings } from '@/lib/data/settings';
import { getStorageBasePath } from '@/lib/storage/project-storage';
import { isInside } from '@/lib/fs/inside';
import { errorMessage } from '@/lib/errors';
import { FEEDBACK_SUFFIX, FeedbackError, LULO_SUFFIX, VIDEO_EXT, feedbackConfigured, getJson, listAll, putJson, putVideo, reviewUrl } from './r2';

/**
 * Lulo Studio ↔ app de feedback (flujo con estados, ver docs/feedback.md):
 *   Lulo sube el video → «Por revisar» · el equipo deja notas y decide en la app de feedback:
 *   «Pedir cambios» o «Aprobar» · desde Lulo se le indica a Claude → «Claude trabajando» (Claude
 *   descarga las notas y las aplica) → Claude responde → «Claude respondió» · versión nueva →
 *   la anterior queda «Reemplazado».
 * La decisión la escribe la app de feedback en `<video>.feedback.json`; lo de Claude lo escribe Lulo en
 * `<video>.lulo.json` (cuerpo + metadatos, que la app lee del listado). Lulo NO consulta el bucket en
 * segundo plano: solo cuando se abre la bandeja, se mira un video o Claude lo pide.
 */

export interface FeedbackNote {
  id: string;
  time: number;
  text: string;
  autor?: string;
  createdAt?: string;
  updatedAt?: string;
}
/** Decisión del equipo en la app de feedback. */
export interface FeedbackDecision {
  tipo: 'cambios' | 'aprobado';
  por?: string;
  en: string;
}
export interface FeedbackData {
  general: string;
  notes: FeedbackNote[];
  updatedAt: string | null;
  decision?: FeedbackDecision | null;
}

/** Estado de revisión de un video (misma regla que en la app de feedback: functions/_lib/util.js). */
export type ReviewState = 'por_revisar' | 'cambios_pedidos' | 'en_proceso' | 'respondido' | 'aprobado' | 'reemplazado';
export const REVIEW_LABEL: Record<ReviewState, string> = {
  por_revisar: 'Por revisar',
  cambios_pedidos: 'Cambios pedidos',
  en_proceso: 'Claude trabajando',
  respondido: 'Claude respondió',
  aprobado: 'Aprobado',
  reemplazado: 'Hay versión nueva',
};

export function reviewState(o: { decision?: FeedbackDecision | null; tomadoEn?: string; respondidoEn?: string; siguiente?: string }): ReviewState {
  if (o.siguiente) return 'reemplazado';
  const d = o.decision;
  if (d?.tipo === 'aprobado') return 'aprobado';
  if (d?.tipo === 'cambios') {
    if (o.tomadoEn && o.tomadoEn >= d.en) return o.respondidoEn && o.respondidoEn >= o.tomadoEn ? 'respondido' : 'en_proceso';
    return 'cambios_pedidos';
  }
  return 'por_revisar';
}

export type FeedbackService = 'edicion' | 'director' | 'studio' | 'avatar' | 'ugc' | 'escenas' | 'proyectos';
export const SERVICE_LABEL: Record<FeedbackService, string> = {
  edicion: 'Edición de video',
  director: 'Guion a video · Director',
  studio: 'Estudio Claude',
  avatar: 'Avatar Studio',
  ugc: 'UGC Studio',
  escenas: 'Guion a video',
  proyectos: 'Proyectos',
};

export interface FeedbackOrigin {
  servicio: FeedbackService;
  /** Id de la edición, producción o proyecto del estudio. */
  id?: string;
  version?: number;
  titulo: string;
}

export interface FeedbackEntry {
  key: string;
  proyecto: string;
  nombre: string;
  /** null = lo subió otra persona del equipo (solo se conocen sus notas). */
  origen: FeedbackOrigin | null;
  /** Firma de la fuente (para saber si ya se subió desde este botón). */
  fuente?: string;
  ruta?: string;
  subidoEn?: string;
  bytes?: number;
  enBucket?: boolean;
  feedback?: FeedbackData;
  /** LastModified del .feedback.json / .lulo.json la última vez que se leyeron. */
  feedbackModificado?: string;
  luloModificado?: string;
  /** Claude tomó los cambios pedidos (desde este u otro PC del equipo). */
  claude?: { destino: string; tomadoEn: string; edicionId?: string; notas: number };
  /** Respuesta de Claude al terminar (la ve el equipo en la app de feedback). */
  respuesta?: { texto: string; en: string };
  /** Clave de la versión nueva de este mismo video. */
  siguiente?: string;
}

export const stateOf = (e: FeedbackEntry): ReviewState =>
  reviewState({ decision: e.feedback?.decision, tomadoEn: e.claude?.tomadoEn, respondidoEn: e.respuesta?.en, siguiente: e.siguiente });

interface Registry {
  entradas: Record<string, FeedbackEntry>;
  ultimaSync?: string;
  errorSync?: string;
}

// ── Registro local ──────────────────────────────────────────────────────────

async function registryPath() {
  const dir = path.join(/*turbopackIgnore: true*/ await ensureDataDir(), 'feedback');
  await fs.promises.mkdir(dir, { recursive: true });
  return path.join(/*turbopackIgnore: true*/ dir, 'registro.json');
}

const g = globalThis as unknown as { __luloFeedbackLock?: Promise<unknown>; __luloFeedbackSync?: Promise<void> | null; __luloFeedbackLastSync?: number };

async function readRegistry(): Promise<Registry> {
  const r = await readJson<Registry>(await registryPath(), { entradas: {} });
  return { ...r, entradas: r.entradas ?? {} };
}

/** Cambios serializados (la subida, la sincronización y Claude escriben a la vez). */
async function withRegistry<T>(fn: (r: Registry) => T | Promise<T>): Promise<T> {
  const run = (g.__luloFeedbackLock ?? Promise.resolve()).then(async () => {
    const r = await readRegistry();
    const out = await fn(r);
    await writeJsonAtomic(await registryPath(), r);
    return out;
  });
  g.__luloFeedbackLock = run.catch(() => {});
  return run;
}

export const hasContent = (f?: FeedbackData) => Boolean(f && (f.notes.length > 0 || f.general.trim()));

// ── Fuentes: de qué video se trata ──────────────────────────────────────────

export const FeedbackSourceSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('edicion'), id: z.string().min(1).max(80) }),
  z.object({ tipo: z.literal('director'), id: z.string().min(1).max(80) }),
  z.object({ tipo: z.literal('studio'), id: z.string().min(1).max(80), mediaId: z.string().min(1).max(80) }),
  z.object({
    tipo: z.literal('archivo'),
    ruta: z.string().min(1).max(1000),
    servicio: z.enum(['avatar', 'ugc', 'escenas', 'proyectos']),
    titulo: z.string().max(160).optional(),
  }),
]);
export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>;

interface Resolved {
  ruta: string;
  proyecto: string;
  nombre: string;
  origen: FeedbackOrigin;
  fuente: string;
}

async function resolveSource(s: FeedbackSource): Promise<Resolved> {
  if (s.tipo === 'edicion') {
    const { getEdit, editFile } = await import('@/lib/editor/edit-store');
    const e = await getEdit(s.id);
    if (!e.borrador) throw new FeedbackError('Esta edición todavía no tiene un borrador.', 404);
    const v = e.borrador.version;
    return {
      ruta: editFile(e, e.borrador.archivo),
      proyecto: e.titulo,
      nombre: `${e.estado === 'aprobado' ? 'Reel aprobado' : 'Reel'} v${v}.mp4`,
      origen: { servicio: 'edicion', id: e.id, version: v, titulo: e.titulo },
      fuente: `edicion:${e.id}:v${v}`,
    };
  }
  if (s.tipo === 'director') {
    const { getDirectorProduction } = await import('@/lib/director-mode/engine');
    const p = await getDirectorProduction(s.id);
    const f = p.director?.produccion?.final;
    if (!f) throw new FeedbackError('Esta producción todavía no tiene video final.', 404);
    return {
      ruta: path.join(/*turbopackIgnore: true*/ p.carpeta, f.archivo),
      proyecto: p.nombre,
      nombre: `Final v${f.version}.mp4`,
      origen: { servicio: 'director', id: p.id, version: f.version, titulo: p.nombre },
      fuente: `director:${p.id}:v${f.version}`,
    };
  }
  if (s.tipo === 'studio') {
    const { getStudioProject } = await import('@/lib/studio/store');
    const p = await getStudioProject(s.id);
    const m = p.medios.find((x) => x.id === s.mediaId);
    if (!m || m.tipo !== 'video') throw new FeedbackError('Ese video ya no está en el proyecto.', 404);
    return {
      ruta: m.ruta,
      proyecto: p.titulo,
      nombre: `${m.titulo}${path.extname(m.ruta) || '.mp4'}`,
      origen: { servicio: 'studio', id: p.id, titulo: p.titulo },
      fuente: `studio:${p.id}:${m.id}`,
    };
  }
  const ruta = path.resolve(s.ruta);
  if (!isInside(await getStorageBasePath(), ruta)) throw new FeedbackError('Solo se pueden subir videos de la carpeta de proyectos.', 403);
  const folder = path.basename(path.dirname(ruta));
  const titulo = s.titulo?.trim() || folder;
  return {
    ruta,
    proyecto: titulo,
    nombre: path.basename(ruta),
    origen: { servicio: s.servicio, titulo },
    // Con la fecha del archivo: si se vuelve a montar en la misma ruta, cuenta como video nuevo
    fuente: `archivo:${process.platform === 'win32' ? ruta.toLowerCase() : ruta}:${fs.existsSync(ruta) ? Math.round(fs.statSync(ruta).mtimeMs) : 0}`,
  };
}

/** Un segmento de clave limpio: sin barras ni caracteres de control, y sin los sufijos reservados. */
function segment(raw: string, fallback: string): string {
  const s = raw
    .replace(/[\u0000-\u001f\u007f/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return s || fallback;
}

function videoName(raw: string, ext: string): string {
  let n = segment(raw, `video${ext}`);
  if (!VIDEO_EXT.test(n)) n = `${n}${ext}`;
  if (/\.(feedback|lulo)\.(json|txt)$/i.test(n)) n = `${n}${ext}`;
  return n;
}

// ── Subir ───────────────────────────────────────────────────────────────────

const luloMeta = (e: FeedbackEntry): Record<string, string> => ({
  ...(e.claude ? { tomado: e.claude.tomadoEn, destino: e.claude.destino, notas: String(e.claude.notas) } : {}),
  ...(e.respuesta ? { respondido: e.respuesta.en } : {}),
  ...(e.siguiente ? { siguiente: e.siguiente } : {}),
});

interface LuloStatus {
  claude?: FeedbackEntry['claude'] | null;
  respuesta?: FeedbackEntry['respuesta'] | null;
  siguiente?: string | null;
}

/** Escribe `<video>.lulo.json`. La app de feedback lee el estado de sus metadatos (sin descargarlo) y la respuesta del cuerpo. */
async function writeLuloStatus(e: FeedbackEntry) {
  const meta = luloMeta(e);
  if (!Object.keys(meta).length) return;
  const body: LuloStatus & { origen: FeedbackOrigin | null } = { origen: e.origen, claude: e.claude ?? null, respuesta: e.respuesta ?? null, siguiente: e.siguiente ?? null };
  await putJson(e.key + LULO_SUFFIX, body, meta);
}

function applyLulo(e: FeedbackEntry, st: LuloStatus | null) {
  if (!st) return;
  // Formato del 10 nov (claude.en) por compatibilidad
  const c = st.claude as (FeedbackEntry['claude'] & { en?: string }) | null | undefined;
  if (c && (c.tomadoEn || c.en)) e.claude = { destino: c.destino, tomadoEn: c.tomadoEn || c.en!, notas: c.notas ?? 0, ...(c.edicionId ? { edicionId: c.edicionId } : {}) };
  if (st.respuesta?.texto) e.respuesta = st.respuesta;
  if (st.siguiente) e.siguiente = st.siguiente;
}

export async function uploadToFeedback(source: FeedbackSource, opts: { proyecto?: string; nombre?: string } = {}): Promise<FeedbackEntry> {
  if (!feedbackConfigured()) {
    throw new FeedbackError('Falta configurar la app de feedback (FEEDBACK_R2_* en .env.local).', 503);
  }
  const r = await resolveSource(source);
  if (!fs.existsSync(r.ruta)) throw new FeedbackError('El archivo de video ya no está en disco.', 404);
  const ext = path.extname(r.ruta).toLowerCase() || '.mp4';
  if (!VIDEO_EXT.test(ext)) throw new FeedbackError('Solo se pueden subir videos (.mp4, .mov, .webm…).');
  const proyecto = segment(opts.proyecto ?? r.proyecto, 'Lulo Studio');
  const nombre = videoName(opts.nombre ?? r.nombre, ext);
  const key = `${proyecto}/${nombre}`;
  const persona = (await getSettings()).personName?.trim() || '';

  const bytes = await putVideo(key, r.ruta, {
    lulo: '1',
    origen: SERVICE_LABEL[r.origen.servicio],
    titulo: r.origen.titulo,
    ...(r.origen.version ? { version: String(r.origen.version) } : {}),
    ...(persona ? { persona } : {}),
  });

  const { entry, previous } = await withRegistry((reg) => {
    const old = reg.entradas[key];
    const entry: FeedbackEntry = {
      ...(old ?? {}),
      key,
      proyecto,
      nombre,
      origen: r.origen,
      fuente: r.fuente,
      ruta: r.ruta,
      subidoEn: new Date().toISOString(),
      bytes,
      enBucket: true,
    };
    // Mismo video subido otra vez (la app de feedback conserva sus notas y su decisión)
    delete entry.siguiente;
    reg.entradas[key] = entry;
    // Versión nueva de algo ya subido (misma edición, producción o proyecto del estudio)
    let previous: FeedbackEntry | undefined;
    if (r.origen.id && r.origen.version) {
      for (const e of Object.values(reg.entradas)) {
        if (e.key === key || !e.origen || e.origen.servicio !== r.origen.servicio || e.origen.id !== r.origen.id) continue;
        if ((e.origen.version ?? 0) < r.origen.version && e.siguiente !== key) {
          e.siguiente = key;
          previous = e;
        }
      }
    }
    return { entry, previous };
  });
  if (previous) await writeLuloStatus(previous).catch(() => {});
  return entry;
}

// ── Sincronizar ─────────────────────────────────────────────────────────────

/**
 * Lee del bucket el estado de todos los videos (al abrir la bandeja o cuando Claude lo pide; nunca en
 * segundo plano). Una sola lectura a la vez; como mucho cada 10 s salvo `force`.
 */
export function syncFeedback(force = false): Promise<void> {
  if (!feedbackConfigured()) return Promise.resolve();
  if (g.__luloFeedbackSync) return g.__luloFeedbackSync;
  if (!force && g.__luloFeedbackLastSync && Date.now() - g.__luloFeedbackLastSync < 10_000) return Promise.resolve();
  g.__luloFeedbackSync = (async () => {
    try {
      const objects = await listAll();
      const videos = new Set<string>();
      const fbMod = new Map<string, string>();
      const luloMod = new Map<string, string>();
      for (const o of objects) {
        if (!o.Key) continue;
        const mod = o.LastModified?.toISOString() ?? '';
        if (o.Key.endsWith(FEEDBACK_SUFFIX)) fbMod.set(o.Key.slice(0, -FEEDBACK_SUFFIX.length), mod);
        else if (o.Key.endsWith(LULO_SUFFIX)) luloMod.set(o.Key.slice(0, -LULO_SUFFIX.length), mod);
        else if (VIDEO_EXT.test(o.Key)) videos.add(o.Key);
      }
      const reg = await readRegistry();
      // Solo se descargan los archivos que cambiaron desde la última lectura
      const jobs: Array<() => Promise<void>> = [];
      const fb = new Map<string, FeedbackData | null>();
      const st = new Map<string, LuloStatus | null>();
      for (const [key, mod] of fbMod) {
        if (videos.has(key) && reg.entradas[key]?.feedbackModificado !== mod) {
          jobs.push(async () => void fb.set(key, normalize(await getJson<Partial<FeedbackData>>(key + FEEDBACK_SUFFIX).catch(() => null))));
        }
      }
      for (const [key, mod] of luloMod) {
        if (videos.has(key) && reg.entradas[key]?.luloModificado !== mod) {
          jobs.push(async () => void st.set(key, await getJson<LuloStatus>(key + LULO_SUFFIX).catch(() => null)));
        }
      }
      for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()));

      await withRegistry((r) => {
        for (const e of Object.values(r.entradas)) e.enBucket = videos.has(e.key);
        for (const key of videos) {
          if (!r.entradas[key] && !fbMod.has(key) && !luloMod.has(key)) continue;
          const e = (r.entradas[key] ??= foreignEntry(key));
          if (fb.has(key)) {
            const data = fb.get(key);
            if (data) e.feedback = data;
            e.feedbackModificado = fbMod.get(key);
          }
          if (st.has(key)) {
            applyLulo(e, st.get(key) ?? null);
            e.luloModificado = luloMod.get(key);
          }
        }
        r.ultimaSync = new Date().toISOString();
        delete r.errorSync;
      });
    } catch (err) {
      await withRegistry((r) => {
        r.errorSync = errorMessage(err, 'No se pudo leer el bucket de feedback.');
      }).catch(() => {});
    } finally {
      g.__luloFeedbackLastSync = Date.now();
      g.__luloFeedbackSync = null;
    }
  })();
  return g.__luloFeedbackSync;
}

function foreignEntry(key: string): FeedbackEntry {
  const slash = key.lastIndexOf('/');
  return { key, proyecto: slash > 0 ? key.slice(0, slash) : 'General', nombre: key.slice(slash + 1), origen: null, enBucket: true };
}

/** Lee del bucket solo un video (su feedback y su estado de Claude): 2 lecturas. */
export async function refreshEntry(key: string): Promise<FeedbackEntry> {
  if (!feedbackConfigured()) throw new FeedbackError('Falta configurar la app de feedback (FEEDBACK_R2_* en .env.local).', 503);
  const [data, st] = await Promise.all([
    getJson<Partial<FeedbackData>>(key + FEEDBACK_SUFFIX).then(normalize),
    getJson<LuloStatus>(key + LULO_SUFFIX),
  ]);
  return withRegistry((r) => {
    const e = (r.entradas[key] ??= foreignEntry(key));
    if (data) e.feedback = data;
    applyLulo(e, st);
    return { ...e };
  });
}

function normalize(raw: Partial<FeedbackData> | null): FeedbackData | null {
  if (!raw || typeof raw !== 'object') return null;
  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .filter((n) => n && Number.isFinite(Number(n.time)) && typeof n.text === 'string')
        .map((n) => ({
          id: String(n.id ?? ''),
          time: Number(n.time),
          text: n.text,
          ...(typeof n.autor === 'string' && n.autor.trim() ? { autor: n.autor.trim().slice(0, 60) } : {}),
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        }))
        .sort((a, b) => a.time - b.time)
    : [];
  const d = raw.decision;
  const decision: FeedbackDecision | null =
    d && (d.tipo === 'cambios' || d.tipo === 'aprobado') && typeof d.en === 'string' ? { tipo: d.tipo, en: d.en, ...(typeof d.por === 'string' && d.por ? { por: d.por.slice(0, 60) } : {}) } : null;
  return { general: typeof raw.general === 'string' ? raw.general : '', notes, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, decision };
}

// ── Leer ────────────────────────────────────────────────────────────────────

export async function listFeedback() {
  const r = await readRegistry();
  const entradas = Object.values(r.entradas).sort((a, b) => (b.feedback?.updatedAt ?? b.subidoEn ?? '').localeCompare(a.feedback?.updatedAt ?? a.subidoEn ?? ''));
  return { entradas, ultimaSync: r.ultimaSync ?? null, errorSync: r.errorSync ?? null, configurado: feedbackConfigured() };
}

export async function getEntry(key: string): Promise<FeedbackEntry> {
  const e = (await readRegistry()).entradas[key];
  if (!e) throw new FeedbackError('Ese video no está en la app de feedback.', 404);
  return e;
}

/** Entrada ya subida desde esta fuente (para el botón). No lanza si la fuente ya no existe. */
export async function entryForSource(
  source: FeedbackSource
): Promise<{ entry: FeedbackEntry | null; disponible: boolean; sugerido?: { proyecto: string; nombre: string }; error?: string }> {
  let r: Resolved;
  try {
    r = await resolveSource(source);
  } catch (err) {
    return { entry: null, disponible: false, error: errorMessage(err) };
  }
  const reg = await readRegistry();
  let entry = Object.values(reg.entradas).find((e) => e.fuente === r.fuente) ?? null;
  // Al mirar el video se lee su estado actual del bucket (2 lecturas), sin consultas periódicas
  if (entry && feedbackConfigured()) entry = await refreshEntry(entry.key).catch(() => entry);
  const ext = path.extname(r.ruta).toLowerCase() || '.mp4';
  return { entry, disponible: fs.existsSync(r.ruta), sugerido: { proyecto: segment(r.proyecto, 'Lulo Studio'), nombre: videoName(r.nombre, ext) } };
}

/** Todo lo subido desde una edición, producción o proyecto del estudio. */
export async function entriesForOrigin(servicio: FeedbackService, id: string): Promise<FeedbackEntry[]> {
  const reg = await readRegistry();
  return Object.values(reg.entradas).filter((e) => e.origen?.servicio === servicio && e.origen.id === id);
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

/** Mismo formato de texto que exporta la app de feedback (con la decisión y el autor de cada nota). */
export function feedbackText(e: FeedbackEntry): string {
  const fb = e.feedback ?? { general: '', notes: [], updatedAt: null };
  const lines = [`PROYECTO: ${e.proyecto}`, `VIDEO: ${e.nombre}`];
  if (fb.updatedAt) lines.push(`ACTUALIZADO: ${fb.updatedAt.replace('T', ' ').slice(0, 16)} UTC`);
  if (fb.decision) {
    lines.push(`DECISIÓN: ${fb.decision.tipo === 'cambios' ? 'Pide cambios' : 'Aprobado'}${fb.decision.por ? ` (${fb.decision.por})` : ''} · ${fb.decision.en.replace('T', ' ').slice(0, 16)} UTC`);
  }
  lines.push('', 'FEEDBACK GENERAL', fb.general.trim() || '(sin feedback general)', '', 'NOTAS POR TIEMPO');
  if (!fb.notes.length) lines.push('(sin notas)');
  for (const n of fb.notes) {
    const tc = `[${clock(n.time)}]${n.autor ? ` (${n.autor})` : ''}`;
    const [first, ...rest] = n.text.trim().split(/\r?\n/);
    lines.push(`${tc} ${first}`, ...rest.map((x) => `${' '.repeat(tc.length + 1)}${x}`));
  }
  if (e.respuesta) lines.push('', `TU RESPUESTA ANTERIOR (${e.respuesta.en.slice(0, 16).replace('T', ' ')} UTC)`, e.respuesta.texto);
  return lines.join('\n');
}

/** Resumen para Claude (herramientas de los agentes). */
export function entryForClaude(e: FeedbackEntry) {
  const estado = stateOf(e);
  return {
    key: e.key,
    video: `${e.proyecto} / ${e.nombre}`,
    estado: REVIEW_LABEL[estado],
    listoParaAplicar: estado === 'cambios_pedidos',
    deDonde: e.origen ? `${SERVICE_LABEL[e.origen.servicio]}${e.origen.version ? ` · v${e.origen.version}` : ''}` : 'Subido desde otro PC del equipo',
    archivoLocal: e.ruta && fs.existsSync(e.ruta) ? e.ruta : null,
    enlace: reviewUrl(e.key),
    claude: e.claude ?? null,
    versionNueva: e.siguiente ?? null,
    feedback: hasContent(e.feedback) || e.feedback?.decision ? feedbackText(e) : '(todavía sin feedback)',
  };
}

// ── Claude ──────────────────────────────────────────────────────────────────

/**
 * Claude toma los cambios pedidos de un video: lee las notas actuales del bucket, lo deja en
 * «Claude trabajando» (el equipo ya no puede editar las notas de esa versión) y devuelve la entrada.
 * Si ya estaba tomado, devuelve lo mismo sin cambiar nada (idempotente).
 */
export async function takeFeedback(key: string, destino: string, edicionId?: string): Promise<FeedbackEntry> {
  const fresh = await refreshEntry(key);
  const estado = stateOf(fresh);
  if (estado === 'en_proceso') return fresh;
  if (estado !== 'cambios_pedidos') {
    throw new FeedbackError(
      estado === 'por_revisar'
        ? 'El equipo todavía no pidió cambios en este video (sigue «Por revisar» en la app de feedback).'
        : estado === 'aprobado'
          ? 'El equipo aprobó este video: no hay cambios que hacer.'
          : estado === 'respondido'
            ? 'Claude ya respondió a estos cambios; el equipo tiene que revisarlo y volver a pedir cambios si hace falta.'
            : 'Este video ya tiene una versión nueva: el feedback se da sobre la nueva.',
      409
    );
  }
  const e = await withRegistry((r) => {
    const e = r.entradas[key]!;
    e.claude = { destino, tomadoEn: new Date().toISOString(), notas: e.feedback?.notes.length ?? 0, ...(edicionId ? { edicionId } : {}) };
    delete e.respuesta;
    return { ...e };
  });
  await writeLuloStatus(e);
  return e;
}

/** Claude deja su respuesta (nota por nota) para el equipo: el video pasa a «Claude respondió». */
export async function respondFeedback(key: string, texto: string): Promise<FeedbackEntry> {
  const e = await withRegistry((r) => {
    const e = r.entradas[key];
    if (!e) throw new FeedbackError('Ese video no está en la app de feedback.', 404);
    if (!e.claude) throw new FeedbackError('Primero toma el feedback con tomar_feedback.', 409);
    e.respuesta = { texto: texto.trim().slice(0, 4000), en: new Date().toISOString() };
    return { ...e };
  });
  await writeLuloStatus(e);
  return e;
}

function claudeMessage(e: FeedbackEntry, extra = ''): string {
  return [
    `📝 El equipo pidió cambios en «${e.nombre}» (${e.proyecto}) desde la app de feedback: ${reviewUrl(e.key)}`,
    `Los tiempos [mm:ss] son del video que se subió${extra}.`,
    '',
    feedbackText(e),
    '',
    `Revisa cada nota, aplica lo que se pueda con tus herramientas y deja lista una versión nueva. Al terminar, llama a responder_feedback (key: "${e.key}") con un resumen nota por nota de qué cambiaste y qué no se pudo (y por qué): el equipo lo leerá en la app de feedback. Si algo cuesta dinero, pide aprobación como siempre.`,
  ].join('\n');
}

/**
 * Lleva los cambios pedidos de un video al Claude que lo hizo:
 *  edición → su chat «Claude · editor»; producción → «Claude · director»; estudio → su chat;
 *  avatar / UGC / guion a video / proyectos → edición nueva con Claude a partir de ese video.
 */
export async function sendFeedbackToClaude(key: string, appUrl: string): Promise<{ destino: string; edicionId?: string }> {
  const e = await refreshEntry(key);
  if (stateOf(e) !== 'cambios_pedidos') await takeFeedback(key, 'Claude'); // lanza con el motivo
  const o = e.origen;

  if (o?.servicio === 'edicion' && o.id) {
    const { getEdit } = await import('@/lib/editor/edit-store');
    const { sendToClaude } = await import('@/lib/editor/claude-agent');
    const edit = await getEdit(o.id);
    const actual = edit.borrador?.version;
    const nota = actual && o.version && actual !== o.version ? ` (borrador v${o.version}; ojo: ahora vas por la v${actual}, ubica cada nota con palabras_borrador y lo que se dice)` : o.version ? ` (borrador v${o.version}: ubícalos con palabras_borrador)` : '';
    await sendToClaude(o.id, claudeMessage(e, nota), appUrl);
    await takeFeedback(key, 'Claude · editor');
    return { destino: `Claude · editor de «${edit.titulo}»` };
  }
  if (o?.servicio === 'director' && o.id) {
    const { sendToDirector } = await import('@/lib/director-mode/claude-director');
    await sendToDirector(o.id, claudeMessage(e, o.version ? ` (video final v${o.version})` : ''), appUrl);
    await takeFeedback(key, 'Claude · director');
    return { destino: 'Claude · director' };
  }
  if (o?.servicio === 'studio' && o.id) {
    const { sendToStudio } = await import('@/lib/studio/claude-studio');
    await sendToStudio(o.id, claudeMessage(e), appUrl);
    await takeFeedback(key, 'Estudio Claude');
    return { destino: `Estudio Claude · «${o.titulo}»` };
  }

  if (!e.ruta || !fs.existsSync(e.ruta)) {
    throw new FeedbackError('Este video se subió desde otro PC. Pídele a Claude en el Estudio Claude que revise el feedback pendiente.', 409);
  }
  const { sendToClaudeEditor } = await import('@/lib/editor/claude-handoff');
  const out = await sendToClaudeEditor({
    videoPath: e.ruta,
    titulo: `${path.parse(e.nombre).name} · feedback`,
    pedido: claudeMessage(e, ' (el video de esta edición es ese mismo video, antes de tus cambios)'),
  });
  if (!out) throw new FeedbackError('Para que Claude aplique el feedback elige «Claude · mi suscripción» en el selector IA de la barra superior.', 409);
  if ('error' in out) throw new FeedbackError(out.error, 500);
  await takeFeedback(key, 'Claude · editor (edición nueva)', out.id);
  return { destino: `Edición de video · «${out.titulo}»`, edicionId: out.id };
}

export { reviewUrl, feedbackConfigured };

// ── Para las herramientas de Claude ─────────────────────────────────────────

/** Videos con cambios pedidos que Claude aún no tomó (o todos los que tienen feedback, con `todos`). */
export async function feedbackForClaude(todos = false) {
  await syncFeedback(true);
  const { entradas, errorSync } = await listFeedback();
  const list = entradas
    .filter((e) => e.enBucket !== false && (todos ? hasContent(e.feedback) || e.feedback?.decision : stateOf(e) === 'cambios_pedidos'))
    .map(entryForClaude);
  return {
    videos: list,
    ...(list.length ? {} : { nota: todos ? 'No hay videos con feedback.' : 'Ningún video tiene cambios pedidos ahora mismo.' }),
    ...(errorSync ? { aviso: errorSync } : {}),
  };
}

/** Feedback de lo subido desde una edición, producción o proyecto del estudio. */
export async function originFeedbackForClaude(servicio: FeedbackService, id: string) {
  const list = await Promise.all(
    (await entriesForOrigin(servicio, id)).filter((e) => e.enBucket !== false).map((e) => refreshEntry(e.key).catch(() => e))
  );
  return list.length
    ? { videos: list.map(entryForClaude) }
    : { videos: [], nota: 'Todavía no se ha subido ningún video de aquí a la app de feedback (botón «Subir a Feedback» debajo del video).' };
}

function assertOrigin(e: FeedbackEntry, origin?: { servicio: FeedbackService; id: string }) {
  if (origin && (e.origen?.servicio !== origin.servicio || e.origen.id !== origin.id)) throw new FeedbackError('Ese video no es de este proyecto.', 403);
}

/** tomar_feedback: deja el video en «Claude trabajando» y devuelve las notas para aplicarlas. */
export async function takeFeedbackFromAgent(key: string, destino: string, origin?: { servicio: FeedbackService; id: string }) {
  assertOrigin(await getEntry(key), origin);
  const e = await takeFeedback(key, destino);
  return { ...entryForClaude(e), siguientePaso: 'Aplica cada nota, deja lista la versión nueva y termina con responder_feedback.' };
}

/** responder_feedback: la respuesta de Claude para el equipo. */
export async function respondFromAgent(key: string, texto: string, origin?: { servicio: FeedbackService; id: string }) {
  assertOrigin(await getEntry(key), origin);
  const e = await respondFeedback(key, texto);
  return { ok: true, key, estado: REVIEW_LABEL[stateOf(e)], nota: 'El equipo verá tu respuesta en la app de feedback. Si hay versión nueva, súbela (botón «Subir a Feedback» o subir_a_feedback).' };
}
