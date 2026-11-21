import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';
import { sttCost } from '@/config/cost-rates';
import { resolveMode } from '@/lib/ai/orchestrator';
import { cancelResume, getResume } from '@/lib/ai/claude-code/quota-resume';
import { validateMaterialFolder, setMaterialFolder } from '@/lib/material/material';
import { keepAwake, releaseAwake } from '@/lib/system/keep-awake';
import { createEdit, NewEditMetaSchema, VIDEO_EXTENSIONS } from '@/lib/editor/actions';
import { EditError, getEdit, logActivity, updateEdit } from '@/lib/editor/edit-store';
import { getProfile } from './profile-store';
import { probeVideo } from './media';
import { getEnvSettings } from './python-env';
import { isTurnActive, sendToClaude, startClaudeFirstPass } from '@/lib/editor/claude-agent';
import { defaultAppUrl } from '@/lib/ai/claude-code/agent-runner';

/**
 * Lotes nocturnos del editor: una instrucción general + una carpeta de videos → una edición por
 * video, trabajadas por Claude VARIAS A LA VEZ (espacios) y POR TURNOS (round robin).
 *
 *  - Ronda 1: todas las ediciones reciben su primer pase (cortes, plan, render, revisión).
 *  - Rondas 2…pasadasMax: solo las que no llegan a la nota objetivo, con las mejoras que más suben.
 *  - El siguiente turno es siempre el de la edición con menos pasadas y que más tiempo lleva
 *    esperando; cuando una termina su turno, vuelve al final de la cola.
 *  - Lo pesado (renders, HyperFrames, pista de persona, Whisper…) hace cola en heavy-queue.ts.
 *  - Sin cupo de Claude, el lote entero se pausa hasta que se libere (no lanza turnos que fallarían).
 *  - Mientras corre, el PC no se duerme (keep-awake.ts). Solo con la app abierta.
 *  - Los videos se van preparando (copiar + transcribir) un poco por delante de Claude, así no se
 *    paga la transcripción de videos a los que no se llegó antes de la hora límite.
 *
 * Archivos: `<datos>/lotes/<id>.json`. El planificador arranca en instrumentation.ts y retoma los
 * lotes al reiniciar.
 */

export type BatchState = 'activo' | 'pausado' | 'sin_cupo' | 'terminado' | 'cancelado';
export type BatchItemState = 'pendiente' | 'preparando' | 'esperando' | 'trabajando' | 'listo' | 'sin_terminar' | 'error';

export interface BatchItem {
  id: string;
  /** Ruta completa del video original (no se toca: la edición trabaja sobre una copia). */
  ruta: string;
  nombre: string;
  duracion: number;
  /** Instrucción propia del video (archivo `<nombre>.txt` junto al video). */
  instruccionPropia?: string;
  editId?: string;
  estado: BatchItemState;
  /** Turnos de Claude terminados bien (1 = primer pase). */
  pasadas: number;
  nota?: number;
  /** El último turno se cortó por cupo: el siguiente turno es «continúa», no una pasada nueva. */
  continuar?: boolean;
  fallos: number;
  error?: string;
  ultimoTurno?: string;
  turnoDesde?: string;
}

export interface Batch {
  id: string;
  titulo: string;
  creado: string;
  actualizado: string;
  instruccion: string;
  carpeta: string;
  perfilId: string;
  marcaId?: string;
  espacios: number;
  pasadasMax: number;
  notaObjetivo: number;
  /** ISO: a partir de aquí no empieza turnos nuevos. */
  horaLimite?: string;
  /** Lo que se aprobó gastar (transcripción). */
  presupuestoUSD: number;
  transcriptor: 'elevenlabs' | 'whisper';
  estado: BatchState;
  /** Con estado 'sin_cupo': cuándo se sigue. */
  pausaHasta?: string;
  items: BatchItem[];
  terminado?: string;
  registro: Array<{ t: string; msg: string }>;
}

export const BATCH_LIMITS = { maxVideos: 60, maxEspacios: 4, maxPasadas: 4 };
/** Fallos seguidos (que no son de cupo) antes de dar un video por perdido. */
const MAX_FALLOS = 2;
/** Videos preparados (transcritos) por delante de los espacios. */
const PREPARE_AHEAD = 2;
const TICK_MS = 10_000;

