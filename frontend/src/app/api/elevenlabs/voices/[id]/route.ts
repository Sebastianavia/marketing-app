import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'El ID de la voz es obligatorio.' },
        { status: 400 }
      );
    }

    const result = await elevenLabsService.deleteVoice(id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API ElevenLabs Delete Voice [id] Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error al eliminar la voz de ElevenLabs.' },
      { status: 500 }
    );
  }
}
