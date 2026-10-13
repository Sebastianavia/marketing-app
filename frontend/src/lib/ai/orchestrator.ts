import { generateObject, generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { z } from 'zod';
import { openrouter } from '@/lib/ai/openrouter';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';
import { getSettings } from '@/lib/data/settings';
import { recordUsage } from '@/lib/usage/usage-store';
import { errorMessage } from '@/lib/errors';
import {
  DEFAULT_ORCHESTRATOR,
  getOrchestratorOption,
  isOrchestratorMode,
  llmCost,
  type OrchestratorMode,
} from '@/config/llm-models';

/**
 * Orquestador: un solo punto para todo el texto que genera la app.
 * - 'free'  → pool de claves de Gemini (free tier), rota si una falla.
 * - 'claude-*' → Claude vía OpenRouter, con costo real por tokens.
 * Si el modo gratis se queda sin cuota NO salta a Claude solo:
 * lanza FreeQuotaError y la interfaz pregunta antes de gastar.
 */

export class FreeQuotaError extends Error {
  readonly code = 'free_exhausted';
  constructor(detail: string) {
    super(`Gemini gratis no respondió con ninguna de tus claves (${detail}). Puedes esperar o usar Claude.`);
  }
}

export interface OrchestratorCall {
  /** Para el registro de Costos. */
  tool: string;
  description: string;
  system?: string;
  prompt: string;
  temperature?: number;
  /** Fuerza un modo solo para esta llamada (si no, el de Ajustes). */
  mode?: unknown;
  /** Archivos adjuntos (p. ej. un PDF) que el modelo debe leer. */
  files?: Array<{ data: Uint8Array; mediaType: string; filename?: string }>;
}

/** prompt simple, o mensaje con archivos adjuntos si los hay. */
function promptOrMessages(call: OrchestratorCall) {
  if (!call.files?.length) return { prompt: call.prompt };
  return {
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: call.prompt },
          ...call.files.map((f) => ({
            type: 'file' as const,
            data: f.data,
            mediaType: f.mediaType,
            ...(f.filename ? { filename: f.filename } : {}),
          })),
        ],
      },
    ],
  };
}

export interface OrchestratorMeta {
  mode: OrchestratorMode;
  model: string;
  provider: 'gemini' | 'openrouter';
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

export async function resolveMode(requested?: unknown): Promise<OrchestratorMode> {
  if (isOrchestratorMode(requested)) return requested;
  const s = await getSettings();
  return isOrchestratorMode(s.orchestrator) ? s.orchestrator : DEFAULT_ORCHESTRATOR;
}

type Runner<T> = (model: Parameters<typeof generateText>[0]['model']) => Promise<{
  value: T;
  inputTokens?: number;
  outputTokens?: number;
}>;

async function run<T>(call: OrchestratorCall, runner: Runner<T>): Promise<{ value: T; meta: OrchestratorMeta }> {
  const mode = await resolveMode(call.mode);
  const option = getOrchestratorOption(mode);

  let value: T;
  let inputTokens = 0;
  let outputTokens = 0;
  let provider: OrchestratorMeta['provider'];

  if (mode === 'free') {
    provider = 'gemini';
    const keys = getGeminiKeyPool();
    if (keys.length === 0) throw new FreeQuotaError('no hay claves en GEMINI_API_KEYS');
    let lastErr: unknown = null;
    let done = false;
    let result: Awaited<ReturnType<Runner<T>>> | null = null;
    for (let i = 0; i < keys.length && !done; i++) {
      try {
        const google = createGoogleGenerativeAI({ apiKey: keys[i] });
        result = await runner(google(option.model));
        done = true;
      } catch (err) {
        lastErr = err;
        console.warn(`[orquestador] Gemini clave #${i + 1} (${maskApiKey(keys[i])}) falló:`, errorMessage(err, ''));
      }
    }
    if (!done || !result) throw new FreeQuotaError(errorMessage(lastErr, 'sin respuesta'));
    value = result.value;
    inputTokens = result.inputTokens ?? 0;
    outputTokens = result.outputTokens ?? 0;
  } else {
    provider = 'openrouter';
    if (!process.env.OPENROUTER_API_KEY) throw new Error('Falta OPENROUTER_API_KEY en .env.local para usar Claude.');
    // Chat Completions: la API principal de OpenRouter
    const result = await runner(openrouter.chat(option.model));
    value = result.value;
    inputTokens = result.inputTokens ?? 0;
    outputTokens = result.outputTokens ?? 0;
  }

  const costUSD = mode === 'free' ? 0 : llmCost(option.model, inputTokens, outputTokens);
  const tokens = inputTokens + outputTokens;
  await recordUsage({
    tool: call.tool,
    kind: 'script',
    provider,
    model: option.model,
    description: call.description,
    units: tokens || 1,
    unit: tokens ? 'tokens' : 'texto',
    costUSD,
    estimated: mode !== 'free' && tokens === 0,
  });

  return { value, meta: { mode, model: option.model, provider, inputTokens, outputTokens, costUSD } };
}

export async function orchestrateText(call: OrchestratorCall) {
  const { value, meta } = await run<string>(call, async (model) => {
    const r = await generateText({ model, system: call.system, ...promptOrMessages(call), temperature: call.temperature ?? 0.7 });
    return { value: r.text, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens };
  });
  return { text: value, meta };
}

export async function orchestrateObject<S extends z.ZodType>(call: OrchestratorCall & { schema: S }) {
  const { value, meta } = await run<z.infer<S>>(call, async (model) => {
    const r = await generateObject({
      model,
      schema: call.schema,
      system: call.system,
      ...promptOrMessages(call),
      temperature: call.temperature ?? 0.7,
    });
    return { value: r.object as z.infer<S>, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens };
  });
  return { object: value, meta };
}

/** Respuesta HTTP estándar para errores del orquestador. */
export function orchestratorErrorResponse(err: unknown) {
  if (err instanceof FreeQuotaError) {
    return Response.json({ error: err.message, code: err.code }, { status: 409 });
  }
  return Response.json({ error: errorMessage(err, 'No se pudo generar el texto.') }, { status: 500 });
}
