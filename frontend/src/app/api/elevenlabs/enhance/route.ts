import { NextRequest, NextResponse } from 'next/server';
import { getElevenModel } from '@/config/elevenlabs-models';
import { orchestrateText, orchestratorErrorResponse } from '@/lib/ai/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 45;

/**
 * "Dar emoción": prepara el guion para la voz sin cambiar sus palabras.
 * Lo genera el orquestador (Gemini gratis o Claude).
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
    const { text, modelId, tool = 'voice-studio', orchestrator } = await req.json();
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Escribe primero el guion.' }, { status: 400 });
    }

    const spec = getElevenModel(modelId);
    const { text: out } = await orchestrateText({
      tool: String(tool),
      description: `Dar emoción (${spec.name}) · "${text.trim().slice(0, 50)}${text.trim().length > 50 ? '…' : ''}"`,
      system: spec.audioTags ? SYSTEM_TAGS : SYSTEM_PUNCTUATION,
      prompt: text.trim(),
      temperature: 0.4,
      mode: orchestrator,
    });
    const enhanced = out.trim().replace(/^["'“]|["'”]$/g, '');

    // Comprobación: las palabras deben ser las mismas que en el original
    if (normalize(enhanced) !== normalize(text)) {
      return NextResponse.json(
        { error: 'La IA cambió palabras del guion, así que se descartó. Prueba otra vez.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: enhanced, mode: spec.audioTags ? 'tags' : 'punctuation' });
  } catch (err) {
    return orchestratorErrorResponse(err);
  }
}