const dir = () => path.join(/*turbopackIgnore: true*/ getDataDir(), 'lotes');
const file = (id: string) => path.join(/*turbopackIgnore: true*/ dir(), `${id}.json`);

// ── Almacén con candado (el planificador y la pantalla escriben a la vez) ────────────────────

const g = globalThis as unknown as { __luloBatch?: { lock: Promise<unknown>; timer?: ReturnType<typeof setInterval>; busy?: boolean } };
const state = (g.__luloBatch ??= { lock: Promise.resolve() });

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = state.lock.then(fn, fn);
  state.lock = run.catch(() => undefined);
  return run;
}

async function readBatch(id: string): Promise<Batch> {
  if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new EditError('Lote no válido.', 400);
  try {
    return JSON.parse(await fs.readFile(file(id), 'utf8')) as Batch;
  } catch {
    throw new EditError('Lote no encontrado.', 404);
  }
}

async function saveBatch(b: Batch) {
  b.actualizado = new Date().toISOString();
  await fs.mkdir(dir(), { recursive: true });
  await writeJsonAtomic(file(b.id), b);
}

export async function updateBatch<T>(id: string, fn: (b: Batch) => T | Promise<T>): Promise<{ batch: Batch; result: T }> {
  return withLock(async () => {
    const b = await readBatch(id);
    const result = await fn(b);
    await saveBatch(b);
    return { batch: b, result };
  });
}

function log(b: Batch, msg: string) {
  b.registro.push({ t: new Date().toISOString(), msg });
  if (b.registro.length > 200) b.registro.splice(0, b.registro.length - 200);
}

export async function getBatch(id: string): Promise<Batch> {
  return readBatch(id);
}

export async function listBatches(): Promise<Batch[]> {
  const names = await fs.readdir(dir()).catch(() => [] as string[]);
  const list: Batch[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      list.push(JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ dir(), n), 'utf8')) as Batch);
    } catch {
      // archivo a medias o dañado: se ignora
    }
  }
  return list.sort((a, b) => b.creado.localeCompare(a.creado));
}

// ── Crear ─────────────────────────────────────────────────────────────────────

export const BatchInputSchema = z.object({
  titulo: z.string().trim().max(80).default(''),
  instruccion: z.string().trim().min(5, 'Escribe la instrucción para Claude.').max(30000),
  carpeta: z.string().trim().min(2).max(1000),
  perfilId: z.string().min(6, 'Elige un estilo.'),
  marcaId: z.string().max(20).optional(),
  espacios: z.number().int().min(1).max(BATCH_LIMITS.maxEspacios).default(2),
  pasadasMax: z.number().int().min(1).max(BATCH_LIMITS.maxPasadas).default(2),
  notaObjetivo: z.number().int().min(0).max(100).default(75),
  /** "HH:MM" en la hora de este PC (la próxima vez que llegue esa hora). */
  horaLimite: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora límite no válida (HH:MM).')
    .optional(),
  /** Videos elegidos (nombres de archivo); vacío = todos los de la carpeta. */
  archivos: z.array(z.string().max(260)).max(BATCH_LIMITS.maxVideos).optional(),
});
export type BatchInput = z.infer<typeof BatchInputSchema>;

