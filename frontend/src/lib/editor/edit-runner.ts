import { scoreEdit } from './score';
import { errorMessage } from '@/lib/errors';
import { runAnalysis } from './analyze';
import { renderEdit } from './render';
import { getEdit, listEdits, logActivity, updateEdit } from './edit-store';
import { normalizeProfile } from './profile-store';

/**
 * Runner de ediciones (arranca en instrumentation.ts).
 * Cada pocos segundos busca ediciones con una tarea pendiente (analizar o renderizar) y las
 * hace de una en una. Como la tarea queda guardada en el JSON, si la app se cierra a mitad,
 * al volver a abrirla se retoma sola.
 */

const TICK_MS = 2000;

interface RunnerState {
  timer: NodeJS.Timeout | null;
  busy: boolean;
}

const g = globalThis as unknown as { __luloEditRunner?: RunnerState };
const state = (g.__luloEditRunner ??= { timer: null, busy: false });

export function startEditRunner() {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void recoverInterrupted();
}

/**
 * Para que una tarea nueva arranque sin esperar el siguiente ciclo.
 * Si el runner no estaba en marcha (p. ej. la app no se reinició tras actualizar), lo arranca.
 */
export function kickEditRunner() {
  if (!state.timer) startEditRunner();
  void tick();
}

/** Lo que quedó "en curso" al cerrar la app vuelve a la cola. */
async function recoverInterrupted() {
  try {
    for (const p of await listEdits()) {
      if (p.tarea && ['transcribiendo', 'analizando', 'renderizando'].includes(p.estado)) {
        await updateEdit(p.id, (x) => {
          x.estado = 'en_cola';
          logActivity(x, 'Se retoma el trabajo que quedó a medias al cerrar la app.');
        });
      }
    }
  } catch (err) {
    console.warn('[edicion] No se pudieron retomar ediciones:', errorMessage(err));
  }
}

async function tick() {
  if (state.busy) return;
  state.busy = true;
  try {
    const pending = (await listEdits())
      .filter((p) => p.tarea && p.estado !== 'error')
      .sort((a, b) => a.actualizado.localeCompare(b.actualizado));
    const next = pending[0];
    if (!next) return;
    if (next.tarea === 'analizar') await runAnalysis(next.id);
    else if (next.tarea === 'renderizar') await runRender(next.id);
  } catch (err) {
    console.error('[edicion] runner:', err);
  } finally {
    state.busy = false;
  }
}

async function runRender(id: string) {
  const start = await getEdit(id);
  const version = (start.borrador?.version ?? 0) + 1;
  await updateEdit(id, (x) => {
    x.estado = 'renderizando';
    x.progreso = 0;
    logActivity(x, `Armando el video (versión ${version}): cortes, subtítulos y sonido…`);
  });

  let lastSaved = 0;
  try {
    const p = await getEdit(id);
    // Ediciones creadas antes de los campos de sonido o red social
    p.perfil = normalizeProfile(p.perfil);
    let lastText = '';
    const r = await renderEdit(p, version, (pct, _etapa, detalle) => {
      const text = detalle ?? lastText;
      if (pct - lastSaved < 3 && text === lastText) return;
      lastSaved = pct;
      lastText = text;
      void updateEdit(id, (x) => {
        if (x.estado !== 'renderizando') return;
        x.progreso = pct;
        if (text) x.progresoTexto = text;
      }).catch(() => undefined);
    });
    await updateEdit(id, (x) => {
      x.borrador = {
        archivo: r.archivo,
        duracion: r.duracion,
        creado: new Date().toISOString(),
        version,
        portada: r.portada,
        calidad: r.calidad,
        notas: r.notas,
      };
      x.estado = 'borrador';
      x.tarea = undefined;
      x.progreso = 100;
      x.progresoTexto = undefined;
      x.error = undefined;
      const fallos = r.calidad.filter((c) => c.ok === false).length;
      logActivity(x, `Borrador listo: ${r.duracion.toFixed(1)} s. Control de calidad: ${fallos ? `${fallos} punto(s) a revisar` : 'todo bien'}.`);
    });
    // Nota de retención (solo con plan de Claude); si falla, el borrador sigue igual
    try {
      const nota = await scoreEdit(await getEdit(id));
      if (nota) await updateEdit(id, (x) => {
        if (x.borrador?.version === version) x.borrador.nota = nota;
      });
    } catch (err) {
      console.error('[edicion] nota de retención:', err);
    }
  } catch (err) {
    console.error('[edicion] render falló:', err);
    const mensaje = errorMessage(err, 'No se pudo armar el video.');
    await updateEdit(id, (x) => {
      x.estado = 'error';
      x.tarea = undefined;
      x.progreso = undefined;
      x.error = { mensaje, tarea: 'renderizar' };
      logActivity(x, `Error al armar el video: ${mensaje}`);
    });
  }
}
