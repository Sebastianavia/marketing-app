import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { brandFromDocument } from '@/lib/editor/brand-from-document';
import { editorError } from '@/lib/editor/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** POST multipart `documento` (PDF, TXT, MD): la IA extrae los datos de marca. */
export async function POST(req: NextRequest) {
  try {
    assertAppUiRequest(req);
    const form = await req.formData();
    const doc = form.get('documento');
    if (!doc || typeof doc === 'string' || !(doc instanceof File)) {
      return NextResponse.json({ error: 'Debes seleccionar un archivo (PDF, TXT, MD).' }, { status: 400 });
    }

    const bytes = Buffer.from(await doc.arrayBuffer());
    const res = await brandFromDocument({ name: doc.name || 'documento.pdf', bytes });
    return NextResponse.json(res);
  } catch (err) {
    return editorError(err, 'No se pudieron extraer los datos de la marca desde el documento.');
  }
}

