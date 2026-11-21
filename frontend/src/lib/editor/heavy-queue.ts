import { AsyncLocalStorage } from 'async_hooks';

/**
 * Cola para el trabajo que necesita la potencia del PC (renders con FFmpeg, HyperFrames, pista de
 * persona, Whisper, recorte de persona). Varios Claude pueden pensar y dirigir a la vez, pero lo
 * pesado se hace de uno en uno (o `LULO_TRABAJOS_PESADOS` a la vez) para no ahogar el equipo.
 *
 * Es reentrante: si un trabajo pesado llama a otro (el render que pide la pista de persona), el de
 * dentro no vuelve a hacer cola (si no, se bloquearía esperándose a sí mismo).
 */

interface Waiter {
  label: string;
  since: number;
  go: () => void;
}

const g = globalThis as unknown as { __luloHeavy?: { running: { label: string; since: number }[]; queue: Waiter[] } };
const state = (g.__luloHeavy ??= { running: [], queue: [] });
const inside = new AsyncLocalStorage<boolean>();

function capacity(): number {
  const n = Number(process.env.LULO_TRABAJOS_PESADOS);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1;
}

function next() {
  // El hueco se reserva aquí, antes de despertar al siguiente: si no, varios en espera entrarían a la vez
  while (state.running.length < capacity() && state.queue.length) {
    const w = state.queue.shift()!;
    state.running.push({ label: w.label, since: Date.now() });
    w.go();
  }
}

/** Ejecuta `fn` cuando haya hueco en la cola de trabajo pesado. */
export async function heavy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (inside.getStore()) return fn();
  if (state.running.length < capacity() && !state.queue.length) {
    state.running.push({ label, since: Date.now() });
  } else {
    // next() reserva el hueco con este nombre al despertarlo
    await new Promise<void>((go) => {
      state.queue.push({ label, since: Date.now(), go });
    });
  }
  try {
    return await inside.run(true, fn);
  } finally {
    const i = state.running.findIndex((r) => r.label === label);
    if (i >= 0) state.running.splice(i, 1);
    next();
  }
}

/** Qué se está haciendo y qué espera (para la pantalla). */
export function heavyStatus() {
  const now = Date.now();
  return {
    capacidad: capacity(),
    enCurso: state.running.map((r) => ({ trabajo: r.label, seg: Math.round((now - r.since) / 1000) })),
    enEspera: state.queue.map((w) => ({ trabajo: w.label, seg: Math.round((now - w.since) / 1000) })),
  };
}
