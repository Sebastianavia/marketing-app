import { orchestrateTextStream, orchestratorErrorResponse } from '@/lib/ai/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Chat de guiones: lo responde el orquestador elegido (Gemini gratis o Claude). */
export async function POST(req: Request) {
  try {
    const { messages, orchestrator, confidential } = await req.json();
    if (!Array.isArray(messages)) {
      return Response.json({ error: 'Lista de mensajes inválida.' }, { status: 400 });
    }
    return await orchestrateTextStream({
      tool: 'chat',
      description: 'Chat de guiones',
      system: `Eres un Director Creativo y Copywriter de élite especializado en video marketing para TikTok, Reels y Shorts.
Tu trabajo es generar guiones persuasivos y estructurados con:
1. Gancho disruptivo (0-3s).
2. Problema / Deseo del consumidor (3-15s).
3. Solución y Demostración (15-25s).
4. Llamado a la Acción (CTA) directo (25-30s).
Incluye siempre sugerencias visuales y de entonación para el avatar/locutor.`,
      messages: messages.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: String(m.content) })),
      mode: orchestrator,
      confidential: Boolean(confidential),
    });
  } catch (err) {
    return orchestratorErrorResponse(err);
  }
}
