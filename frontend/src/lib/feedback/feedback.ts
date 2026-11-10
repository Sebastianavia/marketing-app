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
 * Lulo Studio ↔ app de feedback.
 *  - subir: un video final o borrador de cualquier servicio → R2 (`<Proyecto>/<video>.mp4`).
 *  - sincronizar: lee del bucket el feedback que deja el equipo (`<video>.feedback.json`) y lo guarda
 *    en `<datos>/feedback/registro.json` (cada 3 min en segundo plano y al abrir la bandeja).
 *  - enviar a Claude: manda las notas al Claude que hizo ese video (editor, director, estudio) o, si
 *    vino de otra herramienta, abre una edición nueva con Claude para aplicarlas.
 * La app de feedback ve en `<video>.lulo.json` (metadatos) cuándo Claude recogió las notas y si hay versión nueva.
 */

export interface FeedbackNote {
  id: string;
  time: number;
  text: string;
  createdAt?: string;
  updatedAt?: string;
}
export interface FeedbackData {
  general: string;
  notes: FeedbackNote[];
  updatedAt: string | null;
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
  /** LastModified del .feedback.json la última vez que se leyó. */
  feedbackModificado?: string;
  /** feedback.updatedAt que ya recibió Claude (o que se marcó como revisado). */
  revisadoEn?: string;
  claude?: { destino: string; en: string; edicionId?: string; notas: number };
  /** Clave de la versión nueva de este mismo video. */
  siguiente?: string;
}

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

const g = globalThis as unknown as { __luloFeedbackLock?: Promise<unknown>; __luloFeedbackSync?: Promise<void> | null; __luloFeedbackLastSync?: number; __luloFeedbackTimer?: NodeJS.Timeout };

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
/** Hay notas que Claude todavía no recibió. */
export const isNew = (e: FeedbackEntry) => hasContent(e.feedback) && Boolean(e.feedback?.updatedAt) && e.feedback!.updatedAt! > (e.revisadoEn ?? '');

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
  ...(e.claude ? { claude: e.claude.en, destino: e.claude.destino, notas: String(e.claude.notas) } : {}),
  ...(e.siguiente ? { siguiente: e.siguiente } : {}),
});

