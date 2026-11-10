import { NextRequest, NextResponse } from 'next/server';
import { assertAppUiRequest } from '@/lib/director/local-guard';
import { getStudioProject } from '@/lib/studio/store';
import { studioError } from '@/lib/studio/http';
import { MaterialError } from '@/lib/material/material';
import { saveAttachments } from '@/lib/material/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Adjuntos del chat (multipart `archivos`) → <carpeta>/adjuntos/. Devuelve sus rutas relativas. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppUiRequest(req);
    const { id } = await params;
    const p = await getStudioProject(id);
    return NextResponse.json({ archivos: await saveAttachments(p.carpeta, await req.formData()) });
  } catch (err) {
    if (err instanceof MaterialError) return NextResponse.json({ error: err.message }, { status: err.status });
    return studioError(err, 'No se pudieron guardar los archivos.');
  }
}
