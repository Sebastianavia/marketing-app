import { streamText } from 'ai';
import { openrouter } from '@/lib/ai/openrouter';

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model: openrouter('anthropic/claude-3.5-sonnet'),
      system: `Eres un Director Creativo y Copywriter de élite especializado en video marketing para TikTok, Reels y Shorts.
Tu trabajo es generar guiones persuasivos y estructurados con:
1. Gancho disruptivo (0-3s).
2. Problema / Deseo del consumidor (3-15s).
3. Solución y Demostración (15-25s).
4. Llamado a la Acción (CTA) directo (25-30s).
Incluye siempre sugerencias visuales y de entonación para el avatar/locutor.`,
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