/** Escribe `<video>.lulo.json`: la app de feedback lo lee de los metadatos del listado (sin descargarlo). */
async function writeLuloStatus(e: FeedbackEntry) {
  const meta = luloMeta(e);
  if (!Object.keys(meta).length) return;
  await putJson(e.key + LULO_SUFFIX, { origen: e.origen, claude: e.claude ?? null, siguiente: e.siguiente ?? null }, meta);
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
    // Mismo video subido otra vez: la app de feedback conserva sus notas; lo nuevo para Claude empieza desde aquí
    if (old?.feedback?.updatedAt) entry.revisadoEn = old.feedback.updatedAt;
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

/** Lee del bucket el feedback de todos los videos. Una sola a la vez; como mucho cada 15 s salvo `force`. */
export function syncFeedback(force = false): Promise<void> {
  if (!feedbackConfigured()) return Promise.resolve();
  if (g.__luloFeedbackSync) return g.__luloFeedbackSync;
  if (!force && g.__luloFeedbackLastSync && Date.now() - g.__luloFeedbackLastSync < 15_000) return Promise.resolve();
  g.__luloFeedbackSync = (async () => {
    try {
      const objects = await listAll();
      const videos = new Set<string>();
      const fbMod = new Map<string, string>();
      for (const o of objects) {
        if (!o.Key) continue;
        if (o.Key.endsWith(FEEDBACK_SUFFIX)) fbMod.set(o.Key.slice(0, -FEEDBACK_SUFFIX.length), o.LastModified?.toISOString() ?? '');
        else if (VIDEO_EXT.test(o.Key)) videos.add(o.Key);
      }
      const reg = await readRegistry();
      // Solo se descargan los .feedback.json que cambiaron desde la última vez
      const toFetch = [...fbMod].filter(([key, mod]) => videos.has(key) && reg.entradas[key]?.feedbackModificado !== mod);
      const fetched = new Map<string, FeedbackData | null>();
      for (let i = 0; i < toFetch.length; i += 8) {
        await Promise.all(
          toFetch.slice(i, i + 8).map(async ([key]) => {
            fetched.set(key, normalize(await getJson<Partial<FeedbackData>>(key + FEEDBACK_SUFFIX).catch(() => null)));
          })
        );
      }
      await withRegistry((r) => {
        for (const e of Object.values(r.entradas)) e.enBucket = videos.has(e.key);
        for (const [key, mod] of fbMod) {
          if (!videos.has(key) || !fetched.has(key)) continue;
          const slash = key.lastIndexOf('/');
          const e = (r.entradas[key] ??= {
            key,
            proyecto: slash > 0 ? key.slice(0, slash) : 'General',
            nombre: key.slice(slash + 1),
            origen: null,
            enBucket: true,
          });
          const fb = fetched.get(key);
          if (fb) e.feedback = fb;
          e.feedbackModificado = mod;
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

function normalize(raw: Partial<FeedbackData> | null): FeedbackData | null {
  if (!raw || typeof raw !== 'object') return null;
  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .filter((n) => n && Number.isFinite(Number(n.time)) && typeof n.text === 'string')
        .map((n) => ({ id: String(n.id ?? ''), time: Number(n.time), text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt }))
        .sort((a, b) => a.time - b.time)
    : [];
  return { general: typeof raw.general === 'string' ? raw.general : '', notes, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null };
}

/** Arranca la lectura periódica del bucket (cada 3 min). Lo llama instrumentation.ts. */
export function startFeedbackPoller() {
  if (g.__luloFeedbackTimer || !feedbackConfigured()) return;
  g.__luloFeedbackTimer = setInterval(() => void syncFeedback(), 3 * 60_000);
  g.__luloFeedbackTimer.unref?.();
  setTimeout(() => void syncFeedback(), 10_000).unref?.();
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
  const entry = Object.values(reg.entradas).find((e) => e.fuente === r.fuente) ?? null;
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

/** Mismo formato de texto que exporta la app de feedback. */
export function feedbackText(e: FeedbackEntry): string {
  const fb = e.feedback ?? { general: '', notes: [], updatedAt: null };
  const lines = [`PROYECTO: ${e.proyecto}`, `VIDEO: ${e.nombre}`];
  if (fb.updatedAt) lines.push(`ACTUALIZADO: ${fb.updatedAt.replace('T', ' ').slice(0, 16)} UTC`);
  lines.push('', 'FEEDBACK GENERAL', fb.general.trim() || '(sin feedback general)', '', 'NOTAS POR TIEMPO');
  if (!fb.notes.length) lines.push('(sin notas)');
  for (const n of fb.notes) {
    const tc = `[${clock(n.time)}]`;
    const [first, ...rest] = n.text.trim().split(/\r?\n/);
    lines.push(`${tc} ${first}`, ...rest.map((x) => `${' '.repeat(tc.length + 1)}${x}`));
  }
  return lines.join('\n');
}

/** Resumen para Claude (herramientas de los agentes). */
export function entryForClaude(e: FeedbackEntry) {
  return {
    key: e.key,
    video: `${e.proyecto} / ${e.nombre}`,
    deDonde: e.origen ? `${SERVICE_LABEL[e.origen.servicio]}${e.origen.version ? ` · v${e.origen.version}` : ''}` : 'Subido por otra persona del equipo',
    archivoLocal: e.ruta && fs.existsSync(e.ruta) ? e.ruta : null,
    enlace: reviewUrl(e.key),
    nuevo: isNew(e),
    yaRecibidoPorClaude: e.claude ?? null,
    versionNueva: e.siguiente ?? null,
    feedback: hasContent(e.feedback) ? feedbackText(e) : '(todavía sin feedback)',
  };
}

// ── Claude ──────────────────────────────────────────────────────────────────

/** Marca el feedback actual como recibido por Claude y lo avisa en la app de feedback. */
export async function markReviewed(key: string, destino: string, edicionId?: string): Promise<FeedbackEntry> {
  const e = await withRegistry((r) => {
    const e = r.entradas[key];
    if (!e) throw new FeedbackError('Ese video no está en la app de feedback.', 404);
    e.revisadoEn = e.feedback?.updatedAt ?? new Date().toISOString();
    e.claude = { destino, en: new Date().toISOString(), notas: e.feedback?.notes.length ?? 0, ...(edicionId ? { edicionId } : {}) };
    return { ...e };
  });
  await writeLuloStatus(e).catch(() => {});
  return e;
}

function claudeMessage(e: FeedbackEntry, extra = ''): string {
  return [
    `📝 Feedback del equipo sobre «${e.nombre}» (${e.proyecto}), dejado en la app de feedback: ${reviewUrl(e.key)}`,
    `Los tiempos [mm:ss] son del video que se subió${extra}.`,
    '',
    feedbackText(e),
    '',
    'Revisa cada nota, aplica lo que se pueda con tus herramientas y deja lista una versión nueva. Al terminar, resume nota por nota qué cambiaste y qué no se pudo (y por qué). Si algo cuesta dinero, pide aprobación como siempre.',
  ].join('\n');
}

/**
 * Lleva el feedback de un video al Claude que lo hizo:
 *  edición → su chat «Claude · editor»; producción → «Claude · director»; estudio → su chat;
 *  avatar / UGC / guion a video / proyectos → edición nueva con Claude a partir de ese video.
 */
export async function sendFeedbackToClaude(key: string, appUrl: string): Promise<{ destino: string; edicionId?: string }> {
  await syncFeedback(true);
  const e = await getEntry(key);
  if (!hasContent(e.feedback)) throw new FeedbackError('Ese video todavía no tiene notas.', 409);
  const o = e.origen;

  if (o?.servicio === 'edicion' && o.id) {
    const { getEdit } = await import('@/lib/editor/edit-store');
    const { sendToClaude } = await import('@/lib/editor/claude-agent');
    const edit = await getEdit(o.id);
    const actual = edit.borrador?.version;
    const nota = actual && o.version && actual !== o.version ? ` (borrador v${o.version}; ojo: ahora vas por la v${actual}, ubica cada nota con palabras_borrador y lo que se dice)` : o.version ? ` (borrador v${o.version}: ubícalos con palabras_borrador)` : '';
    await sendToClaude(o.id, claudeMessage(e, nota), appUrl);
    await markReviewed(key, 'Claude · editor');
    return { destino: `Claude · editor de «${edit.titulo}»` };
  }
  if (o?.servicio === 'director' && o.id) {
    const { sendToDirector } = await import('@/lib/director-mode/claude-director');
    await sendToDirector(o.id, claudeMessage(e, o.version ? ` (video final v${o.version})` : ''), appUrl);
    await markReviewed(key, 'Claude · director');
    return { destino: 'Claude · director' };
  }
  if (o?.servicio === 'studio' && o.id) {
    const { sendToStudio } = await import('@/lib/studio/claude-studio');
    await sendToStudio(o.id, claudeMessage(e), appUrl);
    await markReviewed(key, 'Estudio Claude');
    return { destino: `Estudio Claude · «${o.titulo}»` };
  }

  if (!e.ruta || !fs.existsSync(e.ruta)) {
    throw new FeedbackError('Este video no está en este equipo (lo subió otra persona). Pide a Claude en el Estudio Claude que lea el feedback pendiente.', 409);
  }
  const { sendToClaudeEditor } = await import('@/lib/editor/claude-handoff');
  const out = await sendToClaudeEditor({
    videoPath: e.ruta,
    titulo: `${path.parse(e.nombre).name} · feedback`,
    pedido: claudeMessage(e, ' (el video de esta edición es ese mismo video, antes de tus cambios)'),
  });
  if (!out) throw new FeedbackError('Para que Claude aplique el feedback elige «Claude · mi suscripción» en el selector IA de la barra superior.', 409);
  if ('error' in out) throw new FeedbackError(out.error, 500);
  await markReviewed(key, 'Claude · editor (edición nueva)', out.id);
  return { destino: `Edición de video · «${out.titulo}»`, edicionId: out.id };
}

export { reviewUrl, feedbackConfigured };

// ── Para las herramientas de Claude ─────────────────────────────────────────

/** Videos con feedback que Claude todavía no recibió (o todos los que tienen notas, con `todos`). */
export async function feedbackForClaude(todos = false) {
  await syncFeedback(true);
  const { entradas, errorSync } = await listFeedback();
  const list = entradas.filter((e) => e.enBucket !== false && (todos ? hasContent(e.feedback) : isNew(e))).map(entryForClaude);
  return { videos: list, ...(errorSync ? { aviso: errorSync } : {}) };
}

/** Feedback de lo subido desde una edición, producción o proyecto del estudio. */
export async function originFeedbackForClaude(servicio: FeedbackService, id: string) {
  await syncFeedback(true);
  const list = (await entriesForOrigin(servicio, id)).filter((e) => e.enBucket !== false).map(entryForClaude);
  return list.length ? { videos: list } : { videos: [], nota: 'Todavía no se ha subido ningún video de aquí a la app de feedback (botón «Subir a Feedback» debajo del video).' };
}

/** Marca como revisado solo si el video es de ese origen (para los agentes de una edición o producción). */
export async function markReviewedFromAgent(key: string, destino: string, origin?: { servicio: FeedbackService; id: string }) {
  const e = await getEntry(key);
  if (origin && (e.origen?.servicio !== origin.servicio || e.origen.id !== origin.id)) {
    throw new FeedbackError('Ese video no es de este proyecto.', 403);
  }
  const done = await markReviewed(key, destino);
  return { ok: true, key, recibidoEn: done.claude?.en };
}
