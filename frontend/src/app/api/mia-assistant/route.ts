import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { resolveAssistantSystemPrompt } from '@/lib/ai/mia-skills';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';
import { orchestrateTextStream, orchestratorErrorResponse } from '@/lib/ai/orchestrator';
import { llmCost } from '@/config/llm-models';
import { recordUsage } from '@/lib/usage/usage-store';

export const maxDuration = 45;

export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      activeTool,
      activeSkillId,
      selectedModel = 'orchestrator',
      customApiKey,
      orchestrator,
    } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Lista de mensajes inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = resolveAssistantSystemPrompt(activeTool, activeSkillId);

    // "Según selector IA": lo decide el orquestador (Gratis / Claude), igual que el resto de la app
    if (selectedModel === 'orchestrator') {
      try {
        return await orchestrateTextStream({
          tool: activeTool ? String(activeTool) : 'mia',
          description: 'Mia (asistente)',
          mode: orchestrator,
          system: systemPrompt,
          messages: messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: String(m.content) })),
        });
      } catch (err) {
        return orchestratorErrorResponse(err);
      }
    }

    // =========================================================================
    // 1. POOL DE LLAVES GEMINI CON FAILOVER AUTOMÁTICO (Multi-Key Rotation)
    // =========================================================================
    const isGeminiModel =
      selectedModel.startsWith('gemini') ||
      selectedModel.includes('google/') ||
      selectedModel.includes('gemini');

    const geminiKeys = getGeminiKeyPool(customApiKey);

    // Un modelo de Gemini elegido sin claves NO se manda a OpenRouter (sería de pago sin avisar)
    if (isGeminiModel && geminiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No hay claves de Gemini (GEMINI_API_KEYS en .env.local). Elige un modelo de Claude o añade una clave en el icono 🔑.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (geminiKeys.length > 0 && isGeminiModel) {
      let cleanGeminiModel = selectedModel.replace('google/', '');
      if (
        cleanGeminiModel === 'gemini-2.0-flash' ||
        cleanGeminiModel === 'gemini-2.0-flash-001' ||
        cleanGeminiModel === 'gemini-1.5-flash' ||
        cleanGeminiModel === 'gemini-flash'
      ) {
        cleanGeminiModel = 'gemini-2.5-flash';
      } else if (
        cleanGeminiModel === 'gemini-1.5-pro' ||
        cleanGeminiModel === 'gemini-pro'
      ) {
        cleanGeminiModel = 'gemini-2.5-pro';
      }

      let lastError: any = null;

      // Iterar por cada llave del pool si la anterior se agota (Failover / Rotación)
      for (let i = 0; i < geminiKeys.length; i++) {
        const currentKey = geminiKeys[i];
        const masked = maskApiKey(currentKey);

        try {
          const google = createGoogleGenerativeAI({
            apiKey: currentKey,
          });

          const result = streamText({
            model: google(cleanGeminiModel),
            system: systemPrompt,
            messages: messages.map((m: any) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: 0.7,
          });

          // Probar lectura del primer token para verificar que la cuota no esté agotada (429)
          const reader = result.textStream.getReader();
          const { value: firstChunk, done: firstDone } = await reader.read();

          // ¡Esta llave es válida y tiene cuota disponible!
          const combinedStream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              if (firstChunk) {
                controller.enqueue(encoder.encode(firstChunk));
              }

              if (firstDone) {
                controller.close();
                return;
              }

              try {
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (value) {
                    controller.enqueue(encoder.encode(value));
                  }
                }
                controller.close();
              } catch (streamErr) {
                controller.error(streamErr);
              }
            },
          });

          return new Response(combinedStream, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Transfer-Encoding': 'chunked',
              'X-Gemini-Key-Used': masked,
              'X-Gemini-Key-Index': String(i + 1),
              'X-Gemini-Total-Keys': String(geminiKeys.length),
            },
          });
        } catch (keyErr: any) {
          console.warn(
            `[Gemini Pool] Llave #${i + 1} (${masked}) agotada o con error: ${keyErr.message}. Conmutando a la siguiente llave...`
          );
          lastError = keyErr;
          continue;
        }
      }

      console.error('[Gemini Pool] Todas las llaves de Gemini en el pool fueron agotadas.');
      return new Response(
        JSON.stringify({
          error: `Todas las llaves de Gemini (${geminiKeys.length}) alcanzaron su límite de cuota o presentaron error: ${lastError?.message || 'Límite excedido'}. Agrega otra llave en el icono 🔑 del Asistente.`,
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // =========================================================================
    // 2. CONEXIÓN CON OPENROUTER (Si usa Claude, GPT-4 o una llave de OpenRouter)
    // =========================================================================
    const openrouterKey =
      customApiKey?.trim().startsWith('sk-')
        ? customApiKey.trim()
        : process.env.OPENROUTER_API_KEY?.trim() || '';

    if (openrouterKey) {
      const client = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openrouterKey,
        headers: {
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Lulo Studio Desktop',
        },
      });

      const modelId = selectedModel.includes('/')
        ? selectedModel
        : `google/${selectedModel}`;

      const result = streamText({
        model: client.chat(modelId),
        system: systemPrompt,
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0.7,
        onFinish: async ({ totalUsage }) => {
          const inT = totalUsage?.inputTokens ?? 0;
          const outT = totalUsage?.outputTokens ?? 0;
          await recordUsage({
            tool: activeTool ? String(activeTool) : 'mia',
            kind: 'script',
            provider: 'openrouter',
            model: modelId,
            description: 'Mia (asistente)',
            units: inT + outT || 1,
            unit: inT + outT ? 'tokens' : 'respuesta',
            costUSD: llmCost(modelId, inT, outT),
            estimated: inT + outT === 0,
          });
        },
      });

      return result.toTextStreamResponse();
    }

    // Sin claves no se inventan respuestas: se explica qué falta
    return new Response(
      JSON.stringify({ error: 'Mia necesita GEMINI_API_KEYS (gratis) u OPENROUTER_API_KEY en .env.local.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Error en el Asistente' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
