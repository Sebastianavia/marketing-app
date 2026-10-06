import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId, language = 'es' } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'El texto a sintetizar es obligatorio.' },
        { status: 400 }
      );
    }

    if (!voiceId || typeof voiceId !== 'string') {
      return NextResponse.json(
        { error: 'Debes seleccionar una voz (voiceId).' },
        { status: 400 }
      );
    }

    // Ejecuta síntesis forzando eleven_multilingual_v2
    const result = await elevenLabsService.generateAudio(
      text,
      voiceId,
      language
    );

    // Retornar stream de audio MP3 binario directamente con headers informativos
    return new Response(result.buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(result.sizeBytes),
        'X-Duration-Seconds': String(result.durationEstimatedSeconds),
        'X-Model-Used': 'eleven_multilingual_v2',
        'X-Language': language,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[API ElevenLabs TTS Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error sintetizando audio en ElevenLabs.' },
      { status: error.status || 500 }
    );
  }
}
