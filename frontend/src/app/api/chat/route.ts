import { streamText } from 'ai';
import { openrouter } from '@/lib/ai/openrouter';
import { OPENROUTER_DEFAULT_TEXT_MODEL, llmCost } from '@/config/llm-models';
import { recordUsage } from '@/lib/usage/usage-store';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model: openrouter(OPENROUTER_DEFAULT_TEXT_MODEL),
      system: `Eres un Director Creativo y Copywriter de élite especializado en video marketing para TikTok, Reels y Shorts.
Tu trabajo es generar guiones persuasivos y estructurados con:
1. Gancho disruptivo (0-3s).
2. Problema / Deseo del consumidor (3-15s).
3. Solución y Demostración (15-25s).
4. Llamado a la Acción (CTA) directo (25-30s).
Incluye siempre sugerencias visuales y de entonación para el avatar/locutor.`,
      messages,
      onFinish: async ({ totalUsage }) => {
        const inputTokens = totalUsage?.inputTokens ?? 0;
        const outputTokens = totalUsage?.outputTokens ?? 0;
        await recordUsage({
          tool: 'chat',
          kind: 'script',
          provider: 'openrouter',
          model: OPENROUTER_DEFAULT_TEXT_MODEL,
          description: 'Chat de guiones',
          units: inputTokens + outputTokens,
          unit: 'tokens',
          costUSD: llmCost(OPENROUTER_DEFAULT_TEXT_MODEL, inputTokens, outputTokens),
          estimated: false,
        });
      },
    });

    return result.toTextStreamResponse();
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
