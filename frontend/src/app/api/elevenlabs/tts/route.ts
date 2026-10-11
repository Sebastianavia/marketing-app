import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, language = 'es', modelId, voiceSettings } = await req.json();

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

    // Retornar stream de audio MP3 binario directamente con headers informativos
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(result.sizeBytes),
        'X-Duration-Seconds': String(result.durationEstimatedSeconds),
        'X-Model-Used': modelId || 'eleven_multilingual_v2',
        'X-Language': language,
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
