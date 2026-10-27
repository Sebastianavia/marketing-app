import type { VoiceMode } from '@/config/broll-models';
import type { DirectorSkillId } from '@/config/director-skills';

/**
 * Modo Director de Guion a video (estilo Buzzy). Vive dentro de `produccion.json`
 * en el campo `director`. En la Fase 1 solo hay texto ($0): idea → preguntas → ajustes → guion → prompts.
 * Las escenas de pago (`Production.escenas`) siguen vacías hasta la Fase 4.
 */

/** Etapas que ya funcionan. */
export type ActiveStageId = 'idea' | 'preguntas' | 'ajustes' | 'guion' | 'prompts';

/** Etapas futuras: se muestran en gris. */
export type FutureStageId = 'estilo' | 'elenco' | 'imagenes' | 'presupuesto' | 'clips' | 'final';

export type StageId = ActiveStageId | FutureStageId;

/**
 * 'generando' no se guarda: lo muestra la interfaz mientras espera la respuesta
 * (si la app se cierra a mitad, la etapa no queda colgada).
 */
export type StageStatus = 'bloqueada' | 'pendiente' | 'por_revisar' | 'aprobada' | 'desactualizada' | 'error';

export interface StageState {
  estado: StageStatus;
  /** Sube con cada cambio: sirve para no pisar algo que cambió mientras Gemini pensaba. */
  rev: number;
  /** Modelo que generó el contenido actual (si lo generó la IA). */
  modelo?: string;
  /** Costo del texto generado (0 con Gemini gratis). */
  costoUSD?: number;
  error?: string;
  actualizada?: string;
}

export type InputKind = 'guion' | 'idea' | 'pdf';

export interface DirectorInput {
  tipo: InputKind;
  texto: string;
  /** Solo con guion pegado: la IA no puede cambiar palabras. */
  mantenerPalabras: boolean;
  /** Nombre del PDF copiado dentro de la carpeta de la producción. */
  pdf?: string;
  pdfNombre?: string;
}

export interface DirectorQuestion {
  id: string;
  pregunta: string;
  opciones: string[];
  respuesta?: string;
}

export type Aspect = '9:16' | '16:9' | '1:1';

export interface DirectorSettings {
  formato: Aspect;
  duracionSeg: number;
  modoVoz: VoiceMode;
  /** Modelo previsto para las tomas de apoyo (define las duraciones admitidas). */
  modeloBroll: string;
  avatarId: string | null;
  avatarNombre?: string;
  presupuestoUSD: number;
}

export type DirectorSceneType = 'avatar' | 'broll';

export interface DirectorScenePrompt {
  /** Lo que escribió la IA o la persona (sin el bloque de realismo, que se añade al usarlo). */
  texto: string;
  /** Versión de la escena para la que se escribió: si no coincide, está desactualizado. */
  deVersion: number;
  modelo?: string;
}

export interface DirectorScene {
  id: string;
  orden: number;
  tipo: DirectorSceneType;
  /** Duración ya ajustada a lo que admite el modelo de video previsto. */
  duracionSeg: number;
  /** Lo que se pidió, si el modelo obligó a ajustarlo. */
  duracionPedidaSeg?: number;
  /** Calculados por el código sumando duraciones. */
  inicio: number;
  fin: number;
  queSeVe: string;
  dialogo: string;
  version: number;
  prompt: DirectorScenePrompt | null;
}

export interface DirectorScript {
  titulo: string;
  /** Sube cada vez que se rehace el guion entero (los ids de escena se reutilizan). */
  generacion: number;
  escenas: DirectorScene[];
}

export interface DirectorHistoryEntry {
  cuando: string;
  /** p. ej. 'guion', 'guion.e2', 'prompts.e3', 'preguntas' */
  que: string;
  antes: unknown;
}

export interface DirectorState {
  version: 1;
  /** Plantilla elegida en la caja de inicio (config/director-skills.ts). Sin ella: sin plantilla. */
  skill?: DirectorSkillId;
  confidencial: boolean;
  etapas: Record<ActiveStageId, StageState>;
  entrada: DirectorInput;
  preguntas: DirectorQuestion[];
  ajustes: DirectorSettings;
  guion: DirectorScript | null;
  historial: DirectorHistoryEntry[];
}
