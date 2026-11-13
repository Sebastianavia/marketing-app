import type { EditExport, EditVariant, PostText } from './outputs';
import type { EditScore } from './score';
import type { EditMetric } from './learning';
import type { EditApproval } from './paid';
import type { EditProfile } from '@/config/editor-looks';
import type { EditDirection } from './direction';

/**
 * Proyecto de edición: un video en bruto que se transcribe, la IA propone cortes,
 * la persona revisa y aprueba, y FFmpeg arma el reel con subtítulos del perfil.
 * Se guarda en <datos>/edits/<id>.json; los archivos, en <proyectos>\Generados\Ediciones\<nombre>\.
 */

export type EditStatus =
  | 'en_cola' // esperando turno para analizar
  | 'transcribiendo'
  | 'analizando'
  | 'por_revisar' // guion listo: la persona revisa cortes y textos
  | 'renderizando'
  | 'borrador' // video listo para ver
  | 'aprobado'
  | 'error';

export type EditTask = 'analizar' | 'renderizar';

/** Palabra con tiempos en el video ORIGINAL (segundos). */
export interface EditWord {
  t: string;
  s: number;
  e: number;
}

export interface EditPhrase {
  id: string;
  s: number;
  e: number;
  palabras: EditWord[];
  /** true = esta frase no entra en el video. */
  cortar: boolean;
  /** Por qué se propone cortarla (falso comienzo, repetición…). */
  motivo?: string;
  /** Texto corregido a mano para los subtítulos (no cambia el audio). */
  textoEditado?: string;
}

/** Una línea del control de calidad: ok = true (✓), false (✗) o null (para revisar tú). */
export interface QualityCheck {
  ok: boolean | null;
  texto: string;
}

export type GraphicType = 'tarjeta' | 'numero' | 'lista' | 'detras';

/** Gráfico animado que se dispara en una palabra (tiempos del video ORIGINAL). */
export interface EditGraphic {
  id: string;
  tipo: GraphicType;
  fraseId: string;
  palabra: string;
  /** Inicio de la palabra que lo dispara, en el original. */
  t: number;
  titulo: string;
  texto: string;
  items: string[];
  activo: boolean;
}

export interface EditActivity {
  t: string;
  msg: string;
}

import type { ClaudeChatMessage, ClaudeChatState, ClaudeChatStep } from '@/lib/ai/claude-code/agent-types';
export type { ClaudeChatMessage, ClaudeChatStep };

export interface EditProject {
  id: string;
  titulo: string;
  /** Carpeta absoluta con original, audio, subtítulos y borradores. */
  carpeta: string;
  creado: string;
  actualizado: string;
  pedido: string;
  perfilId: string;
  /** Copia del perfil con la que se edita (se refresca al cambiar de perfil). */
  perfil: EditProfile;
  original: { archivo: string; duracion: number; ancho: number; alto: number; tieneAudio: boolean };
  estado: EditStatus;
  /** Tarea pendiente o en curso (para retomar si la app se cierra). */
  tarea?: EditTask;
  /** Modo de IA pedido para el análisis (vacío = el del selector IA). */
  modoIA?: string;
  /** Indicación extra para volver a analizar ("que dure 30 s"…). */
  indicacion?: string;
  /** Saltar la IA: solo se quitan pausas. */
  sinIA?: boolean;
  /** true = parar para revisar el guion antes de renderizar; false = seguir directo al video. */
  revisarAntes: boolean;
  /** Progreso del render (0–100) y qué se está haciendo. */
  progreso?: number;
  progresoTexto?: string;
  error?: { mensaje: string; codigo?: string; tarea: EditTask };
  transcripcion?: { palabras: EditWord[]; costoUSD: number; creada: string; modelo: string };
  frases: EditPhrase[];
  /** Plan de gráficos (propuesto por la IA, revisado por la persona). */
  graficos?: EditGraphic[];
  /**
   * Plan de dirección de Claude (lib/editor/direction.ts): cámara, transiciones, color, diseño de
   * subtítulos, palabras clave, elementos visuales, efectos de sonido y música, con tiempos del
   * ORIGINAL. Si existe, el render lo ejecuta y apaga las reglas mecánicas del perfil.
   */
  direccion?: EditDirection;
  gancho: string;
  resaltar: string[];
  /** Explicación corta de la IA sobre lo que hizo. */
  resumenIA?: string;
  borrador?: {
    archivo: string;
    duracion: number;
    creado: string;
    version: number;
    portada?: string;
    calidad?: QualityCheck[];
    notas?: string[];
    /** Nota de retención 0–100 (lib/editor/score.ts). */
    nota?: EditScore;
  };
  aprobado?: { videoPath: string; fecha: string };
  /** Fase 5: variantes del borrador, exportaciones por red y texto del post. */
  variantes?: EditVariant[];
  exportaciones?: EditExport[];
  post?: PostText;
  /** Fase 7: métricas reales de lo publicado. */
  metricas?: EditMetric[];
  /** Fase 6: gastos que Claude pidió aprobar (doblaje, correcciones de voz). */
  aprobaciones?: EditApproval[];
  actividad: EditActivity[];
  costoUSD: number;
  /** Chat con Claude (Claude Code con la suscripción): sesión para continuar y mensajes. */
  claude?: ClaudeChatState;
}

/** Lo que se lista en la biblioteca de ediciones. */
export interface EditSummary {
  id: string;
  titulo: string;
  estado: EditStatus;
  creado: string;
  actualizado: string;
  perfilNombre: string;
  duracionOriginal: number;
  duracionFinal?: number;
  error?: string;
}

export const ACTIVE_STATUSES: EditStatus[] = ['en_cola', 'transcribiendo', 'analizando', 'renderizando'];
