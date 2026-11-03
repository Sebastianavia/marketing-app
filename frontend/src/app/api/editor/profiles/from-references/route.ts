import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { profileFromReferences } from '@/lib/editor/references';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** POST multipart `imagenes` (1 a 6 capturas): la IA propone un perfil. No guarda nada. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const form = await req.formData();
    const images: Array<{ name: string; bytes: Buffer }> = [];
    for (const v of form.getAll('imagenes')) {
      if (typeof v === 'string') continue;
      images.push({ name: v.name || 'captura.png', bytes: Buffer.from(await v.arrayBuffer()) });
    }
    return NextResponse.json(await profileFromReferences(images));
  } catch (err) {
    return editorError(err, 'No se pudo crear el perfil desde las referencias.');
  }
}
