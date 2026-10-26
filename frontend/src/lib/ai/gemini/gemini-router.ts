import { APICallError, generateText, Output, ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { z } from 'zod';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';
import { getFreeTierModels } from './gemini-models';
import { GEMINI_FALLBACK_MODELS, GEMINI_MODELS_PER_KEY } from '@/config/gemini-free-tier.config';
import { geminiQuota, SlotQuotaSnapshot } from './gemini-quota';

/**
 * Router round-robin sobre (llave × modelo).
 *
 * Los slots se ordenan k1·m1, k1·m2, k1·m3, k2·m1, ... Cada llamada de un agente arranca
 * en el siguiente slot del cursor, así varios agentes en paralelo quedan en modelos/llaves
 * distintos. Si el slot está cerca de agotarse (cambio preventivo), en cooldown o responde
 * 429/503, se pasa al siguiente slot.
 */

const MAX_WAIT_FOR_SLOT_MS = 65_000;
const MAX_TOTAL_WAIT_MS = 4 * 60_000; // tope por llamada de agente antes de rendirse
const OVERLOAD_BASE_COOLDOWN_MS = 45_000;
const OVERLOAD_MAX_COOLDOWN_MS = 10 * 60_000;
const MAX_ATTEMPTS_ON_BAD_OUTPUT = 3;
const CALL_TIMEOUT_MS = 75_000; // una llamada colgada no debe bloquear al agente

export interface GeminiSlot {
  id: string;
  keyIndex: number; // 1-based, para mostrar en UI
  keyMasked: string;
  key: string;
  model: string;
  reserve: boolean; // modelo de respaldo: solo se usa si todos los principales están saturados/agotados
}

export interface SlotUseInfo {
  agentId: string;
  keyIndex: number;
  keyMasked: string;
  model: string;
}

export interface SlotReport extends SlotQuotaSnapshot {
  id: string;
  reserve: boolean;
  keyIndex: number;
  keyMasked: string;
  model: string;
}

export class GeminiQuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiQuotaExhaustedError';
  }
}

export interface GenerateObjectParams<T> {
  agentId: string;
  system: string;
  messages: ModelMessage[];
  schema: z.ZodType<T>;
  temperature?: number;
  onSlot?: (info: SlotUseInfo) => void;
  abortSignal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

// Estado en globalThis para que sobreviva recargas de módulos en dev
const routerState = globalThis as unknown as { __geminiRouterCursor?: number; __geminiModelStrikes?: Record<string, number> };
const modelStrikes = (routerState.__geminiModelStrikes ??= {});

class GeminiRouter {
  private get cursor(): number {
    return routerState.__geminiRouterCursor ?? 0;
  }
  private set cursor(value: number) {
    routerState.__geminiRouterCursor = value;
  }

  async getSlots(): Promise<GeminiSlot[]> {
    const keys = getGeminiKeyPool();
    if (keys.length === 0) {
      throw new GeminiQuotaExhaustedError('No hay API keys de Gemini configuradas (GEMINI_API_KEYS en .env).');
    }
    const discovered = await getFreeTierModels(keys[0]);
    const models = discovered.slice(0, GEMINI_MODELS_PER_KEY);
    const reserveModels = [...discovered.slice(GEMINI_MODELS_PER_KEY), ...GEMINI_FALLBACK_MODELS.slice(0, 1)].filter(
      (m, i, all) => !models.includes(m) && all.indexOf(m) === i
    );
    const build = (model: string, reserve: boolean) =>
      keys.map((key, k) => ({ id: `${maskApiKey(key)}|${model}`, keyIndex: k + 1, keyMasked: maskApiKey(key), key, model, reserve }));

    // Orden k1·m1, k1·m2, k1·m3, k2·m1, ... y al final la reserva (k1·r, k2·r, ...)
    const primary = keys.flatMap((_, k) => models.map((model) => build(model, false)[k]));
    return [...primary, ...reserveModels.flatMap((m) => build(m, true))];
  }

