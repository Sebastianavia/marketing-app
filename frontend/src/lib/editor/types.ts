import type { EditProfile } from '@/config/editor-looks';

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
  };
  aprobado?: { videoPath: string; fecha: string };
  actividad: EditActivity[];
  costoUSD: number;
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
