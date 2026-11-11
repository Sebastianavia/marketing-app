import { generateObject, generateText, streamText, type ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { openrouter } from '@/lib/ai/openrouter';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';
import { getSettings } from '@/lib/data/settings';
import { recordUsage } from '@/lib/usage/usage-store';
import { errorMessage } from '@/lib/errors';
import { ClaudeCodeError, runClaudeCode, type ClaudeCodeResult } from '@/lib/ai/claude-code/bridge';
import {
  CLAUDE_SUBSCRIPTION_MODEL,
  DEFAULT_ORCHESTRATOR,
  getOrchestratorOption,
  isClaudeCodeMode,
  isOrchestratorMode,
  llmCost,
  type OrchestratorMode,
} from '@/config/llm-models';

/**
 * Orquestador: un solo punto para todo el texto que genera la app.
 * - 'free'  → pool de claves de Gemini (free tier), rota si una falla.
 * - 'claude-subscription' → Claude Code de este PC con la suscripción de la persona ($0 extra).
 * - 'claude-apikey' → Claude Code con clave de API (p. ej. OneProvider).
 * - 'claude-cheap' / 'claude-quality' → Claude vía OpenRouter, con costo real por tokens.
 * Si un modo sin costo (Gemini gratis o la suscripción) no está disponible NO salta a pago solo:
 * lanza FreeQuotaError y la interfaz pregunta antes de gastar.
 */

export class FreeQuotaError extends Error {
  readonly code = 'free_exhausted';
  constructor(detail: string, message?: string) {
    super(message ?? `Gemini gratis no respondió con ninguna de tus claves (${detail}). Puedes esperar o usar Claude.`);
  }
}

/** Modelo de Claude Code: CLAUDE_CODE_MODEL en .env.local, los ajustes de la app o el predeterminado. */
async function subscriptionModel(): Promise<string> {
  const envModel = process.env.CLAUDE_CODE_MODEL?.trim();
  if (envModel) return envModel;
  const s = await getSettings().catch(() => ({ claudeModel: undefined }));
  return s.claudeModel || CLAUDE_SUBSCRIPTION_MODEL;
}

/**
 * Llama a Claude Code (con suscripción o con API Key). Si no está instalado, sin sesión o sin cupo,
 * lanza FreeQuotaError (mismo flujo que Gemini agotado: la interfaz pregunta antes de pagar).
 */
async function callSubscription(req: Parameters<typeof runClaudeCode>[0]): Promise<ClaudeCodeResult> {
  try {
    const model = await subscriptionModel();
    return await runClaudeCode({ ...req, model });
  } catch (err) {
    if (err instanceof ClaudeCodeError && err.reason !== 'failed') {
      throw new FreeQuotaError(err.reason, `${err.message} Puedes esperar o cambiar de opción en el selector IA.`);
    }
    throw err;
  }
}

async function recordSubscription(
  call: { tool: string; description: string },
  r: ClaudeCodeResult,
  mode: 'claude-subscription' | 'claude-apikey' = 'claude-subscription'
) {
  const tokens = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens + r.usage.outputTokens;
  const label = mode === 'claude-apikey' ? 'API Key' : 'suscripción';
  await recordUsage({
    tool: call.tool,
    kind: 'script',
    provider: 'claude-code',
    model: r.model,
    description: `${call.description} · ${label} (≈ $${r.equivalentCostUSD.toFixed(4)} por API)`,
    units: tokens || 1,
    unit: tokens ? 'tokens' : 'texto',
    costUSD: 0,
    estimated: false,
  });
}

function subscriptionMeta(
  r: ClaudeCodeResult,
  mode: 'claude-subscription' | 'claude-apikey' = 'claude-subscription'
): OrchestratorMeta {
  return {
    mode,
    model: r.model,
    provider: 'claude-code',
    inputTokens: r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens,
    outputTokens: r.usage.outputTokens,
    costUSD: 0,
  };
}

/** Une el historial del chat en un solo prompt (cada llamada al CLI es independiente). */
function messagesToPrompt(messages: ModelMessage[]): string {
  const textOf = (m: ModelMessage): string => {
    if (typeof m.content === 'string') return m.content;
    if (!Array.isArray(m.content)) return '';
    return m.content
      .map((part) => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  };
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (turns.length === 1) return textOf(turns[0]);
  const transcript = turns
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${textOf(m)}`)
    .join('\n\n');
  return `Conversación hasta ahora:\n\n${transcript}\n\nResponde como Asistente al último mensaje del Usuario. Escribe solo tu respuesta, sin el prefijo "Asistente:".`;
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
  /** Material confidencial: nunca se usa el modo gratis (Google puede usar esos datos). */
  confidential?: boolean;
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
  provider: 'gemini' | 'openrouter' | 'claude-code';
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

export async function resolveMode(requested?: unknown, confidential = false): Promise<OrchestratorMode> {
  let mode: OrchestratorMode;
  if (isOrchestratorMode(requested)) mode = requested;
  else {
    const s = await getSettings();
    mode = isOrchestratorMode(s.orchestrator) ? s.orchestrator : DEFAULT_ORCHESTRATOR;
  }
  // Confidencial: el free tier de Gemini puede usar los datos para mejorar productos de Google
  if (confidential && mode === 'free') mode = 'claude-cheap';
  return mode;
}

type Runner<T> = (model: Parameters<typeof generateText>[0]['model']) => Promise<{
  value: T;
  inputTokens?: number;
  outputTokens?: number;
}>;

async function run<T>(call: OrchestratorCall, runner: Runner<T>): Promise<{ value: T; meta: OrchestratorMeta }> {
  const mode = await resolveMode(call.mode, call.confidential);
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
  const mode = await resolveMode(call.mode, call.confidential);
  if (isClaudeCodeMode(mode)) {
    const r = await callSubscription({
      system: call.system,
      prompt: call.prompt,
      files: call.files,
      useApiKey: mode === 'claude-apikey',
    });
    await recordSubscription(call, r, mode);
    return { text: r.text, meta: subscriptionMeta(r, mode) };
  }
  const { value, meta } = await run<string>(call, async (model) => {
    const r = await generateText({ model, system: call.system, ...promptOrMessages(call), temperature: call.temperature ?? 0.7 });
    return { value: r.text, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens };
  });
  return { text: value, meta };
}

export async function orchestrateObject<S extends z.ZodType>(call: OrchestratorCall & { schema: S }) {
  const mode = await resolveMode(call.mode, call.confidential);
  if (isClaudeCodeMode(mode)) {
    const r = await callSubscription({
      system: call.system,
      prompt: call.prompt,
      files: call.files,
      jsonSchema: claudeJsonSchema(call.schema),
      useApiKey: mode === 'claude-apikey',
    });
    await recordSubscription(call, r, mode);
    // Claude Code valida contra el JSON Schema; zod aplica además lo que el schema no expresa (defaults, refine)
    const parsed = call.schema.safeParse(r.structured ?? safeJson(r.text));
    if (!parsed.success) throw new Error(`Claude devolvió una respuesta con formato inválido: ${parsed.error.message.slice(0, 300)}`);
    return { object: parsed.data as z.infer<S>, meta: subscriptionMeta(r, mode) };
  }
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

/**
 * Respuesta en streaming (chat de guiones, Mia). En modo gratis prueba cada clave
 * leyendo el primer fragmento: si falla, pasa a la siguiente sin haber enviado nada.
 */
export async function orchestrateTextStream(call: {
  tool: string;
  description: string;
  system?: string;
  messages: ModelMessage[];
  temperature?: number;
  mode?: unknown;
  confidential?: boolean;
}): Promise<Response> {
  const mode = await resolveMode(call.mode, call.confidential);
  const option = getOrchestratorOption(mode);

  if (isClaudeCodeMode(mode)) return subscriptionStream(call, mode);

  const record = async (inputTokens = 0, outputTokens = 0) => {
    const tokens = inputTokens + outputTokens;
    await recordUsage({
      tool: call.tool,
      kind: 'script',
      provider: mode === 'free' ? 'gemini' : 'openrouter',
      model: option.model,
      description: call.description,
      units: tokens || 1,
      unit: tokens ? 'tokens' : 'respuesta',
      costUSD: mode === 'free' ? 0 : llmCost(option.model, inputTokens, outputTokens),
      estimated: mode !== 'free' && tokens === 0,
    });
  };

  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Orchestrator': mode,
    'X-Model-Used': option.model,
  };

  if (mode !== 'free') {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('Falta OPENROUTER_API_KEY en .env.local para usar Claude.');
    const result = streamText({
      model: openrouter.chat(option.model),
      system: call.system,
      messages: call.messages,
      temperature: call.temperature ?? 0.7,
      onFinish: async ({ totalUsage }) => record(totalUsage?.inputTokens, totalUsage?.outputTokens),
    });
    return result.toTextStreamResponse({ headers });
  }

  const keys = getGeminiKeyPool();
  if (keys.length === 0) throw new FreeQuotaError('no hay claves en GEMINI_API_KEYS');
  let lastErr: unknown = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: keys[i] });
      const result = streamText({
        model: google(option.model),
        system: call.system,
        messages: call.messages,
        temperature: call.temperature ?? 0.7,
        onFinish: async ({ totalUsage }) => record(totalUsage?.inputTokens, totalUsage?.outputTokens),
      });
      const reader = result.textStream.getReader();
      const first = await reader.read(); // lanza aquí si la clave no tiene cuota
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          if (first.value) controller.enqueue(encoder.encode(first.value));
          if (first.done) return controller.close();
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) controller.enqueue(encoder.encode(value));
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
      return new Response(body, { headers });
    } catch (err) {
      lastErr = err;
      console.warn(`[orquestador] Gemini clave #${i + 1} (${maskApiKey(keys[i])}) falló:`, errorMessage(err, ''));
    }
  }
  throw new FreeQuotaError(errorMessage(lastErr, 'sin respuesta'));
}

