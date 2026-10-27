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
  /** Firma de las etiquetas que usaba la escena (mentions.ts → tagSignature). Sin ella = sin etiquetas. */
  deEtiquetas?: string;
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
  /**
   * Guion alineado a la locución propia: frases que cubre (1 = la primera, ambas incluidas).
   * Inicio, fin y diálogo los manda el audio y no se reajustan.
   */
  audio?: { desde: number; hasta: number };
  /** Con audio: duración del clip a generar (la menor que admite el modelo y cubre la escena); se recorta al montar. */
  clipSeg?: number;
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

// ---------- Referencias y etiquetas (v2, paso 2) ----------

export type RefMedia = 'imagen' | 'audio' | 'pdf';

/** Qué es una etiqueta. Se nombra con @ en el guion y en las escenas. */
export type TagKind = 'personaje' | 'lugar' | 'producto' | 'estilo' | 'voz' | 'musica';

/** Un archivo subido con + Ref. Vive en `<carpeta>/referencias/`. */
export interface DirectorRef {
  id: string;
  /** Ruta relativa a la carpeta de la producción, con '/' (p. ej. 'referencias/foto-03.jpg'). */
  archivo: string;
  nombreOriginal: string;
  medio: RefMedia;
  bytes: number;
  /** Audio: medido con FFmpeg. */
  duracionSeg?: number;
  /** Sin escena = todo el proyecto. Con escena = solo esa escena. */
  escenaId?: string;
  etiquetaId?: string;
  subida: string;
}

export interface DirectorTag {
  id: string;
  tipo: TagKind;
  nombre: string;
  /** Lo que va tras la @: sin espacios ni tildes ("Spa de lujo" → SpaDeLujo). Único en el proyecto. */
  mencion: string;
  /** Breve y en inglés: la usan los prompts ("woman, 30s, curly dark hair…"). */
  descripcion: string;
  /** Solo personajes: sus fotos salen del avatar guardado (no se copian). */
  avatarId?: string;
  avatarNombre?: string;
  /** false = la propuso el agente y la persona aún no la revisó. */
  confirmada: boolean;
  /** Sube al cambiar tipo, nombre o descripción: deja desactualizados los prompts que la usan. */
  rev: number;
}

/** Locución propia ("video desde mi audio"). */
export interface VoiceoverPhrase {
  texto: string;
  inicio: number;
  fin: number;
}

export interface DirectorVoiceover {
  refId: string;
  duracionSeg: number;
  /** En voz en off se usa este audio en vez de generar voz (lo aplica el montaje de la Fase 4). */
  usarComoVoz: boolean;
  transcripcion?: {
    motor: 'gemini' | 'elevenlabs';
    modelo: string;
    costoUSD: number;
    frases: VoiceoverPhrase[];
    /** Cortes movidos al silencio real más cercano (FFmpeg silencedetect). */
    ajustadaASilencios: boolean;
    creada: string;
  };
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
  /** Paso 2 (opcionales: los borradores anteriores no los tienen). */
  referencias?: DirectorRef[];
  etiquetas?: DirectorTag[];
  locucion?: DirectorVoiceover;
}
