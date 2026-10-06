import { NextRequest, NextResponse } from 'next/server';
import { OpenRouterVideoService } from '@/services/openrouter/openrouter-video.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const {
      imageUrl,
      audioUrl,
      aspectRatio = '9:16',
      model = 'heygen/avatar-iv',
    } = await req.json();

    if (!imageUrl || !audioUrl) {
      return NextResponse.json(
        { error: 'Tanto imageUrl como audioUrl son obligatorios para el renderizado con OpenRouter.' },
        { status: 400 }
      );
    }

    const service = new OpenRouterVideoService();
    const task = await service.createVideoTask({
      model,
      imageUrl,
      audioUrl,
      aspectRatio,
    });

    return NextResponse.json({
      success: true,
      taskId: task.taskId,
      status: task.status,
    });
  } catch (error: any) {
    console.error('[API OpenRouter Video Generate Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error al iniciar tarea de video en OpenRouter.' },
      { status: error.status || 500 }
    );
  }
}
