/**
 * Modelos de texto (guiones, chat, Mia) y su precio.
 * Precios de OpenRouter en USD por millón de tokens, del catálogo /api/v1/models
 * consultado el 12 oct 2026. Gemini directo usa el pool de claves gratis (free tier).
 */

export interface LlmModelSpec {
  id: string;
  name: string;
  provider: 'gemini' | 'openrouter';
  /** USD por millón de tokens de entrada / salida (0 = free tier de Gemini). */
  inputPerM: number;
  outputPerM: number;
  badge: string;
}

export const LLM_MODELS: LlmModelSpec[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', inputPerM: 0, outputPerM: 0, badge: 'Gratis' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'gemini', inputPerM: 0, outputPerM: 0, badge: 'Gratis' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'gemini', inputPerM: 0, outputPerM: 0, badge: 'Gratis' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', inputPerM: 0, outputPerM: 0, badge: 'Tu Gemini' },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: 'openrouter', inputPerM: 0.1, outputPerM: 0.5, badge: 'Económico' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'openrouter', inputPerM: 2, outputPerM: 10, badge: 'Calidad' },
  { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 mini', provider: 'openrouter', inputPerM: 0.75, outputPerM: 4.5, badge: 'OpenRouter' },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'openrouter', inputPerM: 0.0116, outputPerM: 1.28, badge: 'OpenRouter' },
];

/** Modelo de pago por defecto en OpenRouter: el más barato de Claude. */
export const OPENROUTER_DEFAULT_TEXT_MODEL = 'anthropic/claude-haiku-5.5';

export function llmCost(modelId: string, inputTokens = 0, outputTokens = 0): number {
  const m = LLM_MODELS.find((x) => x.id === modelId);
  if (!m) return 0;
  return (inputTokens * m.inputPerM + outputTokens * m.outputPerM) / 1_000_000;
}

/**
 * Modelo del modo gratis del orquestador (guiones, modo Director, Mia…).
 * Para probar otro con nivel gratis basta cambiar esta línea: 'gemini-3.6-flash' o 'gemini-3.8-flash'.
 */
export const FREE_GEMINI_MODEL = 'gemini-2.5-flash';

/** Quién maneja el "cerebro" de la app (guiones, escenas, dar emoción…). */
export type OrchestratorMode = 'free' | 'claude-subscription' | 'claude-apikey' | 'claude-cheap' | 'claude-quality';

/** Modos que ejecutan Claude Code en este PC (con suscripción Pro/Max o con clave de API). */
export function isClaudeCodeMode(v: unknown): v is 'claude-subscription' | 'claude-apikey' {
  return v === 'claude-subscription' || v === 'claude-apikey';
}

/** Modelo que usa Claude Code (alias del CLI: 'opus', 'sonnet', 'haiku'). */
export type ClaudeModelTier = 'opus' | 'sonnet' | 'haiku';

export interface ClaudeTierOption {
  id: ClaudeModelTier;
  label: string;
  description: string;
}

export const CLAUDE_TIER_OPTIONS: ClaudeTierOption[] = [
  { id: 'opus', label: 'Opus 5.5', description: 'Para trabajo complejo y tareas cotidianas' },
  { id: 'sonnet', label: 'Sonnet 5.5', description: 'Más eficiente para tareas más simples' },
  { id: 'haiku', label: 'Haiku 5.5', description: 'Más rápido para respuestas rápidas' },
];

export function isClaudeModelTier(v: unknown): v is ClaudeModelTier {
  return v === 'opus' || v === 'sonnet' || v === 'haiku';
}

/** Nivel de esfuerzo / razonamiento (thinking budget) de Claude Code. */
export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeEffortOption {
  id: ClaudeEffortLevel;
  label: string;
  badge?: string;
  description: string;
}

export const CLAUDE_EFFORT_OPTIONS: ClaudeEffortOption[] = [
  { id: 'low', label: 'Bajo', description: 'Respuestas más rápidas y menor consumo de tokens' },
  { id: 'medium', label: 'Medio', badge: 'Recomendado', description: 'Equilibrio ideal entre razonamiento y gasto' },
  { id: 'high', label: 'Alto', description: 'Respuestas más completas y análisis detallado' },
  { id: 'xhigh', label: 'Extra', description: 'Razonamiento intensivo para problemas difíciles' },
  { id: 'max', label: 'Máx', badge: '4x uso', description: 'Máximo esfuerzo de razonamiento' },
];

export function isClaudeEffortLevel(v: unknown): v is ClaudeEffortLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh' || v === 'max';
}

/**
 * Modelo y esfuerzo de Claude Code por defecto: Opus 5.5 con Esfuerzo Medio.
 * Se pueden cambiar en el selector superior o vía .env.local.
 */
export const CLAUDE_SUBSCRIPTION_MODEL: ClaudeModelTier = 'opus';
export const CLAUDE_DEFAULT_EFFORT: ClaudeEffortLevel = 'medium';

export interface OrchestratorOption {
  mode: OrchestratorMode;
  label: string;
  short: string;
  model: string;
  description: string;
}

export const ORCHESTRATOR_OPTIONS: OrchestratorOption[] = [
  {
    mode: 'free',
    label: 'Gratis · Gemini',
    short: 'Gratis',
    model: FREE_GEMINI_MODEL,
    description: 'Tus claves de Gemini (free tier). $0. Google puede usar los datos para mejorar sus productos.',
  },
  {
    mode: 'claude-subscription',
    label: 'Claude · mi suscripción',
    short: 'Claude Pro',
    model: `claude-code:${CLAUDE_SUBSCRIPTION_MODEL}`,
    description: 'Claude Code de este PC con tu plan Pro/Max. $0 extra: usa tu cupo (ventana de 5 h y semanal).',
  },
  {
    mode: 'claude-apikey',
    label: 'Claude · API Key',
    short: 'Claude Key',
    model: `claude-code:${CLAUDE_SUBSCRIPTION_MODEL}`,
    description: 'Claude Code con tu clave de API (OneProvider / Anthropic). Sin gastar el cupo de tu plan Pro.',
  },
  {
    mode: 'claude-cheap',
    label: 'Claude económico · Haiku 5.5',
    short: 'Claude Haiku',
    model: 'anthropic/claude-haiku-5.5',
    description: 'Vía OpenRouter. $0.10 / $0.50 por millón de tokens.',
  },
  {
    mode: 'claude-quality',
    label: 'Claude calidad · Sonnet 5.5',
    short: 'Claude Sonnet',
    model: 'anthropic/claude-sonnet-5.5',
    description: 'Vía OpenRouter. $2 / $10 por millón de tokens.',
  },
];

export const DEFAULT_ORCHESTRATOR: OrchestratorMode = 'free';

export function isOrchestratorMode(v: unknown): v is OrchestratorMode {
  return v === 'free' || v === 'claude-subscription' || v === 'claude-apikey' || v === 'claude-cheap' || v === 'claude-quality';
}

export function getOrchestratorOption(mode: OrchestratorMode): OrchestratorOption {
  return ORCHESTRATOR_OPTIONS.find((o) => o.mode === mode) ?? ORCHESTRATOR_OPTIONS[0];
}