  /**
   * Alta demanda (503) o timeouts afectan al modelo, no a la llave: se enfría ese modelo en
   * todas las llaves con un tiempo que crece con cada fallo seguido (45 s, 90 s, 3 min... hasta 10 min).
   * Así los siguientes agentes saltan directo a otro modelo en vez de esperar al mismo fallo.
   */
  private penalizeModel(slots: GeminiSlot[], model: string, reason: string): void {
    const strikes = (modelStrikes[model] = (modelStrikes[model] ?? 0) + 1);
    const ms = Math.min(OVERLOAD_MAX_COOLDOWN_MS, OVERLOAD_BASE_COOLDOWN_MS * 2 ** (strikes - 1));
    slots.filter((s) => s.model === model).forEach((s) => geminiQuota.cooldown(s.id, ms));
    console.warn(`[GeminiRouter] ${reason}. ${model} en pausa ${Math.round(ms / 1000)} s (fallo #${strikes}).`);
  }

  async report(): Promise<SlotReport[]> {
    const slots = await this.getSlots();
    return slots.map((s) => ({
      id: s.id,
      keyIndex: s.keyIndex,
      keyMasked: s.keyMasked,
      model: s.model,
      reserve: s.reserve,
      ...geminiQuota.snapshot(s.id, s.model),
    }));
  }

