import fsp from 'fs/promises';
import path from 'path';
import { getDataDir, writeJsonAtomic } from '@/lib/data/data-dir';
import { errorMessage } from '@/lib/errors';

/**
 * Reanudar a Claude cuando vuelve el cupo de la suscripción.
 *
 * Si un turno del editor, el Director o el Estudio Claude se corta porque se agotó el cupo, se
 * apunta aquí con la hora en que se libera (la que da Claude Code en `rate_limit_event`). Un
 * vigilante (arranca en instrumentation) le escribe «continúa donde ibas» en esa misma
 * conversación unos minutos después. Se guarda en `<datos>/claude-reanudar.json`, así sobrevive a
 * reiniciar la app; solo corre con la app abierta. Si la persona escribe en el chat, empieza una
 * conversación nueva o cancela, se olvida.
 */

export interface PendingResume {
  /** Clave del turno: `edit:<id>`, `director:<id>` o `studio:<id>`. */
  clave: string;
  /** Cuándo se reanuda (ISO). */
  en: string;
  /** Reanudaciones automáticas seguidas que ya se cortaron por cupo. */
  intentos: number;
  creado: string;
}

/** Margen tras la hora que da Claude Code, para no chocar con el límite justo al liberarse. */
const MARGIN_MS = 3 * 60_000;
/** Sin hora conocida: se vuelve a probar cada 30 min. */
const UNKNOWN_WAIT_MS = 30 * 60_000;
/** Tras tantos cortes seguidos se deja de insistir (la persona lo retoma a mano). */
export const MAX_AUTO_RESUMES = 8;
const CHECK_MS = 30_000;

export const RESUME_MESSAGE =
  'Se cortó tu turno anterior porque se agotó el cupo de la suscripción; ya volvió. Continúa exactamente donde ibas: revisa qué quedó hecho (ver_edicion / ver_proyecto) y termina el pedido sin repetir lo que ya está.';

const file = () => path.join(/*turbopackIgnore: true*/ getDataDir(), 'claude-reanudar.json');

const g = globalThis as unknown as {
  __luloResume?: { list: PendingResume[] | null; timer?: ReturnType<typeof setInterval>; busy?: boolean; lock?: Promise<unknown> };
};
const state = (g.__luloResume ??= { list: null });

/**
 * Los cambios van de uno en uno: si varios proyectos se quedan sin cupo a la vez, cada turno
 * apunta su reanudación al mismo tiempo y, sin esto, una escritura pisaría a otra.
 */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (state.lock ?? Promise.resolve()).then(fn, fn);
  state.lock = run.catch(() => undefined);
  return run;
}

async function load(): Promise<PendingResume[]> {
  if (state.list) return state.list;
  try {
    const data = JSON.parse(await fsp.readFile(file(), 'utf8'));
    state.list = Array.isArray(data) ? data.filter((x) => x && typeof x.clave === 'string' && typeof x.en === 'string') : [];
  } catch {
    state.list = [];
  }
  return state.list;
}

async function save(list: PendingResume[]) {
  state.list = list;
  await writeJsonAtomic(file(), list).catch((err) => console.error('[claude-reanudar]', errorMessage(err)));
}

/** Hora de reanudar a partir de la hora de liberación que dio Claude Code (o null). */
export function resumeTime(resetsAt?: string, now = Date.now()): Date {
  const t = resetsAt ? Date.parse(resetsAt) : NaN;
  // Una hora absurda (pasada o a más de 8 días) se trata como desconocida
  if (!Number.isFinite(t) || t < now - 60_000 || t > now + 8 * 24 * 3600_000) return new Date(now + UNKNOWN_WAIT_MS);
  return new Date(Math.max(t, now) + MARGIN_MS);
}

/** Apunta una reanudación. Devuelve null si ya se insistió demasiado. */
export async function scheduleResume(clave: string, resetsAt: string | undefined, intentos: number): Promise<PendingResume | null> {
  if (intentos > MAX_AUTO_RESUMES) {
    await cancelResume(clave);
    return null;
  }
  const item: PendingResume = { clave, en: resumeTime(resetsAt).toISOString(), intentos, creado: new Date().toISOString() };
  return withLock(async () => {
    const list = (await load()).filter((x) => x.clave !== clave);
    await save([...list, item]);
    return item;
  });
}

export async function cancelResume(clave: string): Promise<boolean> {
  return withLock(async () => {
    const list = await load();
    if (!list.some((x) => x.clave === clave)) return false;
    await save(list.filter((x) => x.clave !== clave));
    return true;
  });
}

export async function getResume(clave: string): Promise<PendingResume | null> {
  return (await load()).find((x) => x.clave === clave) ?? null;
}

/** Hora corta para los mensajes («15:40» o «mañana 09:05»). */
export function resumeLabel(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('es', { weekday: 'long' })} ${hora}`;
}

/** Envía el mensaje de reanudar a la herramienta dueña de la clave. */
async function dispatch(item: PendingResume): Promise<void> {
  const sep = item.clave.indexOf(':');
  const kind = item.clave.slice(0, sep);
  const id = item.clave.slice(sep + 1);
  const { defaultAppUrl } = await import('@/lib/ai/claude-code/agent-runner');
  const opts = { mostrar: '↻ Reanudación automática: volvió el cupo de Claude.', reintento: item.intentos };
  if (kind === 'edit') {
    const { sendToClaude } = await import('@/lib/editor/claude-agent');
    await sendToClaude(id, RESUME_MESSAGE, defaultAppUrl(), opts);
  } else if (kind === 'director') {
    const { sendToDirector } = await import('@/lib/director-mode/claude-director');
    await sendToDirector(id, RESUME_MESSAGE, defaultAppUrl(), opts);
  } else if (kind === 'studio') {
    const { sendToStudio } = await import('@/lib/studio/claude-studio');
    await sendToStudio(id, RESUME_MESSAGE, defaultAppUrl(), opts);
  } else {
    throw new Error(`clave desconocida: ${item.clave}`);
  }
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const { isAgentTurnActive } = await import('@/lib/ai/claude-code/agent-runner');
    const now = Date.now();
    for (const item of [...(await load())]) {
      if (Date.parse(item.en) > now) continue;
      // Ya hay un turno (la persona se adelantó): ese turno decide
      if (isAgentTurnActive(item.clave)) {
        await cancelResume(item.clave);
        continue;
      }
      try {
        // startAgentTurn la quita de la lista; si vuelve a cortarse por cupo, se apunta otra vez
        await dispatch(item);
        console.log(`[claude-reanudar] ${item.clave}: reanudado (intento ${item.intentos})`);
      } catch (err) {
        // El proyecto ya no existe u otro error permanente: se olvida
        console.error(`[claude-reanudar] ${item.clave}: ${errorMessage(err)}`);
        await cancelResume(item.clave);
      }
    }
  } finally {
    state.busy = false;
  }
}

/** Arranca el vigilante (una vez por proceso). */
export function startResumeWatcher() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick().catch(() => undefined), CHECK_MS);
  void tick().catch(() => undefined);
}