/** Respuesta HTTP estándar para errores del orquestador. */
export function orchestratorErrorResponse(err: unknown) {
  if (err instanceof FreeQuotaError) {
    return Response.json({ error: err.message, code: err.code }, { status: 409 });
  }
  return Response.json({ error: errorMessage(err, 'No se pudo generar el texto.') }, { status: 500 });
}

/** JSON Schema para --json-schema: Claude Code valida con draft-07 y no reconoce el $schema de 2020-12. */
function claudeJsonSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** JSON de una respuesta de texto: tal cual, dentro de un bloque ```json o el primer {…} que aparezca. */
function safeJson(text: string): unknown {
  const tries = [text, /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const t of tries) {
    if (!t?.trim()) continue;
    try {
      return JSON.parse(t);
    } catch {
      // probar la siguiente forma
    }
  }
  return undefined;
}

/**
 * Streaming con Claude Code. Espera al primer fragmento antes de responder: si el CLI falla
 * antes (sin instalar, sin sesión, sin cupo) se lanza el error y la ruta responde 409/500 como siempre.
 */
async function subscriptionStream(
  call: {
    tool: string;
    description: string;
    system?: string;
    messages: ModelMessage[];
  },
  mode: 'claude-subscription' | 'claude-apikey' = 'claude-subscription'
): Promise<Response> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: string[] = [];
  let sent = false;
  let onFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => (onFirst = resolve));

  const push = (text: string) => {
    sent = true;
    if (controller) controller.enqueue(encoder.encode(text));
    else pending.push(text);
  };

  const run = callSubscription({
    system: call.system,
    prompt: messagesToPrompt(call.messages),
    useApiKey: mode === 'claude-apikey',
    onText: (delta) => {
      push(delta);
      onFirst();
    },
  });

  run.catch(() => {}); // el error se maneja abajo; evita un aviso de promesa sin capturar
  // Lo que llegue antes: el primer texto (se responde ya) o un error (se lanza sin haber respondido)
  await Promise.race([first, run]);

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const t of pending.splice(0)) c.enqueue(encoder.encode(t));
      run
        .then(async (r) => {
          if (!sent && r.text) c.enqueue(encoder.encode(r.text)); // respuesta sin fragmentos parciales
          c.close();
          await recordSubscription(call, r, mode);
        })
        .catch((err) => {
          c.enqueue(encoder.encode(`\n\n[Error: ${errorMessage(err, 'Claude Code no pudo terminar la respuesta.')}]`));
          c.close();
        });
    },
  });

  const activeModel = await subscriptionModel();
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Orchestrator': mode,
      'X-Model-Used': `claude-code:${activeModel}`,
    },
  });
}
