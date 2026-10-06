import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      // Si la tarea es de prueba local (mock), simular progreso
      if (id.startsWith('mock_task_')) {
        return NextResponse.json({
          status: 'completed',
          progress: 100,
          videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
        });
      }

      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY no configurada en las variables de entorno.' },
        { status: 500 }
      );
    }

    const response = await fetch(`https://openrouter.ai/api/v1/videos/${id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `OpenRouter respondió con estado ${response.status}: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const taskData = data.data || data;

    const status = (taskData.status || '').toLowerCase();
    const progress = taskData.progress || (status === 'completed' ? 100 : 50);
    const videoUrl = taskData.video_url || taskData.output_url || taskData.result_url || null;

    return NextResponse.json({
      taskId: id,
      status,
      progress,
      videoUrl,
      error: taskData.error || null,
    });
  } catch (error: any) {
    console.error('[API OpenRouter Status Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Error al consultar estado en OpenRouter.' },
      { status: 500 }
    );
  }
}
