import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient, ApiMartError } from '@/lib/ai/apimart';
import { errorMessage } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const customApiKey = searchParams.get('apiKey');
    const kind = searchParams.get('kind');

    const client = new ApiMartClient(customApiKey || undefined);

    if (id.startsWith('apimart_task_')) {
      return NextResponse.json({
        taskId: id,
        status: 'completed',
        videoUrl: 'https://cdn.pixabay.com/video/2020/09/25/51139-464303494_large.mp4',
        progress: 100,
      });
    }

    if (kind === 'image') {
      const imageStatus = await client.getImageTaskStatus(id);
      return NextResponse.json(imageStatus);
    }

    const status = await client.checkTaskStatus(id);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof ApiMartError) {
      return NextResponse.json({ error: error.message, type: error.errorType }, { status: error.status });
    }
    return NextResponse.json(
      { error: errorMessage(error, 'Error consultando tarea en ApiMart') },
      { status: 500 }
    );
  }
}
