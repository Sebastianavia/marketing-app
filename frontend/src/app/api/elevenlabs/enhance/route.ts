import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getGeminiKeyPool, maskApiKey } from '@/lib/ai/gemini-pool';
import { recordUsage } from '@/lib/usage/usage-store';
import { getElevenModel } from '@/config/elevenlabs-models';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 45;

/**
 * "Dar emoción": prepara el guion para la voz sin cambiar sus palabras.
 * Sigue las reglas del botón Enhance que documenta ElevenLabs
 * (elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#enhancing-input):
 * - modelos con etiquetas (v4, v4 Turbo, v3): añade etiquetas de voz entre corchetes;
 * - modelos sin etiquetas (Multilingual v2, Flash): solo puntuación y MAYÚSCULAS.
 */

const RULES_COMMON = `- NO cambies, añadas ni quites ninguna palabra del texto original.
- Puedes añadir énfasis: poner alguna palabra clave en MAYÚSCULAS, signos de exclamación o interrogación donde tenga sentido, y puntos suspensivos (...) para pausas.
- No inventes frases nuevas.
- Devuelve SOLO el texto final, sin explicaciones ni comillas.`;

const SYSTEM_TAGS = `Preparas guiones en español para síntesis de voz con ElevenLabs.
Tu objetivo es hacerlos más expresivos añadiendo etiquetas de voz entre corchetes, sin alterar el texto.
Reglas:
- Añade etiquetas que describan algo que se OYE en la voz, en inglés y entre corchetes, justo antes o después del fragmento que modifican. Ejemplos: [excited], [curious], [warmly], [sighs], [laughs], [whispers], [thoughtful], [surprised], [short pause].
- Elige etiquetas coherentes con el sentido de cada frase y varía la emoción a lo largo del texto.
- No uses etiquetas de acciones que no suenan ([standing], [smiling]) ni de música o efectos de sonido.
- Usa como mucho una etiqueta por frase.
${RULES_COMMON}`;

const SYSTEM_PUNCTUATION = `Preparas guiones en español para síntesis de voz con ElevenLabs, con un modelo que NO admite etiquetas entre corchetes.
Tu objetivo es hacerlos más expresivos solo con puntuación.
Reglas:
- NO añadas corchetes ni etiquetas de ningún tipo.
${RULES_COMMON}`;

const normalize = (s: string) =>
  s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function POST(req: NextRequest) {
  try {
    const { text, modelId, tool = 'voice-studio' } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Escribe primero el guion.' }, { status: 400 });
    }

    const spec = getElevenModel(modelId);
    const keys = getGeminiKeyPool();
    if (keys.length === 0) {
      return NextResponse.json(
        { error: 'No hay claves de Gemini en .env.local (GEMINI_API_KEYS).' },
        { status: 500 }
      );
    }

    let lastError: unknown = null;
    for (let i = 0; i < keys.length; i++) {
      try {
        const google = createGoogleGenerativeAI({ apiKey: keys[i] });
        const { text: out } = await generateText({
          model: google('gemini-2.5-flash'),
          system: spec.audioTags ? SYSTEM_TAGS : SYSTEM_PUNCTUATION,
          prompt: text.trim(),
          temperature: 0.4,
        });
        const enhanced = out.trim().replace(/^["'“]|["'”]$/g, '');

        // Comprobación: las palabras deben ser las mismas que en el original
        if (normalize(enhanced) !== normalize(text)) {
          lastError = new Error('El modelo cambió palabras del guion; se descartó el resultado.');
          continue;
        }

        await recordUsage({
          tool: String(tool),
          kind: 'script',
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          description: `Dar emoción (${spec.name}) · "${text.trim().slice(0, 50)}${text.trim().length > 50 ? '…' : ''}"`,
          units: 1,
          unit: 'texto',
          costUSD: 0,
          estimated: true,
        });

        return NextResponse.json({ text: enhanced, mode: spec.audioTags ? 'tags' : 'punctuation' });
      } catch (err) {
        lastError = err;
        console.warn(`[Dar emoción] Llave #${i + 1} (${maskApiKey(keys[i])}) falló:`, errorMessage(err, ''));
      }
    }

    return NextResponse.json(
      { error: errorMessage(lastError, 'No se pudo preparar el guion.') },
      { status: 502 }
    );
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err, 'Error interno.') }, { status: 500 });
  }
}