  /** Genera un objeto validado con zod usando el primer slot disponible en orden round-robin. */
  async generateObject<T>(params: GenerateObjectParams<T>): Promise<T> {
    const all = await this.getSlots();
    const primary = all.filter((s) => !s.reserve);
    const start = this.cursor++ % primary.length;
    // Round-robin sobre los principales a partir del cursor; la reserva siempre al final
    // Reserva: por modelo (más reciente primero), rotando la llave inicial para repartir la cuota
    const reserve = all.filter((s) => s.reserve);
    const keyCount = Math.max(1, new Set(all.map((s) => s.keyIndex)).size);
    const rotate = <S,>(arr: S[], n: number) => [...arr.slice(n % arr.length), ...arr.slice(0, n % arr.length)];
    const reserveOrdered = [...new Set(reserve.map((s) => s.model))].flatMap((m) =>
      rotate(reserve.filter((s) => s.model === m), start % keyCount)
    );
    const slots = [...primary.slice(start), ...primary.slice(0, start), ...reserveOrdered];
    const startedAt = Date.now();
    const blockedModels = new Set<string>(); // modelos que rechazaron este pedido (filtro de contenido / 400)
    let badOutputAttempts = 0;
    let lastError: unknown = null;
    // Primero se respeta el umbral de cambio preventivo; si solo quedan slots por debajo, se usan igual
    let allowLowReserve = false;

    while (true) {
      let attemptedAny = false;
      let skippedForReserve = false;

      for (const slot of slots) {
        params.abortSignal?.throwIfAborted();
        if (blockedModels.has(slot.model)) continue;
        const { ok, lowReserve } = geminiQuota.availability(slot.id, slot.model, allowLowReserve);
        if (!ok) {
          if (lowReserve) skippedForReserve = true;
          continue;
        }

        attemptedAny = true;
        geminiQuota.reserve(slot.id);
        params.onSlot?.({ agentId: params.agentId, keyIndex: slot.keyIndex, keyMasked: slot.keyMasked, model: slot.model });

        try {
          const google = createGoogleGenerativeAI({ apiKey: slot.key });
          const result = await generateText({
            model: google(slot.model),
            system: params.system,
            messages: params.messages,
            output: Output.object({ schema: params.schema }),
            temperature: params.temperature ?? 0.7,
            maxRetries: 0,
            abortSignal: params.abortSignal
              ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
              : AbortSignal.timeout(CALL_TIMEOUT_MS),
            // Los modelos 3.x razonan por defecto en "high": para estas tareas basta "low" y responde mucho más rápido
            providerOptions: /^gemini-[3-9]/.test(slot.model) ? { google: { thinkingConfig: { thinkingLevel: 'low' } } } : undefined,
          });
          geminiQuota.recordTokens(slot.id, result.usage?.totalTokens ?? 0);
          if (result.finishReason === 'content-filter') {
            // El filtro es del modelo, no de la llave: probar con otro modelo
            blockedModels.add(slot.model);
            lastError = new Error(`El filtro de contenido de ${slot.model} bloqueó la solicitud (${result.rawFinishReason ?? 'content-filter'}).`);
            console.warn(`[GeminiRouter] ${params.agentId}: ${(lastError as Error).message} Probando otro modelo.`);
            continue;
          }
          if (!result.text?.trim()) {
            throw new Error(`respuesta vacía (finishReason=${result.finishReason}, raw=${result.rawFinishReason ?? ''})`);
          }
          modelStrikes[slot.model] = 0;
          return result.output as T;
        } catch (err) {
          lastError = err;
          if (params.abortSignal?.aborted) throw err;
          if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
            this.penalizeModel(slots, slot.model, `${params.agentId}: timeout en ${slot.model}`);
            continue;
          }

          if (APICallError.isInstance(err)) {
            const status = err.statusCode ?? 0;
            if (status === 429) {
              geminiQuota.handleRateLimit(slot.id, err.responseBody);
              console.warn(`[GeminiRouter] ${params.agentId}: 429 en llave #${slot.keyIndex} · ${slot.model}. Cambiando de slot.`);
              continue;
            }
            if (status >= 500 || status === 0) {
              this.penalizeModel(slots, slot.model, `${params.agentId}: ${status} en ${slot.model} (${err.message.slice(0, 80)})`);
              continue;
            }
            if (status === 404 || status === 403) {
              geminiQuota.cooldown(slot.id, 10 * 60_000);
              continue;
            }
            // 400: el modelo no acepta esta petición (parámetro o schema no soportado): probar otro modelo
            blockedModels.add(slot.model);
            console.warn(`[GeminiRouter] ${params.agentId}: ${status} en ${slot.model} (${err.message.slice(0, 160)}). Probando otro modelo.`);
            continue;
          }

          // JSON inválido / no cumple el schema: reintentar en otro slot unas pocas veces
          if (++badOutputAttempts >= MAX_ATTEMPTS_ON_BAD_OUTPUT) throw err;
          const e = err as any;
          console.warn(
            `[GeminiRouter] ${params.agentId}: salida inválida en ${slot.model} (${e?.name}: ${e?.message}). Reintentando.`
          );
        }
      }

      const usable = slots.filter((s) => !blockedModels.has(s.model));
      if (usable.length === 0) {
        throw new Error(
          `Todos los modelos de Gemini rechazaron la solicitud de "${params.agentId}". Último error: ${(lastError as Error)?.message ?? 'ninguno'}`
        );
      }
      if (!attemptedAny && skippedForReserve && !allowLowReserve) {
        allowLowReserve = true;
        continue;
      }

      // Recalcular tras la vuelta: los slots que acaban de fallar quedaron en pausa con su propio tiempo
      const minWait = Math.min(
        ...usable.map((s) => geminiQuota.availability(s.id, s.model, allowLowReserve)).map((a) => (a.ok ? 0 : a.waitMs || Infinity))
      );
      if (minWait === Infinity) {
        throw new GeminiQuotaExhaustedError(
          lastError
            ? `Gemini no pudo atender a "${params.agentId}": ${(lastError as Error).message}`
            : 'Todas las llaves y modelos de Gemini agotaron su cuota gratuita por hoy (se reinicia a medianoche hora del Pacífico).'
        );
      }
      const wait = Math.min(minWait, MAX_WAIT_FOR_SLOT_MS);
      if (Date.now() - startedAt + wait > MAX_TOTAL_WAIT_MS) {
        throw new GeminiQuotaExhaustedError(
          `Gemini no respondió a tiempo para "${params.agentId}" (modelos saturados o sin cuota). Último error: ${
            (lastError as Error)?.message ?? 'ninguno'
          }`
        );
      }
      if (wait > 0) await sleep(wait, params.abortSignal);
    }
  }
}

export const geminiRouter = new GeminiRouter();
