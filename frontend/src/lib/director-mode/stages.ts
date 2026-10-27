import { tagSignature } from './mentions';
import type { ActiveStageId, DirectorScene, DirectorState, StageId, StageStatus } from './types';

/**
 * Línea de etapas del modo Director, escrita en el código (no en el prompt).
 * Lógica pura: sin archivos ni IA. La usan el motor (servidor) y la interfaz.
 */

export interface StageDef {
  id: StageId;
  numero: number;
  nombre: string;
  descripcion: string;
  /** Fase del plan en que se activa (1 = ya funciona). */
  fase: number;
  /** Lleva pausa de revisión antes de seguir. */
  pausa?: boolean;
}

export const STAGES: StageDef[] = [
  { id: 'idea', numero: 1, nombre: 'Idea', descripcion: 'Guion pegado, idea o PDF.', fase: 1 },
  { id: 'preguntas', numero: 2, nombre: 'Preguntas de dirección', descripcion: 'Dos decisiones de tono y enfoque.', fase: 1 },
  { id: 'ajustes', numero: 3, nombre: 'Ajustes', descripcion: 'Formato, duración, voz, avatar y presupuesto.', fase: 1 },
  { id: 'estilo', numero: 4, nombre: 'Estilo', descripcion: 'Imagen de referencia (solo el look).', fase: 3 },
  { id: 'guion', numero: 5, nombre: 'Guion por escenas', descripcion: 'Tiempos, qué se ve y qué se dice.', fase: 1, pausa: true },
  { id: 'elenco', numero: 6, nombre: 'Elenco y lugares', descripcion: 'Personas desde tus avatares y fondos vacíos.', fase: 3 },
  { id: 'imagenes', numero: 7, nombre: 'Imagen inicial por escena', descripcion: 'El primer cuadro que se anima.', fase: 3 },
  { id: 'prompts', numero: 8, nombre: 'Prompt por escena', descripcion: 'Lo que recibe el modelo de video.', fase: 1, pausa: true },
  { id: 'presupuesto', numero: 9, nombre: 'Presupuesto y aprobación', descripcion: 'Nada de video se paga antes.', fase: 4 },
  { id: 'clips', numero: 10, nombre: 'Clips', descripcion: 'Generación y revisión automática.', fase: 4 },
  { id: 'final', numero: 11, nombre: 'Video final', descripcion: 'Montaje, música y tarjeta en Proyectos.', fase: 4 },
];

/** Orden de las etapas que ya funcionan. */
export const ACTIVE_ORDER: ActiveStageId[] = ['idea', 'preguntas', 'ajustes', 'guion', 'prompts'];

export const STAGE_LABELS: Record<StageStatus, string> = {
  bloqueada: 'Bloqueada',
  pendiente: 'Pendiente',
  por_revisar: 'Por revisar',
  aprobada: 'Aprobada',
  desactualizada: 'Desactualizada',
  error: 'Error',
};

export function isActiveStage(id: StageId): id is ActiveStageId {
  return (ACTIVE_ORDER as string[]).includes(id);
}

export function nextStage(id: ActiveStageId): ActiveStageId | null {
  return ACTIVE_ORDER[ACTIVE_ORDER.indexOf(id) + 1] ?? null;
}

function hasContent(d: DirectorState, id: ActiveStageId): boolean {
  switch (id) {
    case 'idea':
    case 'ajustes':
      return true;
    case 'preguntas':
      return d.preguntas.length > 0;
    case 'guion':
      return Boolean(d.guion?.escenas.length);
    case 'prompts':
      return Boolean(d.guion?.escenas.some((s) => s.prompt));
  }
}

/** Marca un cambio en la etapa (sube rev y fecha). */
export function touch(d: DirectorState, id: ActiveStageId, estado: StageStatus, extra: Partial<DirectorState['etapas'][ActiveStageId]> = {}) {
  const prev = d.etapas[id];
  d.etapas[id] = { ...prev, ...extra, estado, rev: prev.rev + 1, actualizada: new Date().toISOString() };
  if (estado !== 'error') delete d.etapas[id].error;
}

/**
 * La etapa cambió (Rehacer, editar o aprobar): lo posterior que tenía contenido queda desactualizado;
 * lo que no tenía queda pendiente si su etapa anterior está aprobada, o bloqueado si no.
 * Los Ajustes no salen del texto, así que se conservan.
 */
export function invalidateAfter(d: DirectorState, id: ActiveStageId) {
  for (const s of ACTIVE_ORDER.slice(ACTIVE_ORDER.indexOf(id) + 1)) {
    if (s === 'ajustes') {
      if (d.etapas.ajustes.estado === 'bloqueada' && d.etapas.preguntas.estado === 'aprobada') touch(d, s, 'pendiente');
      continue;
    }
    const target: StageStatus = hasContent(d, s) ? 'desactualizada' : previousApproved(d, s) ? 'pendiente' : 'bloqueada';
    if (d.etapas[s].estado !== target) touch(d, s, target);
  }
}

/** Tras aprobar una etapa: la siguiente bloqueada pasa a pendiente (o desactualizada si ya tenía algo). */
export function unlockNext(d: DirectorState, id: ActiveStageId) {
  if (d.etapas[id].estado !== 'aprobada') return;
  const next = nextStage(id);
  if (!next || d.etapas[next].estado !== 'bloqueada' || !previousApproved(d, next)) return;
  touch(d, next, hasContent(d, next) && next !== 'ajustes' ? 'desactualizada' : 'pendiente');
}

/** Se puede trabajar en la etapa: todas las anteriores están aprobadas. */
export function previousApproved(d: DirectorState, id: ActiveStageId): boolean {
  return ACTIVE_ORDER.slice(0, ACTIVE_ORDER.indexOf(id)).every((s) => d.etapas[s].estado === 'aprobada');
}

/**
 * El prompt de la escena no existe, se escribió para una versión anterior de la escena
 * o (si se pasa el borrador) alguna de sus etiquetas cambió desde entonces.
 */
export function promptIsStale(s: DirectorScene, d?: Pick<DirectorState, 'etiquetas' | 'referencias'>): boolean {
  if (!s.prompt || s.prompt.deVersion !== s.version) return true;
  return d ? (s.prompt.deEtiquetas ?? '') !== tagSignature(d, s) : false;
}

/** Guarda lo anterior antes de cambiarlo (máximo 30 entradas). */
export function remember(d: DirectorState, que: string, antes: unknown) {
  d.historial.push({ cuando: new Date().toISOString(), que, antes: JSON.parse(JSON.stringify(antes ?? null)) });
  if (d.historial.length > 30) d.historial.splice(0, d.historial.length - 30);
}

/** Etapa en la que está la persona: la primera que no está aprobada. */
export function currentStage(d: DirectorState): ActiveStageId | null {
  return ACTIVE_ORDER.find((s) => d.etapas[s].estado !== 'aprobada') ?? null;
}
