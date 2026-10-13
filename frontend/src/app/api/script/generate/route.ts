import { NextRequest, NextResponse } from 'next/server';
import { orchestrateText, orchestratorErrorResponse } from '@/lib/ai/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 45;

const SYSTEM_PROMPT = `Eres un director de video marketing y guionista publicitario de élite.
Tu objetivo es redactar un guion corto y de altísima retención en español neutro para ser leído por un avatar con lip-sync en formato vertical (TikTok, Instagram Reels, YouTube Shorts).
Reglas estrictas:
- Duración: 15 a 30 segundos de locución (máximo 50 a 65 palabras).
- Tono: Natural, persuasivo, directo al beneficio.
- PROHIBIDO incluir acotaciones de cámara, notas entre corchetes, nombres de personajes o indicaciones de audio.
- Retorna ÚNICAMENTE las palabras textuales que el avatar dirá frente a cámara.`;

/** Guion corto para avatar o voz. Lo genera el orquestador (Gemini gratis o Claude). */
export async function POST(req: NextRequest) {
  try {
    const { prompt, tool = 'avatar-studio', orchestrator } = await req.json();

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'El prompt o idea para el guion es obligatorio.' }, { status: 400 });
    }

    const { text, meta } = await orchestrateText({
      tool: String(tool),
      description: `Guion · "${prompt.trim().slice(0, 60)}${prompt.trim().length > 60 ? '…' : ''}"`,
      system: SYSTEM_PROMPT,
      prompt: `Idea o producto para el anuncio: ${prompt.trim()}`,
      temperature: 0.7,
      mode: orchestrator,
    });

    return NextResponse.json({
      script: text.trim().replace(/^["']|["']$/g, ''),
      model: meta.model,
      provider: meta.mode === 'free' ? 'Gemini (gratis)' : 'Claude vía OpenRouter',
      orchestrator: meta.mode,
      costUSD: meta.costUSD,
    });
  } catch (error) {
    return orchestratorErrorResponse(error);
  }
}
