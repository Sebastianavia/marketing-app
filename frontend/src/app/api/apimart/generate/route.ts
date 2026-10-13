import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient } from '@/lib/ai/apimart';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model, prompt, durationSeconds = 30, aspectRatio = '9:16', customApiKey } = body;

    const apiKey = customApiKey || process.env.APIMART_API_KEY || '';
    const client = new ApiMartClient(apiKey);

    if (!client.isConfigured) {
      return NextResponse.json(
        { error: 'Falta APIMART_API_KEY en .env.local (o tu clave de APIMart en la herramienta): no se puede generar el video.' },
        { status: 400 }
      );
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
