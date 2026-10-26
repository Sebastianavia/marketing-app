import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';
import { saveGenerated } from '@/lib/storage/generated-library';
import { recordUsage } from '@/lib/usage/usage-store';
import { ttsCost } from '@/config/cost-rates';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, language = 'es', modelId, voiceSettings, tool = 'voice-studio', voiceName } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'El texto a sintetizar es obligatorio.', code: 'invalid_input' },
        { status: 400 }
      );
    }

    // Ejecuta síntesis forzando el SDK oficial, el modelo y los parámetros de voz configurados
    const result = await elevenLabsService.generateAudio(
      text,
      voiceId,
      language,
      modelId,
      voiceSettings
    );

    const effectiveModel = result.modelId || modelId || 'desconocido';
    const id = crypto.randomUUID();

    // Todo lo generado se guarda en la biblioteca, aunque no se pulse "Guardar proyecto"
    let filePath: string | undefined;
    try {
      filePath = await saveGenerated('audio', Buffer.from(result.buffer), 'mp3', id);
    } catch (saveErr) {
      console.warn('[TTS] No se pudo guardar el MP3 en la biblioteca:', saveErr);
    }

    const characters = result.charactersBilled ?? text.trim().length;
    await recordUsage({
      tool: String(tool),
      kind: 'audio',
      provider: 'elevenlabs',
      model: effectiveModel,
      description: `Locución ${language.toUpperCase()}${voiceName ? ` · ${voiceName}` : ''} · "${text.trim().slice(0, 60)}${characters > 60 ? '…' : ''}"`,
      units: characters,
      unit: 'caracteres',
      costUSD: ttsCost(effectiveModel, characters),
      estimated: true,
      filePath,
    });

    // Retornar stream de audio MP3 binario directamente con headers informativos
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(result.sizeBytes),
        'X-Duration-Seconds': String(result.durationEstimatedSeconds),
        'X-Model-Used': effectiveModel,
        'X-Language': language,
        'X-Characters': String(characters),
        ...(result.tagsRemoved ? { 'X-Tags-Removed': '1' } : {}),
        ...(filePath ? { 'X-Saved-Path': encodeURIComponent(filePath) } : {}),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[API ElevenLabs TTS Error]:', error);
    const status = error.httpStatus || error.status || 500;
    return NextResponse.json(
      {
        error: error.message || 'Error sintetizando audio en ElevenLabs.',
        code: error.code || 'unknown',
        details: error.details,
      },
      { status }
    );
  }
}
