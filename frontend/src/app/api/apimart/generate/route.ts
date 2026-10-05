import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient } from '@/lib/ai/apimart';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model, prompt, durationSeconds = 30, aspectRatio = '9:16', customApiKey } = body;

    const apiKey = customApiKey || process.env.APIMART_API_KEY || '';
    const client = new ApiMartClient(apiKey);

    if (!client.isConfigured) {
      // Modo preparación / simulación si el usuario aún no ingresa su ApiMart Key
      const mockTaskId = `apimart_task_${Date.now()}`;
      return NextResponse.json({
        taskId: mockTaskId,
        status: 'processing',
        model,
        durationSeconds,
        isSimulated: true,
        message: 'Modo preparación ApiMart. Configura APIMART_API_KEY para renderizado en producción.',
      });
    }

    const task = await client.generateVideo({
      model,
      prompt,
      durationSeconds,
      aspectRatio,
    });

    return NextResponse.json(task);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al iniciar generación en ApiMart' },
      { status: 500 }
    );
  }
}
