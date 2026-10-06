import { NextRequest, NextResponse } from 'next/server';
import { elevenLabsService } from '@/services/elevenlabs/elevenlabs.service';

export const runtime = 'nodejs';
export const maxDuration = 90; // Clonación puede tomar algunos segundos

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const name = (formData.get('name') as string) || '';
    const description = (formData.get('description') as string) || '';
    const rawFiles = formData.getAll('files') as File[];

    if (!name.trim()) {
      return NextResponse.json(
        { error: 'El nombre de la voz es obligatorio.' },
        { status: 400 }
      );
    }

    if (!rawFiles || rawFiles.length === 0) {
      return NextResponse.json(
        { error: 'Debes adjuntar al menos un archivo de audio (MP3 o WAV).' },
        { status: 400 }
      );
    }

    // Convertir Web Files a buffers con sus nombres y tipos
    const filesToUpload: Array<{ buffer: Buffer; filename: string; contentType?: string }> = [];

    for (const file of rawFiles) {
      if (file && typeof file.arrayBuffer === 'function') {
        const arrayBuf = await file.arrayBuffer();
        filesToUpload.push({
          buffer: Buffer.from(arrayBuf),
          filename: file.name || 'sample.mp3',
          contentType: file.type || 'audio/mpeg',
        });
      }
    }

    if (filesToUpload.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron muestras de audio válidas.' },
        { status: 400 }
      );
    }

    const result = await elevenLabsService.cloneVoice(
      name,
      filesToUpload,
      description || `Voz clonada en Voice Studio (${filesToUpload.length} muestras)`
    );

    return NextResponse.json({
      success: true,
      voice_id: result.voice_id,
      name: result.name,
      samplesCount: filesToUpload.length,
      message: 'Voz clonada y almacenada en base de datos local exitosamente.',
    });
  } catch (error: any) {
    console.error('[API cloneVoice Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error durante la clonación de voz.' },
      { status: error.status || 500 }
    );
  }
}
