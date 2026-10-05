import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { resolveAssistantSystemPrompt } from '@/lib/ai/mia-skills';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';

export const maxDuration = 45;

export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      activeTool,
      activeSkillId,
      selectedModel = 'gemini-2.5-flash',
      customApiKey,
    } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Lista de mensajes inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = resolveAssistantSystemPrompt(activeTool, activeSkillId);

    // =========================================================================
    // 1. POOL DE LLAVES GEMINI CON FAILOVER AUTOMÁTICO (Multi-Key Rotation)
    // =========================================================================
    const isGeminiModel =
      selectedModel.startsWith('gemini') ||
      selectedModel.includes('google/') ||
      selectedModel.includes('gemini');

    const geminiKeys = getGeminiKeyPool(customApiKey);

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
        model: client(modelId),
        system: systemPrompt,
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0.7,
      });

      return result.toTextStreamResponse();
    }

    // =========================================================================
    // 3. FALLBACK INTELIGENTE LOCAL (Si no se ha ingresado ninguna API Key)
    // =========================================================================
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    let mockReply = '';

    if (activeTool === 'avatar-studio') {
      mockReply = `[Gemini Asistente]: Aquí tienes tu guion optimizado para síntesis de voz con HeyGen:\n\n"¿Sabías que el 80% de las marcas pierden ventas por videos genéricos? [pause] Con avatares fotorrealistas de última generación, puedes crear anuncios de alto impacto en minutos. Empieza hoy y escala tu conversión."\n\nPresiona el botón de abajo para inyectar este guion directamente a tu herramienta.`;
    } else if (activeTool === 'ugc-generator') {
      mockReply = `[Gemini Asistente - UGC Viral Script]:\n\n[GANCHO 0-3s]: "Si vendes online en 2026, esto te interesa..."\n[DOLOR 3-10s]: "Grabar con creadores tradicionales toma semanas y miles de dólares."\n[SOLUCIÓN 10-22s]: "Nuestra suite genera el guion persuasivo y renderiza la pieza vertical en segundos."\n[CTA 22-30s]: "Haz clic en el enlace para probar el pipeline ahora mismo."`;
    } else if (activeTool === 'text-to-video') {
      mockReply = `[Gemini Asistente - Prompt Cinemático]:\n\n"Hyper-realistic 4K commercial shot of a sleek product floating in zero gravity, anamorphic 35mm lens, volumetric dark anthracite rim lighting, subtle slow-motion smoke particles at 120fps, cinematic color grading in teal and deep carbon."`;
    } else {
      mockReply = `[Gemini Asistente Local]: ¡Hola! He recibido tu consulta: "${lastUserMsg}".\n\n💡 Configura tu pool de llaves: Haz clic en el icono 🔑 arriba para pegar una o varias claves de Gemini (separadas por comas). Si una clave se agota por límite de cuota, el sistema pasará a la siguiente automáticamente.`;
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const words = mockReply.split(' ');
        for (let i = 0; i < words.length; i++) {
          controller.enqueue(encoder.encode(words[i] + ' '));
          await new Promise((r) => setTimeout(r, 20));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
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
