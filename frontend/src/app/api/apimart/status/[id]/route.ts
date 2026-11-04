import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient } from '@/lib/ai/apimart';
import { errorMessage } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const customApiKey = searchParams.get('apiKey');

    const client = new ApiMartClient(customApiKey || undefined);

    if (id.startsWith('apimart_task_')) {
      // Simulación de progreso para pruebas locales
      return NextResponse.json({
        taskId: id,
        status: 'completed',
        videoUrl: 'https://cdn.pixabay.com/video/2020/09/25/51139-464303494_large.mp4',
        progress: 100,
      });
    }

    const status = await client.checkTaskStatus(id);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, 'Error consultando tarea en ApiMart') },
      { status: 500 }
    );
  }
}