export interface BatchPreview {
  carpeta: string;
  videos: Array<{ nombre: string; duracion: number; instruccionPropia: boolean; problema?: string }>;
  segundos: number;
  transcriptor: 'elevenlabs' | 'whisper';
  costoUSD: number;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Mira la carpeta: videos (solo el primer nivel), duración, si tienen instrucción propia y el costo. */
export async function previewBatch(carpeta: string, archivos?: string[]): Promise<BatchPreview> {
  const real = await validateMaterialFolder(carpeta);
  const entries = await fs.readdir(real, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && VIDEO_EXTENSIONS.includes(path.extname(e.name).toLowerCase()) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((n) => !archivos?.length || archivos.includes(n))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  if (!names.length) throw new EditError('No hay videos en esa carpeta (mp4, mov, m4v, webm, mkv, avi).', 400);
  if (names.length > BATCH_LIMITS.maxVideos) throw new EditError(`Hay ${names.length} videos: el máximo por lote es ${BATCH_LIMITS.maxVideos}.`, 400);
  const names2 = new Set(entries.map((e) => e.name));
  const videos: BatchPreview['videos'] = [];
  for (const nombre of names) {
    const txt = `${path.parse(nombre).name}.txt`;
    try {
      const info = await probeVideo(path.join(/*turbopackIgnore: true*/ real, nombre));
      const problema = !info.tieneVideo
        ? 'no tiene imagen'
        : !info.tieneAudio
          ? 'no tiene audio'
          : info.duracion < 1
            ? 'demasiado corto'
            : info.duracion > 30 * 60
              ? 'dura más de 30 min'
              : undefined;
      videos.push({ nombre, duracion: Math.round(info.duracion * 10) / 10, instruccionPropia: names2.has(txt), ...(problema ? { problema } : {}) });
    } catch {
      videos.push({ nombre, duracion: 0, instruccionPropia: names2.has(txt), problema: 'no se pudo leer' });
    }
  }
  const segundos = videos.filter((v) => !v.problema).reduce((s, v) => s + v.duracion, 0);
  const transcriptor = (await getEnvSettings()).transcriptor === 'whisper' ? 'whisper' : 'elevenlabs';
  return { carpeta: real, videos, segundos, transcriptor, costoUSD: transcriptor === 'whisper' ? 0 : round(sttCost(segundos)) };
}

function nextLocalTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now() + 60_000) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Crea el lote. `montoVisto` = el costo que la persona vio y aprobó (si cambió, 409). */
export async function createBatch(input: BatchInput, montoVisto: number): Promise<Batch> {
  const mode = await resolveMode();
  if (mode !== 'claude-subscription' && mode !== 'claude-apikey') {
    throw new EditError('Los lotes los edita Claude: elige «Claude · mi suscripción» en el selector IA de la barra superior.', 400);
  }
  await getProfile(input.perfilId);
  const pv = await previewBatch(input.carpeta, input.archivos);
  if (Math.abs(pv.costoUSD - montoVisto) > 0.0011) {
    throw new EditError(`El costo cambió ($${pv.costoUSD.toFixed(3)}): revísalo y vuelve a aprobar.`, 409);
  }
  const ok = pv.videos.filter((v) => !v.problema);
  if (!ok.length) throw new EditError('Ninguno de los videos sirve (revisa los problemas de la lista).', 400);
  const now = new Date().toISOString();
  const items: BatchItem[] = [];
  for (const v of pv.videos) {
    let propia: string | undefined;
    if (v.instruccionPropia) {
      propia = (await fs.readFile(path.join(/*turbopackIgnore: true*/ pv.carpeta, `${path.parse(v.nombre).name}.txt`), 'utf8').catch(() => '')).trim().slice(0, 8000) || undefined;
    }
    items.push({
      id: randomUUID().slice(0, 8),
      ruta: path.join(/*turbopackIgnore: true*/ pv.carpeta, v.nombre),
      nombre: v.nombre,
      duracion: v.duracion,
      ...(propia ? { instruccionPropia: propia } : {}),
      estado: v.problema ? 'error' : 'pendiente',
      pasadas: 0,
      fallos: 0,
      ...(v.problema ? { error: `Se omite: ${v.problema}.` } : {}),
    });
  }
  const b: Batch = {
    id: `lote-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`,
    titulo: input.titulo || `Lote ${path.basename(pv.carpeta)}`,
    creado: now,
    actualizado: now,
    instruccion: input.instruccion,
    carpeta: pv.carpeta,
    perfilId: input.perfilId,
    ...(input.marcaId ? { marcaId: input.marcaId } : {}),
    espacios: input.espacios,
    pasadasMax: input.pasadasMax,
    notaObjetivo: input.notaObjetivo,
    ...(input.horaLimite ? { horaLimite: nextLocalTime(input.horaLimite) } : {}),
    presupuestoUSD: pv.costoUSD,
    transcriptor: pv.transcriptor,
    estado: 'activo',
    items,
    registro: [],
  };
  log(b, `Lote creado: ${ok.length} videos, ${b.espacios} a la vez, hasta ${b.pasadasMax} pasadas (nota objetivo ${b.notaObjetivo}).`);
  await withLock(() => saveBatch(b));
  kickBatchRunner();
  return b;
}

// ── Acciones de la persona ──────────────────────────────────────────────────

export async function batchAction(id: string, accion: 'pausar' | 'seguir' | 'cancelar' | 'reintentar'): Promise<Batch> {
  const { batch } = await updateBatch(id, (b) => {
    if (accion === 'pausar') {
      if (b.estado !== 'activo' && b.estado !== 'sin_cupo') throw new EditError('El lote no está en marcha.', 409);
      b.estado = 'pausado';
      log(b, 'Pausado: los turnos en curso terminan y no empiezan otros.');
    } else if (accion === 'seguir') {
      if (b.estado !== 'pausado' && b.estado !== 'terminado') throw new EditError('El lote no está pausado.', 409);
      b.estado = 'activo';
      b.terminado = undefined;
      // Seguir un lote terminado por la hora límite: lo que quedó sin terminar vuelve a la cola
      for (const it of b.items) if (it.estado === 'sin_terminar') it.estado = it.editId ? 'esperando' : 'pendiente';
      if (b.horaLimite && Date.parse(b.horaLimite) <= Date.now()) b.horaLimite = undefined;
      log(b, 'Sigue.');
    } else if (accion === 'cancelar') {
      if (b.estado === 'cancelado') return;
      b.estado = 'cancelado';
      b.terminado = new Date().toISOString();
      for (const it of b.items) if (['pendiente', 'esperando'].includes(it.estado)) it.estado = 'sin_terminar';
      log(b, 'Cancelado: los turnos en curso terminan solos; no empiezan otros.');
    } else {
      let n = 0;
      for (const it of b.items) {
        if (it.estado === 'error' && !it.error?.startsWith('Se omite')) {
          it.estado = it.editId ? 'esperando' : 'pendiente';
          it.fallos = 0;
          it.error = undefined;
          n++;
        }
      }
      if (!n) throw new EditError('No hay videos con error para reintentar.', 409);
      if (b.estado === 'terminado') {
        b.estado = 'activo';
        b.terminado = undefined;
      }
      log(b, `Reintentar ${n} video(s) con error.`);
    }
  });
  kickBatchRunner();
  return batch;
}

// ── Mensajes para Claude ────────────────────────────────────────────────────

const UNATTENDED = `MODO LOTE (sin nadie mirando, probablemente de noche):
- No hagas preguntas ni esperes respuesta: decide tú con criterio y anota en tu respuesta final lo que habrías preguntado.
- No pidas aprobaciones de gasto (pedir_aprobacion): nadie puede aprobarlas. Usa solo lo que es gratis.
- Termina el pedido completo en este turno: render, revisión y correcciones.
- Sé eficiente: el cupo de Claude se comparte con otros videos del lote.`;

function firstPassPedido(b: Batch, it: BatchItem): string {
  return [
    UNATTENDED,
    `Instrucción general del lote «${b.titulo}»:\n${b.instruccion}`,
    it.instruccionPropia ? `Instrucción propia de este video (${it.nombre}), manda sobre la general si chocan:\n${it.instruccionPropia}` : '',
    `La carpeta del lote (${b.carpeta}) es tu carpeta de material: puede tener tomas de apoyo, logos o textos útiles.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function improveMessage(b: Batch, it: BatchItem): Promise<string> {
  const p = await getEdit(it.editId!);
  const nota = p.borrador?.nota;
  return `${UNATTENDED}

Pasada ${it.pasadas + 1} de ${b.pasadasMax} del lote. El borrador actual tiene nota ${nota?.total ?? '—'}/100 y el objetivo es ${b.notaObjetivo}.
${nota?.mejoras?.length ? `Lo que más sube la nota:\n${nota.mejoras.map((m) => `- ${m}`).join('\n')}` : 'Revisa el borrador con ojo crítico (mira y escucha) y mejora lo que más afecte a la retención.'}
Aplica las mejoras, vuelve a renderizar, publica el borrador nuevo y comprueba la nota con puntuar_borrador. No cambies lo que ya funciona ni contradigas la instrucción del lote:
${b.instruccion.slice(0, 2000)}`;
}

const CONTINUE_MESSAGE = `${UNATTENDED}

Tu turno anterior se cortó porque se agotó el cupo de Claude; ya volvió. Continúa exactamente donde ibas: revisa qué quedó hecho (ver_edicion) y termina sin repetir lo que ya está.`;

// ── Planificador ───────────────────────────────────────────────────────────

const FINAL: BatchItemState[] = ['listo', 'sin_terminar', 'error'];

/** Resultado del último turno de Claude de una edición. */
async function lastTurnOutcome(
  editId: string
): Promise<{ ok: boolean; cupo: boolean; interrumpido: boolean; error?: string; nota?: number; tieneBorrador: boolean; resumeEn?: string }> {
  const p = await getEdit(editId);
  const msgs = p.claude?.mensajes ?? [];
  const last = [...msgs].reverse().find((m) => m.rol === 'claude');
  const resume = await getResume(`edit:${editId}`);
  // Respaldo: el aviso de cupo en el chat aunque la reanudación no se haya podido apuntar
  const cupoTexto = Boolean(last?.error && /Se agotó el cupo/i.test(last.texto));
  const resumeEn = resume?.en ?? (cupoTexto ? new Date(Date.now() + 30 * 60_000).toISOString() : undefined);
  return {
    // La app se cerró a mitad del turno: el último mensaje es el pedido, sin respuesta de Claude
    interrumpido: msgs.length > 0 && msgs[msgs.length - 1].rol === 'usuario',
    ok: Boolean(last && !last.error),
    cupo: Boolean(resume) || cupoTexto,
    resumeEn,
    error: last?.error ? last.texto.split('⚠️').pop()?.trim().slice(0, 300) : undefined,
    nota: p.borrador?.nota?.total,
    tieneBorrador: Boolean(p.borrador),
  };
}

async function prepareItem(b: Batch, it: BatchItem) {
  const meta = NewEditMetaSchema.parse({
    titulo: path.parse(it.nombre).name.slice(0, 80),
    pedido: firstPassPedido(b, it).slice(0, 30000),
    perfilId: b.perfilId,
    revisarAntes: false,
    rutaLocal: it.ruta,
    ...(b.marcaId ? { marcaId: b.marcaId } : {}),
  });
  const edit = await createEdit(meta, null, { fueraDeProyectos: true, loteId: b.id });
  await setMaterialFolder(`edit:${edit.id}`, b.carpeta).catch(() => null);
  return edit.id;
}

async function stepBatch(id: string) {
  // Lo que toca hacer se decide con el candado; los turnos y las ediciones se lanzan fuera
  const todo = await updateBatch(id, async (b) => {
    const actions: Array<{ kind: 'prepare' | 'first' | 'improve' | 'continue'; item: BatchItem }> = [];
    if (b.estado === 'sin_cupo' && b.pausaHasta && Date.parse(b.pausaHasta) <= Date.now()) {
      b.estado = 'activo';
      b.pausaHasta = undefined;
      log(b, 'Volvió el cupo de Claude: sigue el lote.');
    }
    const now = Date.now();
    const pastLimit = Boolean(b.horaLimite && Date.parse(b.horaLimite) <= now);

    // 1. Sincronizar cada video con su edición
    for (const it of b.items) {
      if (!it.editId || FINAL.includes(it.estado)) continue;
      let p;
      try {
        p = await getEdit(it.editId);
      } catch {
        it.estado = 'error';
        it.error = 'La edición se borró.';
        continue;
      }
      if (it.estado === 'preparando') {
        if (p.estado === 'error') {
          it.estado = 'error';
          it.error = p.error?.mensaje ?? 'No se pudo preparar el video.';
          log(b, `${it.nombre}: ${it.error}`);
        } else if (p.transcripcion && !p.tarea) {
          it.estado = 'esperando';
        }
      } else if (it.estado === 'trabajando' && !isTurnActive(it.editId)) {
        const r = await lastTurnOutcome(it.editId);
        it.ultimoTurno = new Date().toISOString();
        it.turnoDesde = undefined;
        if (r.interrumpido && !r.cupo) {
          it.continuar = true;
          it.estado = 'esperando';
          log(b, `${it.nombre}: el turno quedó a medias (¿se cerró la app?); sigue donde iba.`);
        } else if (r.cupo) {
          // El lote se encarga de seguir: se quita la reanudación suelta de esta edición
          await cancelResume(`edit:${it.editId}`);
          it.continuar = true;
          it.estado = 'esperando';
          if (b.estado === 'activo') {
            b.estado = 'sin_cupo';
            b.pausaHasta = r.resumeEn;
            log(b, `Sin cupo de Claude: el lote sigue solo hacia las ${r.resumeEn ? new Date(r.resumeEn).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—'}.`);
          }
        } else if (r.ok) {
          it.continuar = false;
          it.fallos = 0;
          it.pasadas++;
          it.nota = r.nota;
          const done = (r.nota ?? 0) >= b.notaObjetivo || it.pasadas >= b.pasadasMax;
          if (!r.tieneBorrador && it.pasadas >= b.pasadasMax) {
            it.estado = 'error';
            it.error = 'Claude terminó sin dejar un borrador.';
          } else {
            it.estado = done && r.tieneBorrador ? 'listo' : 'esperando';
          }
          log(b, `${it.nombre}: pasada ${it.pasadas} terminada${r.nota != null ? ` (nota ${r.nota})` : ''}${it.estado === 'listo' ? ' → listo' : ''}.`);
        } else {
          it.fallos++;
          if (it.fallos >= MAX_FALLOS) {
            it.estado = 'error';
            it.error = r.error ?? 'Claude no pudo terminar.';
            log(b, `${it.nombre}: se deja (${it.error}).`);
          } else {
            it.continuar = true;
            it.estado = 'esperando';
            log(b, `${it.nombre}: el turno falló (${r.error ?? 'sin detalle'}); se reintenta más tarde.`);
          }
        }
      } else if (it.estado === 'trabajando' && it.turnoDesde && now - Date.parse(it.turnoDesde) > 3 * 3600_000) {
        // Turno colgado (no debería pasar: el agente tiene sus propios límites)
        log(b, `${it.nombre}: el turno lleva más de 3 h.`);
      }
    }

    // 2. Hora límite, pausa o cancelado: no se empieza nada nuevo
    const working = b.items.filter((it) => it.estado === 'trabajando').length;
    const preparing = b.items.filter((it) => it.estado === 'preparando').length;
    if (pastLimit && b.estado === 'activo') {
      for (const it of b.items) if (['pendiente', 'esperando'].includes(it.estado)) it.estado = 'sin_terminar';
      if (!working && !preparing) {
        b.estado = 'terminado';
        b.terminado = new Date().toISOString();
        log(b, 'Llegó la hora límite: lote terminado.');
      }
      return actions;
    }
    if (b.estado !== 'activo') return actions;

    // 3. Turnos de Claude en round robin: menos pasadas primero, luego el que más espera
    const free = b.espacios - working;
    const ready = b.items
      .filter((it) => it.estado === 'esperando')
      .sort((a, c) => a.pasadas - c.pasadas || (a.ultimoTurno ?? '').localeCompare(c.ultimoTurno ?? ''));
    for (const it of ready.slice(0, Math.max(0, free))) {
      it.estado = 'trabajando';
      it.turnoDesde = new Date().toISOString();
      actions.push({ kind: it.continuar ? 'continue' : it.pasadas === 0 ? 'first' : 'improve', item: { ...it } });
    }

    // 4. Preparar videos por delante (copiar + transcribir, de uno en uno en el runner del editor)
    const queued = b.items.filter((it) => it.estado === 'esperando').length;
    const want = b.espacios + PREPARE_AHEAD - queued - preparing;
    for (const it of b.items.filter((x) => x.estado === 'pendiente').slice(0, Math.max(0, Math.min(want, 2)))) {
      it.estado = 'preparando';
      actions.push({ kind: 'prepare', item: { ...it } });
    }

    // 5. ¿Terminado?
    if (b.items.every((it) => FINAL.includes(it.estado))) {
      b.estado = 'terminado';
      b.terminado = new Date().toISOString();
      const listos = b.items.filter((it) => it.estado === 'listo');
      const validos = b.items.filter((it) => !it.error?.startsWith('Se omite')).length;
      const notas = listos.map((it) => it.nota).filter((n): n is number => n != null);
      log(b, `Lote terminado: ${listos.length}/${validos} listos${notas.length ? `, nota media ${Math.round(notas.reduce((s, n) => s + n, 0) / notas.length)}` : ''}.`);
    }
    return actions;
  });

  const b = todo.batch;
  for (const a of todo.result) {
    try {
      if (a.kind === 'prepare') {
        const editId = await prepareItem(b, a.item);
        await updateBatch(id, (x) => {
          const it = x.items.find((i) => i.id === a.item.id);
          if (it) it.editId = editId;
        });
      } else if (a.kind === 'first') {
        await startClaudeFirstPass(a.item.editId!);
      } else {
        const msg = a.kind === 'continue' ? CONTINUE_MESSAGE : await improveMessage(b, a.item);
        await sendToClaude(a.item.editId!, msg, defaultAppUrl(), {
          mostrar: a.kind === 'continue' ? '↻ Lote: continúa donde iba.' : `↻ Lote: pasada ${a.item.pasadas + 1} — mejorar la nota.`,
        });
      }
      if (a.item.editId && a.kind !== 'prepare') {
        await updateEdit(a.item.editId, (x) => logActivity(x, `Lote «${b.titulo}»: turno de Claude (${a.kind === 'first' ? 'primer pase' : a.kind === 'continue' ? 'continúa' : `pasada ${a.item.pasadas + 1}`}).`)).catch(() => undefined);
      }
    } catch (err) {
      const msg = errorMessage(err);
      const conflict = err instanceof EditError && err.status === 409;
      await updateBatch(id, (x) => {
        const it = x.items.find((i) => i.id === a.item.id);
        if (!it) return;
        if (a.kind === 'prepare') {
          it.estado = 'error';
          it.error = msg;
        } else if (conflict) {
          // Ya había un turno (la persona escribió en el chat): se espera a que termine
          it.estado = 'trabajando';
          return;
        } else {
          it.fallos++;
          it.estado = it.fallos >= MAX_FALLOS ? 'error' : 'esperando';
          it.error = it.estado === 'error' ? msg : undefined;
        }
        log(x, `${a.item.nombre}: ${msg}`);
      }).catch(() => undefined);
    }
  }
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const batches = await listBatches();
    let running = false;
    for (const b of batches) {
      if (b.estado === 'terminado' || b.estado === 'cancelado') {
        // Un lote cancelado puede tener turnos que aún terminan: se siguen sincronizando
        if (b.estado === 'cancelado' && b.items.some((it) => it.estado === 'trabajando')) await stepCancelled(b.id);
        continue;
      }
      running = true;
      await stepBatch(b.id).catch((err) => console.error(`[lote] ${b.id}:`, errorMessage(err)));
    }
    if (running) keepAwake('lotes');
    else releaseAwake('lotes');
  } catch (err) {
    console.error('[lote]', errorMessage(err));
  } finally {
    state.busy = false;
  }
}

