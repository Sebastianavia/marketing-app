import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { orchestrateObject, orchestratorErrorResponse } from '@/lib/ai/orchestrator';
import { ScenePlanSchema, normalizeWords } from '@/lib/scenes/scene-plan';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  /** keep = usar mi guion tal cual · write = que la IA lo escriba */
  mode: z.enum(['keep', 'write']),
  text: z.string().max(20_000).optional().default(''),
  pdfBase64: z.string().max(30_000_000).optional(),
  pdfName: z.string().max(200).optional(),
  targetSeconds: z.number().min(10).max(180).default(30),
  emotionTags: z.boolean().default(true),
  /** Material confidencial: nunca el modo gratis. */
  confidential: z.boolean().default(false),
  voiceMode: z.enum(['voiceover', 'native', 'avatar']).default('avatar'),
  orchestrator: z.unknown().optional(),
});

const SYSTEM = `Eres director creativo de videos verticales de marketing (TikTok, Reels, Shorts) en español neutro.
Divides un video en escenas cortas para producirlo con IA:
- Escenas 'avatar': la persona del anuncio habla a cámara (gancho, testimonio, llamado a la acción).
- Escenas 'broll': tomas de apoyo del producto o del contexto mientras la voz sigue sonando.
Reglas:
- Cada escena dura entre 4 y 8 segundos de locución (una o dos frases).
- Empieza con una escena 'avatar' (gancho) y termina con una 'avatar' (llamado a la acción). Alterna con 'broll' cuando ayude a mostrar el producto.
- visualPrompt de 'broll': una sola toma concreta y filmable (sujeto, acción, plano, luz, movimiento de cámara), sin texto en pantalla ni logotipos inventados.
- En 'broll' NO muestres a una persona hablando a cámara (esas tomas no sincronizan labios con la voz): usa el producto, manos, detalles, entorno o personas de espaldas o sin hablar.
- No inventes datos, precios, cifras ni promesas que no estén en el material.`;

export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await req.json());
    const hasPdf = Boolean(body.pdfBase64);
    if (!body.text.trim() && !hasPdf) {
      return NextResponse.json({ error: 'Pega un guion, escribe una idea o sube un PDF.' }, { status: 400 });
    }
    if (body.mode === 'keep' && !body.text.trim()) {
      return NextResponse.json({ error: 'Para usar tu guion tal cual, pégalo en el cuadro de texto.' }, { status: 400 });
    }

    const tagsRule = body.emotionTags && body.voiceMode !== 'native'
      ? '- Puedes añadir etiquetas de voz en inglés entre corchetes al inicio de una frase, como [excited], [curious], [warmly], [sighs] (máximo una por escena).'
      : '- NO uses corchetes ni etiquetas; la emoción va solo con puntuación (¡!, ¿?, puntos suspensivos) y alguna palabra en MAYÚSCULAS.';

    const modeRule =
      body.voiceMode === 'voiceover'
        ? `\nMODO VOZ EN OFF: TODAS las escenas son 'broll'. Nadie habla a cámara; la narración es una voz en off que suena encima de las tomas.`
        : body.voiceMode === 'native'
        ? `\nMODO LOS PERSONAJES HABLAN: TODAS las escenas son 'broll' y en cada una una persona dice la narración a cámara (el modelo de video genera su voz).
- Cada narración debe poder decirse en 6 segundos o menos (máximo ~90 caracteres), porque cada clip dura como mucho 8 s.
- visualPrompt: describe SIEMPRE a la misma persona con los mismos rasgos (edad, aspecto, ropa) y el lugar, igual en todas las escenas, más cómo habla (tono, gesto). La narración NO va en el visualPrompt.
- No uses etiquetas entre corchetes.`
        : '';

    let prompt: string;
    if (body.mode === 'keep') {
      prompt = `Divide ESTE guion en escenas consecutivas.
- Usa el texto EXACTO: no cambies, quites ni añadas palabras; solo puedes ajustar puntuación y mayúsculas para dar énfasis.
- La unión de todas las narraciones, en orden, debe ser el guion completo.
${tagsRule}

GUION:
${body.text.trim()}`;
    } else {
      prompt = `Escribe el guion de un video de unos ${body.targetSeconds} segundos (aprox. ${Math.round(body.targetSeconds * 15)} caracteres de locución en total) y divídelo en escenas.
- Basa el contenido SOLO en el material${hasPdf ? ' del PDF adjunto' : ''}${body.text.trim() ? ' y en estas indicaciones' : ''}.
${tagsRule}
${body.text.trim() ? `\nINDICACIONES / IDEA:\n${body.text.trim()}` : ''}`;
    }

    const files = hasPdf
      ? [{ data: new Uint8Array(Buffer.from(body.pdfBase64!, 'base64')), mediaType: 'application/pdf', filename: body.pdfName || 'material.pdf' }]
      : undefined;

    const { object, meta } = await orchestrateObject({
      tool: 'text-to-video',
      description: `Armar escenas (${body.mode === 'keep' ? 'mi guion' : hasPdf ? 'desde PDF' : 'desde idea'})`,
      system: SYSTEM + modeRule,
      prompt,
      files,
      schema: ScenePlanSchema,
      temperature: body.mode === 'keep' ? 0.2 : 0.7,
      mode: body.orchestrator,
      confidential: body.confidential,
    });

    if (body.mode === 'keep') {
      const joined = object.scenes.map((s) => s.narration).join(' ');
      if (normalizeWords(joined) !== normalizeWords(body.text)) {
        return NextResponse.json(
          { error: 'La IA cambió palabras de tu guion al dividirlo, así que se descartó. Vuelve a intentarlo.' },
          { status: 422 }
        );
      }
    }

    return NextResponse.json({
      title: object.title,
      scenes: object.scenes.map((s) => ({
        type: body.voiceMode === 'avatar' ? s.type : ('broll' as const),
        narration: s.narration.trim(),
        visualPrompt: s.type === 'broll' || body.voiceMode !== 'avatar' ? s.visualPrompt.trim() : '',
      })),
      orchestrator: meta.mode,
      model: meta.model,
      costUSD: meta.costUSD,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    }
    return orchestratorErrorResponse(err);
  }
}
