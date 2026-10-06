import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  try {
    const { prompt, format = 'ugc_testimonial' } = await req.json();

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'El prompt o idea para el guion es obligatorio.' },
        { status: 400 }
      );
    }

    const geminiKeys = getGeminiKeyPool();
    if (geminiKeys.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron API Keys de Gemini en el archivo .env.local (GEMINI_API_KEYS).' },
        { status: 500 }
      );
    }

    const systemPrompt = `Eres un director de video marketing y guionista publicitario de élite.
Tu objetivo es redactar un guion corto y de altísima retención en español neutro para ser leído por un avatar con lip-sync en formato vertical (TikTok, Instagram Reels, YouTube Shorts).
Reglas estrictas:
- Duración: 15 a 30 segundos de locución (máximo 50 a 65 palabras).
- Tono: Natural, persuasivo, directo al beneficio.
- PROHIBIDO incluir acotaciones de cámara, notas entre corchetes, nombres de personajes o indicaciones de audio.
- Retorna ÚNICAMENTE las palabras textuales que el avatar dirá frente a cámara.`;

    let lastError: any = null;

    // Rotación por el Pool de API Keys de Gemini para garantizar 100% disponibilidad a coste cero
    for (let i = 0; i < geminiKeys.length; i++) {
      const key = geminiKeys[i];
      const masked = maskApiKey(key);

      try {
        const google = createGoogleGenerativeAI({ apiKey: key });

        const { text } = await generateText({
          model: google('gemini-2.5-flash'),
          system: systemPrompt,
          prompt: `Idea o producto para el anuncio: ${prompt.trim()}`,
          temperature: 0.7,
        });

        const cleanScript = text.trim().replace(/^["']|["']$/g, '');

        return NextResponse.json({
          script: cleanScript,
          model: 'gemini-2.5-flash',
          keyUsed: masked,
          keyIndex: i + 1,
          totalKeys: geminiKeys.length,
          provider: 'Google Gemini (Pool Gratuito)',
        });
      } catch (keyErr: any) {
        lastError = keyErr;
        console.warn(`[Gemini Script Pool] Llave #${i + 1} (${masked}) con error: ${keyErr.message}. Conmutando a la siguiente...`);
        // Continuar al siguiente ciclo del pool
      }
    }

    return NextResponse.json(
      {
        error: `Todas las llaves del pool de Gemini fallaron: ${lastError?.message || 'Error desconocido'}.`,
      },
      { status: 500 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error interno al generar guion con Gemini.' },
      { status: 500 }
    );
  }
}