async function stepCancelled(id: string) {
  await updateBatch(id, async (b) => {
    for (const it of b.items) {
      if (it.estado !== 'trabajando' || !it.editId || isTurnActive(it.editId)) continue;
      const r = await lastTurnOutcome(it.editId);
      if (r.cupo) await cancelResume(`edit:${it.editId}`);
      it.estado = r.ok && r.tieneBorrador ? 'listo' : 'sin_terminar';
      if (r.ok) it.pasadas++;
      it.nota = r.nota;
    }
  });
}

/**
 * Al arrancar: un video que se estaba copiando cuando se cerró la app (sin edición apuntada)
 * vuelve a la cola; si no, se quedaría «preparando» para siempre.
 */
async function recoverBatches() {
  for (const b of await listBatches()) {
    if (!b.items.some((it) => it.estado === 'preparando' && !it.editId)) continue;
    await updateBatch(b.id, (x) => {
      for (const it of x.items) if (it.estado === 'preparando' && !it.editId) it.estado = 'pendiente';
    }).catch(() => undefined);
  }
}

export function startBatchRunner() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  setTimeout(() => void recoverBatches().finally(() => void tick()), 3000);
}

export function kickBatchRunner() {
  if (!state.timer) startBatchRunner();
  setTimeout(() => void tick(), 200);
}
