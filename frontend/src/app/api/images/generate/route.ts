import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DailyLimitError } from '@/lib/usage/usage-store';
import { errorMessage } from '@/lib/errors';
import { AvatarError } from '@/lib/avatars/avatar-store';
import { generateImages, ImageRequestSchema } from '@/lib/generation/image';
import { GenerationError, assertOpenRouterKey } from '@/lib/generation/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Genera imágenes con la Image API de OpenRouter. La lógica vive en lib/generation/image.ts
 * (la comparte el Director); aquí solo se valida la entrada y se traducen los errores a HTTP.
 */
export async function POST(req: NextRequest) {
  try {
    assertOpenRouterKey();
    const body = ImageRequestSchema.parse(await req.json());
    return NextResponse.json(await generateImages(body, { tool: 'image-studio', saveProject: true }));
  } catch (err) {
    if (err instanceof GenerationError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof AvatarError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof DailyLimitError) return NextResponse.json({ error: err.message }, { status: 402 });
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(' ') }, { status: 400 });
    return NextResponse.json({ error: errorMessage(err, 'No se pudo generar la imagen.') }, { status: 500 });
  }
}
