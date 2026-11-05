import { NextRequest, NextResponse } from 'next/server';
import { ApiMartClient, ApiMartError, isApiMartImageModel } from '@/lib/ai/apimart';
import { errorMessage } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      model,
      prompt,
      durationSeconds = 30,
      aspectRatio = '9:16',
      size,
      resolution = '2k',
      n = 1,
      image_urls,
      imageUrls,
      nsfw_check,
      official_fallback,
      customApiKey,
    } = body;

    const apiKey = customApiKey || process.env.APIMART_API_KEY || '';
    const client = new ApiMartClient(apiKey);

    if (!client.isConfigured) {
      return NextResponse.json(
        { error: 'Falta APIMART_API_KEY en .env.local: no se puede ejecutar la tarea.' },
        { status: 400 }
      );
    }

    if (isApiMartImageModel(model)) {
      const task = await client.createImageGenerationTask({
        model,
        prompt,
        n: Number(n) || 1,
        size: size || aspectRatio || '9:16',
        resolution: String(resolution || '2K'),
        imageUrls: Array.isArray(image_urls) ? image_urls : Array.isArray(imageUrls) ? imageUrls : undefined,
        nsfwCheck: typeof nsfw_check === 'boolean' ? nsfw_check : undefined,
        officialFallback: typeof official_fallback === 'boolean' ? official_fallback : undefined,
      });
      return NextResponse.json(task);
    }

    const task = await client.generateVideo({
      model,
      prompt,
      durationSeconds,
      aspectRatio,
    });

    return NextResponse.json(task);
  } catch (error) {
    if (error instanceof ApiMartError) {
      return NextResponse.json({ error: error.message, type: error.errorType }, { status: error.status });
    }
    return NextResponse.json(
      { error: errorMessage(error, 'Error al iniciar generación en ApiMart') },
      { status: 500 }
    );
  }
}
