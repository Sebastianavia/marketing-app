/**
 * Tipos del chat con Claude-agente (editor, Director…). Sin dependencias de Node:
 * los usan tanto el servidor como la pantalla.
 */

/** Un paso que dio Claude (herramienta usada) dentro de una respuesta. */
export interface ClaudeChatStep {
  herramienta: string;
  detalle: string;
  error?: string;
}

/** Mensaje del chat con Claude. */
export interface ClaudeChatMessage {
  id: string;
  rol: 'usuario' | 'claude';
  texto: string;
  fecha: string;
  pasos?: ClaudeChatStep[];
  /** Acciones que el aislamiento o los permisos no dejaron hacer. */
  denegados?: string[];
  error?: boolean;
  duracionSeg?: number;
}

/** Conversación guardada junto al proyecto: sesión de Claude Code para continuar y mensajes. */
export interface ClaudeChatState {
  sessionId?: string;
  mensajes: ClaudeChatMessage[];
}

/** Eventos del turno en curso (NDJSON de las rutas …/claude). */
export type AgentEvent =
  | { tipo: 'texto'; delta: string }
  | { tipo: 'paso'; id: string; herramienta: string; detalle: string }
  | { tipo: 'resultado_paso'; id: string; error: boolean; resumen: string }
  | { tipo: 'fin'; mensaje: ClaudeChatMessage }
  | { tipo: 'error'; mensaje: string; codigo?: string };

/**
 * aislado = sandbox de Claude Code (macOS/Linux); sin_aislamiento = Windows con todos los permisos;
 * sin_bash = comandos desactivados.
 */
export type SandboxMode = 'aislado' | 'sin_aislamiento' | 'sin_bash';
