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
export type OrchestratorMode = 'free' | 'claude-cheap' | 'claude-quality';

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
  return v === 'free' || v === 'claude-cheap' || v === 'claude-quality';
}

export function getOrchestratorOption(mode: OrchestratorMode): OrchestratorOption {
  return ORCHESTRATOR_OPTIONS.find((o) => o.mode === mode) ?? ORCHESTRATOR_OPTIONS[0];
}
