import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeech } from '@/lib/generation/voice';

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

    // Síntesis con el SDK oficial, guardado en la biblioteca y registro en Costos (lib/generation/voice.ts)
    const { result, effectiveModel, filePath, characters } = await synthesizeSpeech({
      text,
      voiceId,
      language,
      modelId,
      voiceSettings,
      tool,
      voiceName,
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
